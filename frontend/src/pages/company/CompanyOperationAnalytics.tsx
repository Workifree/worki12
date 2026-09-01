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
import { Link } from 'react-router-dom';
import { BarChart3, Calendar } from 'lucide-react';
import { OperationAnalyticsService, emptyAnalytics } from '../../services/operationAnalyticsService';
import type { OperationAnalyticsPeriod } from '../../services/operationAnalyticsService';
import type { OperationAnalytics } from '../../types';
import { todayInBrazil } from '../../lib/dateUtils';
import { logError } from '../../lib/logger';
import PageMeta from '../../components/PageMeta';
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

      <header>
        <h1 className="text-3xl md:text-4xl font-black uppercase tracking-tighter mb-2 flex items-center gap-3">
          <BarChart3 size={32} strokeWidth={3} /> Analytics de Operação
        </h1>
        {/* Espelho do subtitulo do Relatorio de Pagamentos: cada pagina diz o que responde. */}
        <p className="text-sm font-bold text-gray-500 mt-1">
          Como a operação está rodando: chamados, tempo de preenchimento, presença e aceite.
          Procurando valores pagos e exportação? Veja{' '}
          <Link to="/company/relatorio" className="underline font-black">Pagamentos</Link>.
        </p>
        <p className="text-gray-500 text-sm max-w-2xl">
          Gasto, custo por hora, tempo de preenchimento e presença por freela — o que hoje você monta na mão,
          automatizado. Somente leitura, não move saldo.
        </p>
      </header>

      {/* Seletor de período */}
      <div className="bg-white border-2 border-black rounded-2xl p-5 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-4">
        <div className="flex flex-wrap gap-3">
          {(['hoje', 'semana', 'mes'] as const).map((key) => (
            <button
              key={key}
              onClick={() => applyPreset(key)}
              className={`px-5 py-2.5 rounded-xl border-2 font-black uppercase text-sm transition-all min-h-[44px]
                ${preset === key
                  ? 'bg-black text-white border-black shadow-[4px_4px_0px_0px_rgba(37,99,235,1)]'
                  : 'bg-white text-gray-500 border-black hover:bg-gray-100'
                }`}
            >
              {PRESET_LABELS[key]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="analyticsFromInput" className="block text-xs font-black uppercase text-gray-500 mb-1">
              De
            </label>
            <div className="relative">
              <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="analyticsFromInput"
                type="date"
                value={from}
                max={to}
                onChange={(e) => handleCustomDateChange('from', e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 border-2 border-black rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-primary min-h-[44px]"
              />
            </div>
          </div>
          <div>
            <label htmlFor="analyticsToInput" className="block text-xs font-black uppercase text-gray-500 mb-1">
              Até
            </label>
            <div className="relative">
              <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="analyticsToInput"
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={(e) => handleCustomDateChange('to', e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 border-2 border-black rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-primary min-h-[44px]"
              />
            </div>
          </div>
        </div>
        <p className="text-xs font-bold text-gray-400">Período: {periodLabel}</p>
      </div>

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
