import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateWorkedHours, formatDurationMs } from '../lib/dateUtils';
import {
  aggregate,
  MAX_PLAUSIBLE_SHIFT_HOURS,
  LATE_TOLERANCE_MINUTES,
  PAGE_SIZE,
  MAX_PAGES,
  OperationAnalyticsService,
  type RawAnalyticsData,
  type OperationAnalyticsPeriod,
} from './operationAnalyticsService';

// ---------------------------------------------------------------------------
// Mock de `supabase` para exercitar `collectRawData`/`resolveCompanyScope` (dívida #17 —
// `C-ANALYTICS-A15-SEM-PROVA`). Cada `.from(table)` devolve uma cadeia encadeável que registra
// TODAS as chamadas (`select`, `eq`, `in`, `neq`, `gte`, `lte`, `range`, `order`) em um log por
// invocação — permite assertar tanto a string do `.select()` quanto os argumentos de `.in(...)`
// (ancoragem dupla) sem exportar nada de produção (só a API pública `getOperationAnalytics` é
// chamada). Precedente: `teamConnectionService.test.ts` assere a string do `.select()`.
//
// Cada chamada a `supabase.from(table)` cria uma cadeia NOVA (mesmo padrão de `fetchAllPaged`,
// que chama `supabase.from(...)` de novo a cada página) — por isso a fila de respostas é por
// TABELA, consumida em ordem, e o log de chamadas é uma lista de invocações (uma por página).
// ---------------------------------------------------------------------------

interface ChainCall {
  method: string;
  args: unknown[];
}

interface QueueItem {
  data: unknown[] | null;
  error: { message: string } | null;
}

type ChainMethod = 'select' | 'eq' | 'neq' | 'in' | 'gte' | 'lte' | 'order' | 'range';

type Chain = Record<ChainMethod, (...args: unknown[]) => Chain> & {
  then: <TResult1 = QueueItem, TResult2 = never>(
    onfulfilled?: ((value: QueueItem) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => Promise<TResult1 | TResult2>;
};

const CHAIN_METHODS: ChainMethod[] = ['select', 'eq', 'neq', 'in', 'gte', 'lte', 'order', 'range'];

const tableQueues = new Map<string, QueueItem[]>();
const tableCallLogs = new Map<string, ChainCall[][]>();

function setQueue(table: string, items: QueueItem[]) {
  tableQueues.set(table, [...items]);
}

function popResponse(table: string): QueueItem {
  const queue = tableQueues.get(table);
  if (!queue || queue.length === 0) return { data: [], error: null };
  // Mantém o último item na fila (não esvazia) — chamadas extras além do planejado devolvem a
  // última resposta configurada, em vez de cair silenciosamente no default `{data: [], error: null}`
  // e mascarar um laço que roda mais vezes do que o teste previu.
  return queue.length > 1 ? (queue.shift() as QueueItem) : queue[0];
}

function callLogsFor(table: string): ChainCall[][] {
  return tableCallLogs.get(table) ?? [];
}

function selectArgOf(table: string, invocation = 0): string {
  const calls = callLogsFor(table)[invocation] ?? [];
  const selectCall = calls.find((c) => c.method === 'select');
  return (selectCall?.args[0] as string) ?? '';
}

function inArgsOf(table: string, column: string, invocation = 0): unknown[] | undefined {
  const calls = callLogsFor(table)[invocation] ?? [];
  const inCall = calls.find((c) => c.method === 'in' && c.args[0] === column);
  return inCall?.args[1] as unknown[] | undefined;
}

function buildChain(table: string, callLog: ChainCall[]): Chain {
  const chain = {} as Chain;
  for (const method of CHAIN_METHODS) {
    chain[method] = (...args: unknown[]) => {
      callLog.push({ method, args });
      return chain;
    };
  }
  chain.then = (onfulfilled, onrejected) => Promise.resolve(popResponse(table)).then(onfulfilled ?? undefined, onrejected ?? undefined);
  return chain;
}

const mockFrom = vi.fn((table: string): Chain => {
  const callLog: ChainCall[] = [];
  const logs = tableCallLogs.get(table) ?? [];
  logs.push(callLog);
  tableCallLogs.set(table, logs);
  return buildChain(table, callLog);
});

const mockGetUser = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (table: string) => mockFrom(table),
  },
}));

vi.mock('../lib/logger', () => ({ logError: vi.fn(), logWarn: vi.fn() }));

function resetSupabaseMock() {
  tableQueues.clear();
  tableCallLogs.clear();
  mockFrom.mockClear();
  mockGetUser.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
}

// ---------------------------------------------------------------------------
// `aggregate` é PURA (D5.4 do PRD) — sem Supabase. Todos os testes constroem `RawAnalyticsData`
// diretamente (dados que `collectRawData` traria) e chamam `aggregate` com as dependências reais
// (`calculateWorkedHours`/`formatDurationMs`), o mesmo par usado em produção — não mocka nada, só
// evita o round-trip de rede. Se a lógica de agregação quebrar, estes testes falham.
//
// ⚠️ O QUE ESTES TESTES **NÃO** PROVAM: eles NÃO pegam uma coluna que suma do `select`. `JobRow`
// e as demais linhas brutas são tipos deste mesmo módulo, e o teste constrói o objeto a partir
// deles — um `.select()` incompleto continua tipando, continua compilando e continua passando
// aqui. Essa superfície (`collectRawData`, `resolveCompanyScope`, as 8 strings de `select`) tinha
// ficado sem cobertura (dívida `C-ANALYTICS-A15-SEM-PROVA`, item #17 de `debitos-pre-piloto.md`)
// — **fechada abaixo**, no describe `Dívida #17`, que mocka `supabase.from(...)` e exercita a API
// pública `getOperationAnalytics` (nada exportado de produção só para testar). Precedente que
// inspirou o padrão: `teamConnectionService.test.ts`, que assere a string do `select` de
// `listTeamMembers` e foi verificado por mutante.
// ---------------------------------------------------------------------------

const PERIOD_AUGUST: OperationAnalyticsPeriod = { from: '2026-08-01', to: '2026-08-31' };
const NOW = new Date('2026-08-25T12:00:00.000Z');

const DEPS = { calculateWorkedHours, formatDurationMs, now: NOW };

function emptyRaw(overrides: Partial<RawAnalyticsData> = {}): RawAnalyticsData {
  return {
    scopeCompanyIds: ['company-1'],
    truncated: false,
    // `hasError` e obrigatorio em RawAnalyticsData de proposito: erro de leitura NAO pode
    // degradar para "nao ha dado" (achado C-ANALYTICS-ERRO-VIRA-VAZIO). Default false aqui
    // porque estes testes exercitam `aggregate` com coleta bem-sucedida; o único teste que
    // passa `hasError: true` via override é 'A16 — hasError sobe intacto', abaixo.
    hasError: false,
    jobs: [],
    applications: [],
    shiftPayments: [],
    escrow: [],
    shiftCalls: [],
    shiftCallTargets: [],
    workers: new Map(),
    attendanceConfirmations: [],
    ...overrides,
  };
}

/** `start_date` sempre âncora de meio-dia LOCAL BR (`T12:00:00-03:00`) — D7. */
function jobStartDate(dateOnly: string): string {
  return new Date(`${dateOnly}T12:00:00.000-03:00`).toISOString();
}

// ---------------------------------------------------------------------------
// D6 — os 4 estados nunca colapsados. A9/A19.
// ---------------------------------------------------------------------------

// Escopo de unidade (F13): os servicos passaram a resolver a empresa OPERADA pelo seam, em vez
// de `.eq('owner_id', user.id)`. O duble evita bater na RPC get_my_companies nos testes.
vi.mock('./companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
  getMyCompanies: vi.fn().mockResolvedValue([{ company_id: 'company-1' }]),
}))
import { getMyCompanies } from './companyScopeService'

describe('D6 — estado sem-fonte quando não há NENHUMA linha na fonte do período (A9)', () => {
  it('empresa nova, zero jobs/calls/payments: todos os blocos ficam sem-fonte', () => {
    const result = aggregate(emptyRaw(), PERIOD_AUGUST, DEPS);
    expect(result.spend).toEqual({ state: 'sem-fonte' });
    expect(result.hires).toEqual({ state: 'sem-fonte' });
    expect(result.costPerHour).toEqual({ state: 'sem-fonte' });
    expect(result.hoursRatio).toEqual({ state: 'sem-fonte' });
    expect(result.fillTime).toEqual({ state: 'sem-fonte' });
    expect(result.callsByStatus).toEqual({ state: 'sem-fonte' });
    expect(result.callsByReason).toEqual({ state: 'sem-fonte' });
    expect(result.acceptanceByWorker).toEqual({ state: 'sem-fonte' });
    expect(result.attendanceByWorker).toEqual({ state: 'sem-fonte' });
    expect(result.performanceByWorker).toEqual({ state: 'sem-fonte' });
    expect(result.attendanceConfirmations).toEqual({ state: 'sem-fonte' });
  });
});

describe('D6/A19 — no-show: zero-real (0 com contexto) é diferente de sem-fonte', () => {
  it('12 turnos concluídos, nenhum no-show → bloco "ok" com noShowCount=0 (zero-real, não sem-fonte)', () => {
    const jobs = Array.from({ length: 12 }, (_, i) => ({
      id: `job-${i}`,
      company_id: 'company-1',
      status: 'completed',
      start_date: jobStartDate('2026-08-10'),
      created_at: jobStartDate('2026-08-10'),
      work_start_time: '08:00',
      work_end_time: '16:00',
      estimated_hours: 8,
      budget: 100,
    }));
    const applications = jobs.map((j, i) => ({
      id: `app-${i}`,
      job_id: j.id,
      worker_id: 'worker-1',
      status: 'completed',
      worker_checkin_at: '2026-08-10T11:00:00.000Z', // 08:00 BRT
      worker_checkout_at: '2026-08-10T19:00:00.000Z', // 16:00 BRT
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
    }));
    const raw = emptyRaw({ jobs, applications, workers: new Map([['worker-1', { id: 'worker-1', full_name: 'Ana', rating_average: 4.5 }]]) });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.attendanceByWorker.state).toBe('ok');
    if (result.attendanceByWorker.state === 'ok') {
      expect(result.attendanceByWorker.rows).toHaveLength(1);
      expect(result.attendanceByWorker.rows[0].noShowCount).toBe(0);
    }
  });

  it('nenhum turno no período → attendanceByWorker fica sem-fonte, não "0"', () => {
    const result = aggregate(emptyRaw(), PERIOD_AUGUST, DEPS);
    expect(result.attendanceByWorker).toEqual({ state: 'sem-fonte' });
  });
});

// ---------------------------------------------------------------------------
// A7' — no-show CORRIGIDO (D7): nunca `start_date + estimated_hours`; usa dia civil BR de
// start_date + work_end_time, com +1 dia se work_end_time <= work_start_time.
// ---------------------------------------------------------------------------

describe("A7' — no-show usa work_end_time (D7), nunca start_date + estimated_hours", () => {
  it('turno NOTURNO (20:00–02:00, cruza meia-noite): sem checkin e já passou → conta no-show', () => {
    // start_date ancorado em 2026-08-10 (meio-dia local); turno real 20:00–02:00(dia 11).
    // Um cálculo ingênuo (start_date + estimated_hours=6h a partir de MEIO-DIA) marcaria o turno
    // como "encerrado" às 18h do dia 10 — MUITO antes do turno sequer começar (20h). A regra
    // correta (D7) usa work_end_time com +1 dia, terminando 02:00 do dia 11.
    const job = {
      id: 'job-noturno',
      company_id: 'company-1',
      status: 'in_progress',
      start_date: jobStartDate('2026-08-10'),
      created_at: jobStartDate('2026-08-10'),
      work_start_time: '20:00',
      work_end_time: '02:00',
      estimated_hours: 6,
      budget: 100,
    };
    const application = {
      id: 'app-1',
      job_id: job.id,
      worker_id: 'worker-1',
      status: 'in_progress',
      worker_checkin_at: null,
      worker_checkout_at: null,
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
    };
    // "Agora" bem depois do término real esperado (02:00 do dia 11 em BRT = 05:00 UTC).
    const now = new Date('2026-08-11T10:00:00.000Z');
    const raw = emptyRaw({ jobs: [job], applications: [application], workers: new Map([['worker-1', { id: 'worker-1', full_name: 'Bruno', rating_average: null }]]) });
    const result = aggregate(raw, PERIOD_AUGUST, { ...DEPS, now });
    expect(result.attendanceByWorker.state).toBe('ok');
    if (result.attendanceByWorker.state === 'ok') {
      expect(result.attendanceByWorker.rows[0].noShowCount).toBe(1);
    }
  });

  it('MESMO turno noturno, mas "agora" é 21:00 do dia 10 (turno em andamento) → NÃO é no-show ainda', () => {
    const job = {
      id: 'job-noturno-2',
      company_id: 'company-1',
      status: 'in_progress',
      start_date: jobStartDate('2026-08-10'),
      created_at: jobStartDate('2026-08-10'),
      work_start_time: '20:00',
      work_end_time: '02:00',
      estimated_hours: 6,
      budget: 100,
    };
    const application = {
      id: 'app-2',
      job_id: job.id,
      worker_id: 'worker-1',
      status: 'in_progress',
      worker_checkin_at: null,
      worker_checkout_at: null,
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
    };
    // 21:00 BRT do dia 10 = 00:00 UTC do dia 11 — ainda dentro do turno (termina só às 02h BRT/05h UTC).
    const now = new Date('2026-08-11T00:00:00.000Z');
    const raw = emptyRaw({ jobs: [job], applications: [application], workers: new Map([['worker-1', { id: 'worker-1', full_name: 'Bruno', rating_average: null }]]) });
    const result = aggregate(raw, PERIOD_AUGUST, { ...DEPS, now });
    expect(result.attendanceByWorker.state).toBe('ok');
    if (result.attendanceByWorker.state === 'ok') {
      expect(result.attendanceByWorker.rows[0].noShowCount).toBe(0);
    }
  });

  it('turno sem work_start_time E sem work_end_time → excluído da métrica ("sem horário cadastrado"), nunca presumido', () => {
    const job = {
      id: 'job-sem-horario',
      company_id: 'company-1',
      status: 'hired',
      start_date: jobStartDate('2026-08-05'),
      created_at: jobStartDate('2026-08-05'),
      work_start_time: null,
      work_end_time: null,
      estimated_hours: null,
      budget: 100,
    };
    const application = {
      id: 'app-3',
      job_id: job.id,
      worker_id: 'worker-1',
      status: 'hired',
      worker_checkin_at: null,
      worker_checkout_at: null,
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
    };
    const raw = emptyRaw({ jobs: [job], applications: [application], workers: new Map([['worker-1', { id: 'worker-1', full_name: 'Carla', rating_average: null }]]) });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.attendanceByWorker.state).toBe('ok');
    if (result.attendanceByWorker.state === 'ok') {
      expect(result.attendanceByWorker.rows[0].noShowCount).toBe(0);
      expect(result.attendanceByWorker.rows[0].noShowExcludedNoScheduleCount).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// A13 — pontualidade: tolerância de 10 min, dentro conta pontual, fora conta atraso.
// ---------------------------------------------------------------------------

describe('A13 — pontualidade (D7/R15): work_start_time 08:00, tolerância 10 min', () => {
  function jobWithStart(id: string) {
    return {
      id,
      company_id: 'company-1',
      status: 'completed',
      start_date: jobStartDate('2026-08-12'),
      created_at: jobStartDate('2026-08-12'),
      work_start_time: '08:00',
      work_end_time: '16:00',
      estimated_hours: 8,
      budget: 100,
    };
  }

  it('checkin às 08:07 (dentro da tolerância) conta como pontual', () => {
    const job = jobWithStart('job-pontual');
    // 08:00 BRT = 11:00 UTC. 08:07 BRT = 11:07 UTC.
    const application = {
      id: 'app-pontual',
      job_id: job.id,
      worker_id: 'worker-1',
      status: 'completed',
      worker_checkin_at: '2026-08-12T11:07:00.000Z',
      worker_checkout_at: '2026-08-12T19:00:00.000Z',
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
    };
    const raw = emptyRaw({ jobs: [job], applications: [application], workers: new Map([['worker-1', { id: 'worker-1', full_name: 'Duda', rating_average: null }]]) });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.attendanceByWorker.state).toBe('ok');
    if (result.attendanceByWorker.state === 'ok') {
      expect(result.attendanceByWorker.rows[0].punctualCount).toBe(1);
      expect(result.attendanceByWorker.rows[0].lateCount).toBe(0);
    }
  });

  it('checkin às 08:15 (fora da tolerância) conta como atraso', () => {
    const job = jobWithStart('job-atraso');
    const application = {
      id: 'app-atraso',
      job_id: job.id,
      worker_id: 'worker-1',
      status: 'completed',
      worker_checkin_at: '2026-08-12T11:15:00.000Z',
      worker_checkout_at: '2026-08-12T19:00:00.000Z',
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
    };
    const raw = emptyRaw({ jobs: [job], applications: [application], workers: new Map([['worker-1', { id: 'worker-1', full_name: 'Duda', rating_average: null }]]) });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.attendanceByWorker.state).toBe('ok');
    if (result.attendanceByWorker.state === 'ok') {
      expect(result.attendanceByWorker.rows[0].punctualCount).toBe(0);
      expect(result.attendanceByWorker.rows[0].lateCount).toBe(1);
    }
  });

  it('LATE_TOLERANCE_MINUTES é 10 (constante do produto, R15)', () => {
    expect(LATE_TOLERANCE_MINUTES).toBe(10);
  });

  it('com apenas 1 checkin registrado no período, punctualityRate é null (amostra mínima R15)', () => {
    const job = jobWithStart('job-amostra-1');
    const application = {
      id: 'app-amostra-1',
      job_id: job.id,
      worker_id: 'worker-1',
      status: 'completed',
      worker_checkin_at: '2026-08-12T11:00:00.000Z',
      worker_checkout_at: '2026-08-12T19:00:00.000Z',
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
    };
    const raw = emptyRaw({ jobs: [job], applications: [application], workers: new Map([['worker-1', { id: 'worker-1', full_name: 'Duda', rating_average: null }]]) });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.attendanceByWorker.state).toBe('ok');
    if (result.attendanceByWorker.state === 'ok') {
      expect(result.attendanceByWorker.rows[0].punctualityRate).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// A17 — turno completed com checkin e SEM checkout: custo/hora cai para estimated_hours (rotulado);
// razão realizadas/previstas EXCLUI (numerador e denominador) — nunca usa a estimativa como realizado.
// ---------------------------------------------------------------------------

describe('A17 — turno sem checkout: estimativa no custo/hora, exclusão na razão', () => {
  it('turno completed com checkin e sem checkout em nenhuma fonte', () => {
    const job = {
      id: 'job-sem-checkout',
      company_id: 'company-1',
      status: 'completed',
      start_date: jobStartDate('2026-08-15'),
      created_at: jobStartDate('2026-08-15'),
      work_start_time: '08:00',
      work_end_time: '16:00',
      estimated_hours: 8,
      budget: 100,
    };
    const application = {
      id: 'app-sem-checkout',
      job_id: job.id,
      worker_id: 'worker-1',
      status: 'completed',
      worker_checkin_at: '2026-08-15T11:00:00.000Z',
      worker_checkout_at: null,
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
    };
    const shiftPayment = { job_id: job.id, worker_id: 'worker-1', amount: 200, status: 'recorded', paid_at: '2026-08-15T20:00:00.000Z' };
    const raw = emptyRaw({ jobs: [job], applications: [application], shiftPayments: [shiftPayment], workers: new Map([['worker-1', { id: 'worker-1', full_name: 'Elis', rating_average: null }]]) });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);

    // Custo por hora: cai para estimated_hours (8h), contado em estimatedHoursShiftsCount.
    expect(result.costPerHour.state).toBe('ok');
    if (result.costPerHour.state === 'ok') {
      expect(result.costPerHour.totalHours).toBe(8);
      expect(result.costPerHour.estimatedHoursShiftsCount).toBe(1);
      expect(result.costPerHour.shiftsCount).toBe(1);
      expect(result.costPerHour.costPerHour).toBe(200 / 8);
    }

    // Razão realizadas/previstas: turno EXCLUÍDO do numerador e denominador (não conta 8h/8h=1,00).
    expect(result.hoursRatio.state).toBe('ok');
    if (result.hoursRatio.state === 'ok') {
      expect(result.hoursRatio.realizedHours).toBe(0);
      expect(result.hoursRatio.estimatedHours).toBe(0);
      expect(result.hoursRatio.excludedNoAttendanceCount).toBe(1);
      expect(result.hoursRatio.excludedNoEstimateCount).toBe(0);
      expect(result.hoursRatio.ratio).toBeNull();
    }
  });

  it('turno completed sem estimated_hours cadastrado é excluído da razão por falta de estimativa (não tratado como 0)', () => {
    const job = {
      id: 'job-sem-estimativa',
      company_id: 'company-1',
      status: 'completed',
      start_date: jobStartDate('2026-08-16'),
      created_at: jobStartDate('2026-08-16'),
      work_start_time: '08:00',
      work_end_time: '16:00',
      estimated_hours: null,
      budget: 100,
    };
    const application = {
      id: 'app-sem-estimativa',
      job_id: job.id,
      worker_id: 'worker-1',
      status: 'completed',
      worker_checkin_at: '2026-08-16T11:00:00.000Z',
      worker_checkout_at: '2026-08-16T19:00:00.000Z',
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
    };
    const raw = emptyRaw({ jobs: [job], applications: [application], workers: new Map([['worker-1', { id: 'worker-1', full_name: 'Fabio', rating_average: null }]]) });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.hoursRatio.state).toBe('ok');
    if (result.hoursRatio.state === 'ok') {
      expect(result.hoursRatio.excludedNoEstimateCount).toBe(1);
      expect(result.hoursRatio.realizedHours).toBe(0);
      expect(result.hoursRatio.estimatedHours).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// D2c — turno com duração implausível (> 18h, checkout esquecido) é descartado do cálculo, e
// contado separadamente — nunca contamina o custo/hora nem a razão.
// ---------------------------------------------------------------------------

describe('D2c — marcação inconsistente (> MAX_PLAUSIBLE_SHIFT_HOURS) é descartada, não contamina o cálculo', () => {
  it('checkout registrado 20h depois do checkin (esquecido) — descartado, contado em inconsistentDurationShiftsCount', () => {
    const job = {
      id: 'job-inconsistente',
      company_id: 'company-1',
      status: 'completed',
      start_date: jobStartDate('2026-08-18'),
      created_at: jobStartDate('2026-08-18'),
      work_start_time: '08:00',
      work_end_time: '16:00',
      estimated_hours: 8,
      budget: 100,
    };
    const application = {
      id: 'app-inconsistente',
      job_id: job.id,
      worker_id: 'worker-1',
      status: 'completed',
      worker_checkin_at: '2026-08-18T11:00:00.000Z',
      worker_checkout_at: '2026-08-19T09:00:00.000Z', // 22h depois — acima de 18h
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
    };
    const raw = emptyRaw({ jobs: [job], applications: [application], workers: new Map([['worker-1', { id: 'worker-1', full_name: 'Gustavo', rating_average: null }]]) });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.costPerHour.state).toBe('ok');
    if (result.costPerHour.state === 'ok') {
      expect(result.costPerHour.inconsistentDurationShiftsCount).toBe(1);
      expect(result.costPerHour.totalHours).toBe(0);
      expect(result.costPerHour.estimatedHoursShiftsCount).toBe(0); // não caiu para estimativa — foi descartado, não omisso
    }
    expect(MAX_PLAUSIBLE_SHIFT_HOURS).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// C-ANALYTICS-TRACO-MUDO — turno completed SEM nenhuma fonte de hora (nem checkin/checkout de
// nenhuma origem, nem `estimated_hours` cadastrado) precisa cair em `noHoursSourceShiftsCount`,
// nunca desaparecer em silêncio deixando o "—" do custo/hora sem nenhuma legenda que explique
// o motivo (D6, linha 3 do bloco).
// ---------------------------------------------------------------------------

describe('C-ANALYTICS-TRACO-MUDO — turno sem NENHUMA fonte de hora não vira "—" mudo', () => {
  it('turno completed sem checkin/checkout (nenhuma fonte) e sem estimated_hours: noHoursSourceShiftsCount=1, costPerHour=null', () => {
    const job = {
      id: 'job-sem-fonte-hora',
      company_id: 'company-1',
      status: 'completed',
      start_date: jobStartDate('2026-08-20'),
      created_at: jobStartDate('2026-08-20'),
      work_start_time: '08:00',
      work_end_time: '16:00',
      estimated_hours: null,
      budget: 100,
    };
    const application = {
      id: 'app-sem-fonte-hora',
      job_id: job.id,
      worker_id: 'worker-1',
      status: 'completed',
      worker_checkin_at: null,
      worker_checkout_at: null,
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
    };
    const shiftPayment = { job_id: job.id, worker_id: 'worker-1', amount: 100, status: 'recorded', paid_at: '2026-08-20T20:00:00.000Z' };
    const raw = emptyRaw({
      jobs: [job],
      applications: [application],
      shiftPayments: [shiftPayment],
      workers: new Map([['worker-1', { id: 'worker-1', full_name: 'Helio', rating_average: null }]]),
    });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);

    expect(result.costPerHour.state).toBe('ok');
    if (result.costPerHour.state === 'ok') {
      expect(result.costPerHour.noHoursSourceShiftsCount).toBe(1);
      expect(result.costPerHour.costPerHour).toBeNull();
      expect(result.costPerHour.shiftsCount).toBe(1);
      expect(result.costPerHour.estimatedHoursShiftsCount).toBe(0);
      expect(result.costPerHour.inconsistentDurationShiftsCount).toBe(0);
    }
  });

  // REGRESSAO (achado navegando o produto, 23/08/2026): custo/hora, horas realizadas/previstas e
  // a tabela de desempenho filtravam os turnos por `jobs.status === 'completed'`. NADA no produto
  // escreve esse valor -- conferido no banco de producao, `jobs.status` so assume 'open' e
  // 'deleted'. Os tres cartoes diziam "Nenhum turno concluido neste periodo" para toda empresa,
  // sempre, mesmo com turno concluido e pago dentro do periodo.
  //
  // Os dois testes abaixo sao as duas metades da regra, e cada um sozinho MORRE com o filtro
  // antigo. (Uma primeira versao juntou os dois casos num teste so e a mutacao sobreviveu: o ramo
  // "job completed sem nenhuma application" produz exatamente os mesmos contadores, entao os
  // numeros nao distinguiam as duas implementacoes.)
  it('turno com jobs.status="open" e application CONCLUIDA conta (o caso real de producao)', () => {
    const job = {
      id: 'job-aberto-mas-concluido',
      company_id: 'company-1',
      status: 'open', // <- como toda linha real de `jobs` em producao
      start_date: jobStartDate('2026-08-21'),
      created_at: jobStartDate('2026-08-21'),
      work_start_time: '08:00',
      work_end_time: '16:00',
      estimated_hours: null,
      budget: 100,
    };
    const raw = emptyRaw({
      jobs: [job],
      applications: [{
        id: 'app-concluida',
        job_id: job.id,
        worker_id: 'worker-1',
        status: 'completed',
        worker_checkin_at: null,
        worker_checkout_at: null,
        company_checkin_confirmed_at: null,
        company_checkout_confirmed_at: null,
      }],
      workers: new Map([['worker-1', { id: 'worker-1', full_name: 'Helio', rating_average: null }]]),
    });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);

    // Com o filtro antigo nao havia turno "completed" nenhum: state caia em 'sem-fonte'.
    expect(result.costPerHour.state).toBe('ok');
    if (result.costPerHour.state === 'ok') {
      expect(result.costPerHour.shiftsCount).toBe(1);
    }
  });

  it('jobs.status="completed" sem NENHUMA application concluida nao conta (coluna morta nao decide)', () => {
    const fantasma = {
      id: 'job-status-completed-sem-ninguem',
      company_id: 'company-1',
      status: 'completed', // valor que nenhum caminho do produto grava
      start_date: jobStartDate('2026-08-21'),
      created_at: jobStartDate('2026-08-21'),
      work_start_time: '08:00',
      work_end_time: '16:00',
      estimated_hours: null,
      budget: 100,
    };
    const result = aggregate(emptyRaw({ jobs: [fantasma] }), PERIOD_AUGUST, DEPS);

    // Com o filtro antigo isso virava um turno concluido sem fonte de hora: state 'ok'.
    expect(result.costPerHour.state).toBe('sem-fonte');
  });
});

// ---------------------------------------------------------------------------
// C-ANALYTICS-ANCORA-MEIA-NOITE — `jobs.start_date` pode cair exatamente em `00:00:00Z`, que é
// `21:00` do dia civil ANTERIOR em `America/Sao_Paulo`. Caso REAL de produção (verificado em
// 21/08/2026): 4 turnos (25% da amostra) têm `start_date` nesta âncora, por terem
// `work_start_time = '21:00'`. `expectedShiftEndInstant`/`expectedShiftStartInstant` resolvem o
// dia civil via `toBrazilDateOnly` (Intl com timeZone explícito) — NUNCA
// `new Date(iso).toISOString().slice(0, 10)` (aritmética UTC pura, que é legítima em
// `addDaysToDateOnly`/`daysBetweenDateOnly` mas erraria o dia aqui por 1). `vitest.config.ts` fixa
// `TZ=America/Sao_Paulo` — não mockar o fuso, o bug só aparece se o motor rodar em UTC (como o CI).
// ---------------------------------------------------------------------------

describe('C-ANALYTICS-ANCORA-MEIA-NOITE — start_date em 00:00Z resolve para o dia civil BR anterior', () => {
  it('start_date=2026-08-11T00:00:00Z + work_start_time=21:00: pontualidade e bucketização usam o dia civil 10, não 11', () => {
    const job = {
      id: 'job-ancora-meia-noite',
      company_id: 'company-1',
      status: 'completed',
      // 00:00Z de 11/08 = 21:00 BRT de 10/08 — a âncora real dos 4 turnos verificados em produção.
      start_date: '2026-08-11T00:00:00.000Z',
      created_at: '2026-08-11T00:00:00.000Z',
      work_start_time: '21:00',
      work_end_time: '23:00',
      estimated_hours: 2,
      budget: 60,
    };
    const application = {
      id: 'app-ancora-meia-noite',
      job_id: job.id,
      worker_id: 'worker-1',
      status: 'completed',
      // Checkin EXATO no horário esperado (21:00 BRT de 10/08 = 00:00Z de 11/08) — pontual.
      worker_checkin_at: '2026-08-11T00:00:00.000Z',
      worker_checkout_at: '2026-08-11T02:00:00.000Z',
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
    };
    const worker = { id: 'worker-1', full_name: 'Ivo', rating_average: null };

    // Período 01–10/08: se a bucketização usasse o dia UTC (11) em vez do dia civil BR (10), este
    // turno cairia FORA do período e `hires`/`costPerHour` virariam "sem-fonte" incorretamente.
    const periodUntilDay10: OperationAnalyticsPeriod = { from: '2026-08-01', to: '2026-08-10' };
    const raw = emptyRaw({ jobs: [job], applications: [application], workers: new Map([['worker-1', worker]]) });
    const result = aggregate(raw, periodUntilDay10, DEPS);

    expect(result.hires.state).toBe('ok');
    if (result.hires.state === 'ok') {
      expect(result.hires.jobsCreatedCount).toBe(1);
    }

    expect(result.attendanceByWorker.state).toBe('ok');
    if (result.attendanceByWorker.state === 'ok') {
      const row = result.attendanceByWorker.rows[0];
      expect(row.punctualCount).toBe(1);
      expect(row.lateCount).toBe(0);
    }
  });

  // Achado do evaluator (mutante SOBREVIVEU): a asserção acima usa um checkin EXATO no horário
  // esperado, que é insensível ao sinal do erro — sob o mutante (dia UTC errado, 1 dia adiantado),
  // o diff vira -1440min, que também é "<=LATE_TOLERANCE_MINUTES" e cai em pontual igual ao código
  // correto. Um atraso GENUÍNO de 40min distingue: no código certo, diffMinutes=+40 (atrasado);
  // sob o mutante, expectedStart pula 1 dia para a frente e diffMinutes vira ~-1400 (pontual).
  it('checkin 40 minutos depois do esperado (21:00 BRT de 10/08): conta como atrasado, não pontual (mata mutante de expectedShiftStartInstant)', () => {
    const job = {
      id: 'job-ancora-meia-noite',
      company_id: 'company-1',
      status: 'completed',
      start_date: '2026-08-11T00:00:00.000Z',
      created_at: '2026-08-11T00:00:00.000Z',
      work_start_time: '21:00',
      work_end_time: '23:00',
      estimated_hours: 2,
      budget: 60,
    };
    const lateApplication = {
      id: 'app-ancora-atrasado',
      job_id: job.id,
      worker_id: 'worker-2',
      status: 'completed',
      // 40min depois do esperado (21:00 BRT de 10/08 = 00:00Z de 11/08) — atraso genuíno.
      worker_checkin_at: '2026-08-11T00:40:00.000Z',
      worker_checkout_at: '2026-08-11T02:40:00.000Z',
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
    };
    const worker2 = { id: 'worker-2', full_name: 'Zeca', rating_average: null };
    const periodUntilDay10: OperationAnalyticsPeriod = { from: '2026-08-01', to: '2026-08-10' };
    const raw = emptyRaw({ jobs: [job], applications: [lateApplication], workers: new Map([['worker-2', worker2]]) });
    const result = aggregate(raw, periodUntilDay10, DEPS);

    expect(result.attendanceByWorker.state).toBe('ok');
    if (result.attendanceByWorker.state === 'ok') {
      const row = result.attendanceByWorker.rows.find((r) => r.workerId === 'worker-2');
      expect(row?.lateCount).toBe(1);
      expect(row?.punctualCount).toBe(0);
    }
  });

  // Achado do evaluator (mutante SOBREVIVEU): `expectedShiftEndInstant` nunca era exercitada pela
  // âncora (application 'completed' não entra no ramo de no-show, que exige 'hired'/'in_progress').
  // Segundo job na MESMA âncora 00:00Z, status 'hired', sem checkin — força o cálculo do término
  // esperado. `now` customizado fica 1h depois do término esperado CORRETO (dia civil 10) mas bem
  // ANTES do término que o mutante calcularia (dia civil 11, +24h) — só o código certo marca no-show.
  it('turno hired sem checkin na âncora 00:00Z: noShowCount usa o término esperado do dia civil 10 (mata mutante de expectedShiftEndInstant)', () => {
    const job = {
      id: 'job-ancora-meia-noite-noshow',
      company_id: 'company-1',
      status: 'in_progress',
      start_date: '2026-08-11T00:00:00.000Z',
      created_at: '2026-08-11T00:00:00.000Z',
      work_start_time: '21:00',
      work_end_time: '23:00',
      estimated_hours: 2,
      budget: 60,
    };
    const application = {
      id: 'app-ancora-noshow',
      job_id: job.id,
      worker_id: 'worker-3',
      status: 'hired',
      worker_checkin_at: null,
      worker_checkout_at: null,
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
    };
    const worker3 = { id: 'worker-3', full_name: 'Nair', rating_average: null };
    const periodUntilDay10: OperationAnalyticsPeriod = { from: '2026-08-01', to: '2026-08-10' };
    // Término esperado CORRETO (dia civil 10 + 23:00 BRT) = 2026-08-11T02:00:00Z. `now` 1h depois
    // já caracteriza no-show no código certo, mas fica 23h antes do término (errado) que o mutante
    // calcularia com o dia civil 11.
    const nowJustAfterExpectedEnd = new Date('2026-08-11T03:00:00.000Z');
    const raw = emptyRaw({ jobs: [job], applications: [application], workers: new Map([['worker-3', worker3]]) });
    const result = aggregate(raw, periodUntilDay10, { ...DEPS, now: nowJustAfterExpectedEnd });

    expect(result.attendanceByWorker.state).toBe('ok');
    if (result.attendanceByWorker.state === 'ok') {
      const row = result.attendanceByWorker.rows.find((r) => r.workerId === 'worker-3');
      expect(row?.noShowCount).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// D8 — dedupe de gasto: mesmo (job_id, worker_id) em shift_payments E escrow_transactions —
// shift_payments vence, conflito contabilizado, nunca soma duas vezes.
// ---------------------------------------------------------------------------

describe('D8 — gasto: dedupe entre shift_payments (modo A) e escrow (modos B/C)', () => {
  it('mesmo par (job, worker) nas duas fontes: soma só uma vez, shift_payments vence, conflito contado', () => {
    const application = {
      id: 'app-dup',
      job_id: 'job-dup',
      worker_id: 'worker-1',
      status: 'completed',
      worker_checkin_at: null,
      worker_checkout_at: null,
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
    };
    const shiftPayment = { job_id: 'job-dup', worker_id: 'worker-1', amount: 150, status: 'recorded', paid_at: '2026-08-05T12:00:00.000Z' };
    const escrowRow = { job_id: 'job-dup', application_id: 'app-dup', amount: 999, status: 'released', released_at: '2026-08-05T12:00:00.000Z', captured_at: null };
    const raw = emptyRaw({ applications: [application], shiftPayments: [shiftPayment], escrow: [escrowRow] });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.spend.state).toBe('ok');
    if (result.spend.state === 'ok') {
      expect(result.spend.totalAmount).toBe(150); // NÃO 150+999
      expect(result.spend.conflictingRowsCount).toBe(1);
    }
  });

  it('escrow sem conflito (par distinto) soma normalmente', () => {
    const application = {
      id: 'app-b',
      job_id: 'job-b',
      worker_id: 'worker-2',
      status: 'completed',
      worker_checkin_at: null,
      worker_checkout_at: null,
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
    };
    const escrowRow = { job_id: 'job-b', application_id: 'app-b', amount: 300, status: 'captured', released_at: null, captured_at: '2026-08-06T12:00:00.000Z' };
    const raw = emptyRaw({ applications: [application], escrow: [escrowRow] });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.spend.state).toBe('ok');
    if (result.spend.state === 'ok') {
      expect(result.spend.totalAmount).toBe(300);
      expect(result.spend.conflictingRowsCount).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// A2 — shift_payment 'scheduled' nunca entra no gasto (a coleta já filtra `status='recorded'`
// antes de chegar em `RawAnalyticsData.shiftPayments` — este teste documenta o contrato: mesmo
// que uma linha 'scheduled' vazasse até aqui por algum bug de coleta, ela não tem como ser
// somada porque não é isso que o teste constrói; o texto abaixo prova que só a soma de
// `shiftPayments` presentes entra, e nada mais).
// ---------------------------------------------------------------------------

describe('A2 — promessa (scheduled) não é liquidação: só o que está em shiftPayments soma', () => {
  it('gasto = soma exata das linhas recorded fornecidas, nada além disso', () => {
    const shiftPayment = { job_id: 'job-x', worker_id: 'worker-1', amount: 500, status: 'recorded', paid_at: '2026-08-10T12:00:00.000Z' };
    const raw = emptyRaw({ shiftPayments: [shiftPayment] });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.spend.state).toBe('ok');
    if (result.spend.state === 'ok') expect(result.spend.totalAmount).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// A4/A5 — tempo médio de preenchimento e chamados por status: `expired` sempre presente
// (mesmo 0); chamado sem `first_claim_at` entra em CallsByStatus mas NÃO na média de FillTime.
// ---------------------------------------------------------------------------

describe('A4/A5 — fillTime exclui chamados sem first_claim_at; expired nunca omitido', () => {
  it('chamado expirado sem first_claim_at: conta em callsByStatus.expired, fora da média de fillTime', () => {
    const call = {
      id: 'call-expired',
      job_id: 'job-1',
      company_id: 'company-1',
      reason: 'falta',
      status: 'expired',
      created_at: '2026-08-05T10:00:00.000Z',
      first_claim_at: null, origin: 'team',
    };
    const raw = emptyRaw({ shiftCalls: [call] });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.callsByStatus.state).toBe('ok');
    if (result.callsByStatus.state === 'ok') {
      expect(result.callsByStatus.expired).toBe(1);
      expect(result.callsByStatus.total).toBe(1);
    }
    expect(result.fillTime).toEqual({ state: 'amostra-insuficiente' });
  });

  it('chamado filled com first_claim_at 6 min depois do created_at entra na média', () => {
    const call = {
      id: 'call-filled',
      job_id: 'job-1',
      company_id: 'company-1',
      reason: 'reforco',
      status: 'filled',
      created_at: '2026-08-05T10:00:00.000Z',
      first_claim_at: '2026-08-05T10:06:00.000Z', origin: 'team',
    };
    const raw = emptyRaw({ shiftCalls: [call] });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.fillTime.state).toBe('ok');
    if (result.fillTime.state === 'ok') {
      expect(result.fillTime.sampleCount).toBe(1);
      expect(result.fillTime.averageLabel).toBe('6 min');
    }
  });

  it('mistura de chamados expired/filled/cancelled/open — nenhum status omitido, mesmo com 0', () => {
    const calls = [
      { id: 'c1', job_id: 'j1', company_id: 'company-1', reason: 'falta', status: 'expired', created_at: '2026-08-05T10:00:00.000Z', first_claim_at: null, origin: 'team' },
      { id: 'c2', job_id: 'j2', company_id: 'company-1', reason: 'evento', status: 'filled', created_at: '2026-08-06T10:00:00.000Z', first_claim_at: '2026-08-06T10:05:00.000Z', origin: 'team' },
    ];
    const raw = emptyRaw({ shiftCalls: calls });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.callsByStatus.state).toBe('ok');
    if (result.callsByStatus.state === 'ok') {
      expect(result.callsByStatus).toMatchObject({ open: 0, filled: 1, expired: 1, cancelled: 0, total: 2 });
    }
  });
});

// ---------------------------------------------------------------------------
// A6 — aceite por freela: recebidos < 2 → "—" (null); ordenação alfabética, nunca por métrica.
// ---------------------------------------------------------------------------

describe('A6/R12 — aceite por freela: amostra mínima e ordenação alfabética (nunca por métrica)', () => {
  it('1 alvo recebido → acceptanceRate null (amostra insuficiente)', () => {
    const call = { id: 'call-1', job_id: 'job-1', company_id: 'company-1', reason: 'outro', status: 'filled', created_at: '2026-08-05T10:00:00.000Z', first_claim_at: '2026-08-05T10:05:00.000Z', origin: 'team' };
    const target = { call_id: 'call-1', worker_id: 'worker-1', responded_at: '2026-08-05T10:05:00.000Z', response: 'accepted' };
    const raw = emptyRaw({ shiftCalls: [call], shiftCallTargets: [target], workers: new Map([['worker-1', { id: 'worker-1', full_name: 'Helo', rating_average: null }]]) });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.acceptanceByWorker.state).toBe('ok');
    if (result.acceptanceByWorker.state === 'ok') {
      expect(result.acceptanceByWorker.rows[0].acceptanceRate).toBeNull();
      expect(result.acceptanceByWorker.rows[0].received).toBe(1);
    }
  });

  it('ordena por nome (Zeca antes contaria mais aceites, mas Ana vem primeiro alfabeticamente)', () => {
    const calls = [
      { id: 'call-a', job_id: 'job-a', company_id: 'company-1', reason: 'outro', status: 'filled', created_at: '2026-08-05T10:00:00.000Z', first_claim_at: '2026-08-05T10:05:00.000Z', origin: 'team' },
      { id: 'call-b', job_id: 'job-b', company_id: 'company-1', reason: 'outro', status: 'filled', created_at: '2026-08-06T10:00:00.000Z', first_claim_at: '2026-08-06T10:05:00.000Z', origin: 'team' },
    ];
    const targets = [
      { call_id: 'call-a', worker_id: 'worker-zeca', responded_at: '2026-08-05T10:05:00.000Z', response: 'accepted' },
      { call_id: 'call-b', worker_id: 'worker-zeca', responded_at: '2026-08-06T10:05:00.000Z', response: 'accepted' },
      { call_id: 'call-a', worker_id: 'worker-ana', responded_at: null, response: 'declined' },
    ];
    const workers = new Map([
      ['worker-zeca', { id: 'worker-zeca', full_name: 'Zeca', rating_average: null }],
      ['worker-ana', { id: 'worker-ana', full_name: 'Ana', rating_average: null }],
    ]);
    const raw = emptyRaw({ shiftCalls: calls, shiftCallTargets: targets, workers });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.acceptanceByWorker.state).toBe('ok');
    if (result.acceptanceByWorker.state === 'ok') {
      expect(result.acceptanceByWorker.rows.map((r) => r.workerName)).toEqual(['Ana', 'Zeca']);
    }
  });

  // Débitos #12 e #14 — a policy do SOS só deixa a empresa ver o alvo que ACEITOU. Se o chamado de
  // urgência entrasse nesta conta, ele apareceria sempre com 100% de aceitação e os alcançados que
  // recusaram sumiriam do denominador, favorecendo o SOS sistematicamente sem sinal na tela.
  it('chamado SOS fica FORA da taxa de aceitação (só entra o que dá para medir inteiro)', () => {
    const calls = [
      { id: 'call-team', job_id: 'job-1', company_id: 'company-1', reason: 'outro', status: 'filled', created_at: '2026-08-05T10:00:00.000Z', first_claim_at: '2026-08-05T10:05:00.000Z', origin: 'team' },
      { id: 'call-sos', job_id: 'job-2', company_id: 'company-1', reason: 'falta', status: 'filled', created_at: '2026-08-06T10:00:00.000Z', first_claim_at: '2026-08-06T10:05:00.000Z', origin: 'sos' },
    ];
    const targets = [
      // elenco: dois recebidos, um aceite -> 50%
      { call_id: 'call-team', worker_id: 'worker-1', responded_at: '2026-08-05T10:05:00.000Z', response: 'accepted' },
      { call_id: 'call-team', worker_id: 'worker-1', responded_at: '2026-08-05T10:06:00.000Z', response: 'declined' },
      // SOS: só o aceite é visível pela RLS. Se contasse, viraria 3/2 e distorceria a taxa.
      { call_id: 'call-sos', worker_id: 'worker-1', responded_at: '2026-08-06T10:05:00.000Z', response: 'accepted' },
    ];
    const workers = new Map([['worker-1', { id: 'worker-1', full_name: 'Ana', rating_average: null }]]);
    const raw = emptyRaw({ shiftCalls: calls, shiftCallTargets: targets, workers });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.acceptanceByWorker.state).toBe('ok');
    if (result.acceptanceByWorker.state === 'ok') {
      const ana = result.acceptanceByWorker.rows.find((r) => r.workerName === 'Ana');
      expect(ana?.received).toBe(2);        // só os do chamado de elenco
      expect(ana?.accepted).toBe(1);
      expect(ana?.acceptanceRate).toBe(0.5); // seria 2/3 = 0.67 se o SOS entrasse
    }
  });
});

// ---------------------------------------------------------------------------
// A8/R14 — cancelamentos combinados empresa+freela (sem cancelled_by), independente do no-show.
// ---------------------------------------------------------------------------

describe('A8/R14 — cancelamentos: contagem isolada do no-show (R13 vs R14)', () => {
  it('application cancelada no período soma em cancelledCount, não em noShowCount', () => {
    const job = {
      id: 'job-cancel',
      company_id: 'company-1',
      status: 'cancelled',
      start_date: jobStartDate('2026-08-07'),
      created_at: jobStartDate('2026-08-07'),
      work_start_time: '08:00',
      work_end_time: '16:00',
      estimated_hours: 8,
      budget: 100,
    };
    const application = {
      id: 'app-cancel',
      job_id: job.id,
      worker_id: 'worker-1',
      status: 'cancelled',
      worker_checkin_at: null,
      worker_checkout_at: null,
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
    };
    const raw = emptyRaw({ jobs: [job], applications: [application], workers: new Map([['worker-1', { id: 'worker-1', full_name: 'Ivo', rating_average: null }]]) });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.attendanceByWorker.state).toBe('ok');
    if (result.attendanceByWorker.state === 'ok') {
      expect(result.attendanceByWorker.rows[0].cancelledCount).toBe(1);
      expect(result.attendanceByWorker.rows[0].noShowCount).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// A11/R16 — desempenho: rating global e concluídos-com-você NUNCA combinados; sem score/ranking.
// ---------------------------------------------------------------------------

describe('A11/R16 — desempenho por freela: métricas separadas, sem score único', () => {
  it('expõe ratingAverage (global) e completedWithCompanyCount separadamente', () => {
    const job = {
      id: 'job-perf',
      company_id: 'company-1',
      status: 'completed',
      start_date: jobStartDate('2026-08-09'),
      created_at: jobStartDate('2026-08-09'),
      work_start_time: '08:00',
      work_end_time: '16:00',
      estimated_hours: 8,
      budget: 100,
    };
    const application = {
      id: 'app-perf',
      job_id: job.id,
      worker_id: 'worker-1',
      status: 'completed',
      worker_checkin_at: null,
      worker_checkout_at: null,
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
    };
    const raw = emptyRaw({ jobs: [job], applications: [application], workers: new Map([['worker-1', { id: 'worker-1', full_name: 'Julia', rating_average: 4.8 }]]) });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.performanceByWorker.state).toBe('ok');
    if (result.performanceByWorker.state === 'ok') {
      const row = result.performanceByWorker.rows[0];
      expect(row.ratingAverage).toBe(4.8);
      expect(row.completedWithCompanyCount).toBe(1);
      // Nenhum campo "score" deve existir no shape.
      expect((row as unknown as Record<string, unknown>).score).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// A16 — truncamento sobe para o topo, e é intacto pela agregação (a UI decide o que renderizar).
// ---------------------------------------------------------------------------

describe('A16 — truncated sobe intacto de RawAnalyticsData para OperationAnalytics', () => {
  it('truncated: true na coleta permanece true no agregado', () => {
    const raw = emptyRaw({ truncated: true });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A16 — hasError sobe intacto de RawAnalyticsData para OperationAnalytics (mesma garantia de
// `truncated`, mas para C-ANALYTICS-ERRO-VIRA-VAZIO: erro de leitura NUNCA pode virar "sem-fonte").
// ---------------------------------------------------------------------------

describe('A16 — hasError sobe intacto de RawAnalyticsData para OperationAnalytics', () => {
  it('hasError: true na coleta permanece true no agregado, mesmo com blocos em sem-fonte', () => {
    const raw = emptyRaw({ hasError: true });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.hasError).toBe(true);
    expect(result.hires).toEqual({ state: 'sem-fonte' });
  });
});

// ---------------------------------------------------------------------------
// Delta vs. período anterior de mesma duração (R5/A1) — período de 31 dias (agosto inteiro).
// ---------------------------------------------------------------------------

describe('R5/A1 — delta vs. período anterior de mesma duração', () => {
  it('gasto do período atual vs. anterior calcula percentChange corretamente', () => {
    const current = { job_id: 'job-cur', worker_id: 'worker-1', amount: 200, status: 'recorded', paid_at: '2026-08-15T12:00:00.000Z' };
    // Período anterior de mesma duração (31 dias) = 01/07 a 31/07.
    const previous = { job_id: 'job-prev', worker_id: 'worker-1', amount: 100, status: 'recorded', paid_at: '2026-07-15T12:00:00.000Z' };
    const raw = emptyRaw({ shiftPayments: [current, previous] });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.spend.state).toBe('ok');
    if (result.spend.state === 'ok') {
      expect(result.spend.totalAmount).toBe(200);
      expect(result.spend.delta.previous).toBe(100);
      expect(result.spend.delta.percentChange).toBe(100); // dobrou = +100%
    }
  });

  it('sem dado no período anterior: previous e percentChange ficam null (não "0%")', () => {
    const current = { job_id: 'job-cur2', worker_id: 'worker-1', amount: 300, status: 'recorded', paid_at: '2026-08-15T12:00:00.000Z' };
    const raw = emptyRaw({ shiftPayments: [current] });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.spend.state).toBe('ok');
    if (result.spend.state === 'ok') {
      expect(result.spend.delta.previous).toBeNull();
      expect(result.spend.delta.percentChange).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// D5.3 — toda linha por freela carrega companyId (preparado para F13, mesmo sem UI de grupo v1).
// ---------------------------------------------------------------------------

describe('D5.3 — linhas por freela carregam companyId de origem', () => {
  it('WorkerAcceptanceRow carrega companyId do chamado', () => {
    const call = { id: 'call-scope', job_id: 'job-1', company_id: 'company-xyz', reason: 'outro', status: 'filled', created_at: '2026-08-05T10:00:00.000Z', first_claim_at: '2026-08-05T10:05:00.000Z', origin: 'team' };
    const target = { call_id: 'call-scope', worker_id: 'worker-1', responded_at: '2026-08-05T10:05:00.000Z', response: 'accepted' };
    const raw = emptyRaw({ shiftCalls: [call], shiftCallTargets: [target], workers: new Map([['worker-1', { id: 'worker-1', full_name: 'Kaio', rating_average: null }]]) });
    const result = aggregate(raw, PERIOD_AUGUST, DEPS);
    expect(result.acceptanceByWorker.state).toBe('ok');
    if (result.acceptanceByWorker.state === 'ok') {
      expect(result.acceptanceByWorker.rows[0].companyId).toBe('company-xyz');
    }
  });
});

// ---------------------------------------------------------------------------
// Dívida #17 (`C-ANALYTICS-A15-SEM-PROVA`) — cobertura de `collectRawData`/`resolveCompanyScope`/
// strings de `select`, através da API pública `OperationAnalyticsService.getOperationAnalytics`
// (nada foi exportado de produção só para testar). Usa o mock de `supabase` acima.
// ---------------------------------------------------------------------------

const PERIOD_COLLECT: OperationAnalyticsPeriod = { from: '2026-08-01', to: '2026-08-31' };

function makeJobRow(id: string, dateOnly: string | null, overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id,
    company_id: 'owner-1',
    status: 'completed',
    start_date: dateOnly ? jobStartDate(dateOnly) : null,
    created_at: dateOnly ? jobStartDate(dateOnly) : null,
    work_start_time: null,
    work_end_time: null,
    estimated_hours: null,
    budget: 100,
    ...overrides,
  };
}

beforeEach(() => {
  resetSupabaseMock();
});

describe('resolveCompanyScope — unidades OPERADAS (A15, dívida #17)', () => {
  it('empresa com companies.id = auth.uid() (sem outra empresa por owner_id): escopo é só o próprio id', async () => {
    // A sessao opera exatamente a empresa cujo id E o proprio uid.
    vi.mocked(getMyCompanies).mockResolvedValueOnce([{ company_id: 'owner-1' }] as never);

    const result = await OperationAnalyticsService.getOperationAnalytics(PERIOD_COLLECT);

    expect(result.scopeCompanyIds).toEqual(['owner-1']);
    expect(result.hasError).toBe(false);
  });

  it('empresa com owner_id = auth.uid() e id diferente: escopo inclui os dois ids, e jobs é lido com os dois', async () => {
    vi.mocked(getMyCompanies).mockResolvedValueOnce(
      [{ company_id: 'owner-1' }, { company_id: 'company-owned-2' }] as never,
    );
    setQueue('jobs', [{ data: [makeJobRow('job-1', '2026-08-10')], error: null }]);

    const result = await OperationAnalyticsService.getOperationAnalytics(PERIOD_COLLECT);

    expect(result.scopeCompanyIds).toEqual(['owner-1', 'company-owned-2']);
    // Prova que a ancoragem dupla não é só devolvida — é USADA na query de `jobs` (guarda 1 do PRD).
    expect(inArgsOf('jobs', 'company_id')).toEqual(['owner-1', 'company-owned-2']);
  });

  it('sem sessão (sem vínculo): devolve analytics vazio e não toca nenhuma outra fonte', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await OperationAnalyticsService.getOperationAnalytics(PERIOD_COLLECT);

    expect(result.scopeCompanyIds).toEqual([]);
    expect(result.hasError).toBe(false);
    expect(result.hires).toEqual({ state: 'sem-fonte' });
    expect(callLogsFor('jobs').length).toBe(0);
    expect(callLogsFor('companies').length).toBe(0);
  });

  it('erro ao resolver as unidades: hasError sobe, e o escopo cai para [userId] em vez de travar', async () => {
    vi.mocked(getMyCompanies).mockRejectedValueOnce(new Error('boom'));

    const result = await OperationAnalyticsService.getOperationAnalytics(PERIOD_COLLECT);

    expect(result.hasError).toBe(true);
    expect(result.scopeCompanyIds).toEqual(['owner-1']);
  });
});

describe('collectRawData — strings de select coluna a coluna (dívida #17)', () => {
  it('as 8 fontes selecionam exatamente as colunas esperadas, nenhuma a mais nem a menos', async () => {
    setQueue('companies', [{ data: [], error: null }]);
    setQueue('jobs', [{ data: [makeJobRow('job-1', '2026-08-10')], error: null }]);
    setQueue('applications', [
      {
        data: [
          {
            id: 'app-1',
            job_id: 'job-1',
            worker_id: 'worker-1',
            status: 'completed',
            worker_checkin_at: null,
            worker_checkout_at: null,
            company_checkin_confirmed_at: null,
            company_checkout_confirmed_at: null,
          },
        ],
        error: null,
      },
    ]);
    setQueue('shift_calls', [
      {
        data: [
          {
            id: 'call-1',
            job_id: 'job-1',
            company_id: 'owner-1',
            reason: 'falta',
            status: 'filled',
            created_at: jobStartDate('2026-08-10'),
            first_claim_at: jobStartDate('2026-08-10'),
          },
        ],
        error: null,
      },
    ]);
    setQueue('shift_call_targets', [
      { data: [{ call_id: 'call-1', worker_id: 'worker-1', responded_at: jobStartDate('2026-08-10'), response: 'accepted' }], error: null },
    ]);
    setQueue('workers', [{ data: [{ id: 'worker-1', full_name: 'Ana', rating_average: 4.5 }], error: null }]);

    await OperationAnalyticsService.getOperationAnalytics(PERIOD_COLLECT);

    // `companies` saiu da lista: o escopo de unidades passou a vir de getMyCompanies()
    // (RPC get_my_companies), que e o unico ponto que sabe de gerente. Nao ha mais
    // SELECT direto nessa tabela aqui.
    expect(selectArgOf('companies')).toBe('');
    expect(selectArgOf('jobs')).toBe(
      'id, company_id, status, start_date, created_at, work_start_time, work_end_time, estimated_hours, budget',
    );
    expect(selectArgOf('applications')).toBe(
      'id, job_id, worker_id, status, worker_checkin_at, worker_checkout_at, company_checkin_confirmed_at, company_checkout_confirmed_at',
    );
    expect(selectArgOf('shift_payments')).toBe('job_id, worker_id, amount, status, paid_at');
    expect(selectArgOf('escrow_transactions')).toBe('job_id, application_id, amount, status, released_at, captured_at');
    // `origin` entrou em 25/08 (débitos #12/#14): sem ele não dá para excluir o SOS da taxa de
    // aceitação, e o painel favoreceria o chamado de urgência em silêncio.
    expect(selectArgOf('shift_calls')).toBe('id, job_id, company_id, reason, status, created_at, first_claim_at, origin');
    expect(selectArgOf('shift_call_targets')).toBe('call_id, worker_id, responded_at, response');
    expect(selectArgOf('shift_attendance_confirmations')).toBe('job_id, requested_at, responded_at, response');
    expect(selectArgOf('workers')).toBe('id, full_name, rating_average');
  });
});

describe('collectRawData — laço de paginação que PRODUZ truncated (dívida #17)', () => {
  it(`atinge MAX_PAGES (${MAX_PAGES} páginas cheias de ${PAGE_SIZE}) → truncated sobe true`, async () => {
    const pages: QueueItem[] = Array.from({ length: MAX_PAGES }, (_, page) => ({
      data: Array.from({ length: PAGE_SIZE }, (_, i) => makeJobRow(`capA-${page}-${i}`, null)),
      error: null,
    }));
    setQueue('jobs', pages);

    const result = await OperationAnalyticsService.getOperationAnalytics(PERIOD_COLLECT);

    expect(result.truncated).toBe(true);
    // Prova que o laço de fato rodou MAX_PAGES vezes (uma invocação de `.from('jobs')` por página),
    // não que `truncated` veio hardcoded de alguma outra fonte.
    expect(callLogsFor('jobs').length).toBe(MAX_PAGES);
  });

  it('duas páginas (uma cheia, uma incompleta) → truncated false, e as linhas das DUAS páginas são agregadas', async () => {
    const page0 = Array.from({ length: PAGE_SIZE }, (_, i) => makeJobRow(`pageB0-${i}`, '2026-08-10'));
    const page1 = Array.from({ length: 3 }, (_, i) => makeJobRow(`pageB1-${i}`, '2026-08-10'));
    setQueue('jobs', [
      { data: page0, error: null },
      { data: page1, error: null },
    ]);

    const result = await OperationAnalyticsService.getOperationAnalytics(PERIOD_COLLECT);

    expect(result.truncated).toBe(false);
    expect(callLogsFor('jobs').length).toBe(2);
    expect(result.hires.state).toBe('ok');
    if (result.hires.state === 'ok') {
      // Se o laço parasse na primeira página, isto daria 1000 — só bate 1003 se as DUAS páginas
      // (1000 + 3) tiverem sido de fato coletadas e repassadas para `aggregate`.
      expect(result.hires.jobsCreatedCount).toBe(PAGE_SIZE + 3);
    }
  });
});
