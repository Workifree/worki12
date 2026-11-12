/**
 * CompanyOperationAnalytics — painel `/company/operacao` (F9).
 *
 * Ver `.harness/spec/analytics-operacao/prd.md` (fonte normativa). Consome
 * `OperationAnalyticsService.getOperationAnalytics()` — TODA a agregação já vem pronta
 * (`aggregate()` é pura, testada em isolado); esta página só busca, guarda estado local
 * (Article 5 — useState/useEffect, sem React Query) e desenha.
 *
 * Métrica de topo (G2, briefing item 5): tempo médio de preenchimento do chamado — hero
 * (`FillTimeHighlight`), não uma linha de tabela.
 *
 * Os quatro estados de bloco (D6) são tratados pelos componentes filhos via `MetricStateWrapper`;
 * o quarto estado ('loading') é tratado aqui com um skeleton neo-brutalista.
 */
import { useCallback, useEffect, useState } from 'react';
import { PainelNumerosTabs } from '../../components/company/PainelNumerosTabs';
import { OperationAnalyticsService, emptyAnalytics } from '../../services/operationAnalyticsService';
import type { OperationAnalyticsPeriod } from '../../services/operationAnalyticsService';
import type { OperationAnalytics } from '../../types';
import { todayInBrazil } from '../../lib/dateUtils';
import { logError } from '../../lib/logger';
import PageMeta from '../../components/PageMeta';
import { Card, Field, PageHeader } from '../../components/ui';
import { AnalyticsSkeleton } from '../../components/company/analytics/AnalyticsStates';
import { TruncatedBanner } from '../../components/company/analytics/TruncatedBanner';
import { ErrorBanner } from '../../components/company/analytics/ErrorBanner';
import { FillTimeHighlight } from '../../components/company/analytics/FillTimeHighlight';
import {
  CostPerHourCard,
  HiresCard,
  HoursRatioCard,
  SpendCard,
} from '../../components/company/analytics/SummaryCards';
import { CallsByReasonPanel, CallsByStatusPanel } from '../../components/company/analytics/CallsBreakdown';
import {
  WorkerAcceptancePanel,
  WorkerAttendancePanel,
  WorkerPerformancePanel,
} from '../../components/company/analytics/WorkerTables';
import { AttendanceConfirmationsPanel } from '../../components/company/analytics/AttendanceConfirmationsPanel';
import { formatCivilDateBR } from '../../components/company/analytics/format';

// ---------------------------------------------------------------------------
// Datas — período em data civil BRASILEIRA (D3 do PRD), NUNCA fuso do dispositivo.
// `todayInBrazil()` já vem de `lib/dateUtils` (Intl com timeZone explícito). A aritmética de
// calendário abaixo (início de semana/mês) opera só sobre a string YYYY-MM-DD, em UTC puro —
// mesma técnica usada dentro do service (nunca `new Date('YYYY-MM-DD')` cru).
// ---------------------------------------------------------------------------

type PresetKey = 'hoje' | 'semana' | 'mes' | 'custom';

function parseYMD(dateOnly: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateOnly.split('-').map(Number);
  return { y, m, d };
}

function addDaysCivil(dateOnly: string, days: number): string {
  const { y, m, d } = parseYMD(dateOnly);
  const ms = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Domingo da semana civil BR que contém `dateOnly` (0 = domingo, mesma convenção do resto do app). */
function startOfWeekCivil(dateOnly: string): string {
  const { y, m, d } = parseYMD(dateOnly);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDaysCivil(dateOnly, -weekday);
}

function startOfMonthCivil(dateOnly: string): string {
  const { y, m } = parseYMD(dateOnly);
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

const PRESET_LABELS: Record<Exclude<PresetKey, 'custom'>, string> = {
  hoje: 'Hoje',
  semana: 'Semana',
  mes: 'Mês',
};

export default function CompanyOperationAnalytics() {
  const today = todayInBrazil();

  const [preset, setPreset] = useState<PresetKey>('mes');
  const [from, setFrom] = useState<string>(startOfMonthCivil(today));
  const [to, setTo] = useState<string>(today);

  const [analytics, setAnalytics] = useState<OperationAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const period: OperationAnalyticsPeriod = { from, to };
      const result = await OperationAnalyticsService.getOperationAnalytics(period);
      setAnalytics(result);
    } catch (error) {
      logError('CompanyOperationAnalytics.fetchAnalytics', error);
      // `OperationAnalyticsService.getOperationAnalytics` já captura seus próprios erros e nunca
      // deveria lançar — mas se lançar mesmo assim, cair para `null` deixaria a tela presa no
      // skeleton para sempre (silenciosa como o próprio bug que estamos corrigindo). Em vez
      // disso, monta o mesmo formato "sem-fonte + hasError" que o service devolveria.
      setAnalytics(emptyAnalytics(true));
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  function applyPreset(key: Exclude<PresetKey, 'custom'>) {
    if (key === 'hoje') {
      setFrom(today);
      setTo(today);
    } else if (key === 'semana') {
      setFrom(startOfWeekCivil(today));
      setTo(today);
    } else {
      setFrom(startOfMonthCivil(today));
      setTo(today);
    }
    setPreset(key);
  }

  function handleCustomDateChange(which: 'from' | 'to', value: string) {
    setPreset('custom');
    if (which === 'from') setFrom(value);
    else setTo(value);
  }

  const periodLabel = `${formatCivilDateBR(from)} a ${formatCivilDateBR(to)}`;

  return (
    <div className="flex flex-col gap-6 pb-20 md:pb-12 font-sans text-accent max-w-6xl mx-auto">
      <PageMeta title="Analytics de Operação" />

      <div>
        <PainelNumerosTabs />
        {/* Espelho do subtitulo do Relatorio de Pagamentos: cada pagina diz o que responde. */}
        <PageHeader
          title="Analytics de Operação"
          subtitle="Como a operação está rodando: chamados, tempo de preenchimento, presença e aceite. Somente leitura, não move saldo."
          className="!mb-0"
        />
      </div>

      {/* Seletor de período */}
      <Card className="flex flex-col gap-4">
        <div role="group" aria-label="Período" className="flex flex-wrap gap-2 self-start">
          {(['hoje', 'semana', 'mes'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key)}
              aria-pressed={preset === key}
              className={`h-11 px-5 rounded-full border-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                preset === key ? 'bg-black text-white border-black' : 'bg-white text-gray-700 border-gray-300 hover:border-black'
              }`}
            >
              {PRESET_LABELS[key]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="De">
            <input
              id="analyticsFromInput"
              type="date"
              value={from}
              max={to}
              onChange={(e) => handleCustomDateChange('from', e.target.value)}
            />
          </Field>
          <Field label="Até">
            <input
              id="analyticsToInput"
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => handleCustomDateChange('to', e.target.value)}
            />
          </Field>
        </div>
        <p className="text-xs text-gray-600">Período: {periodLabel}</p>
      </Card>

      {loading || !analytics ? (
        <AnalyticsSkeleton rows={5} />
      ) : (
        <>
          {analytics.hasError && <ErrorBanner onRetry={fetchAnalytics} />}
          {analytics.truncated && <TruncatedBanner />}

          {/* Métrica de topo (G2) */}
          <FillTimeHighlight block={analytics.fillTime} />

          {/* Os quatro números da planilha (G1) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <SpendCard block={analytics.spend} />
            <HiresCard block={analytics.hires} />
            <CostPerHourCard block={analytics.costPerHour} />
            <HoursRatioCard block={analytics.hoursRatio} />
          </div>

          {/* Demanda não atendida / motivo da quebra (G3) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CallsByStatusPanel block={analytics.callsByStatus} />
            <CallsByReasonPanel block={analytics.callsByReason} />
          </div>

          <AttendanceConfirmationsPanel block={analytics.attendanceConfirmations} />

          {/* Blocos por freela — componentes lado a lado, alfabético, sem ranking (D4) */}
          <div className="flex flex-col gap-4">
            <WorkerAcceptancePanel block={analytics.acceptanceByWorker} />
            <WorkerAttendancePanel block={analytics.attendanceByWorker} />
            <WorkerPerformancePanel block={analytics.performanceByWorker} />
          </div>
        </>
      )}
    </div>
  );
}
