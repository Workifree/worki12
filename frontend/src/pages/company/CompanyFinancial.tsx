/**
 * CompanyFinancial — Dashboard financeiro da empresa (Slice 3, R12-R16).
 *
 * Seções:
 *  1. Teto de gasto: configurar limite mensal + barra de progresso colorida.
 *  2. Faturamento: CTA se não informado; exibe valor quando declarado.
 *  3. BI: ratio custo/hora + custo-%-faturamento; gasto por freela; custo de no-show; flags de concentração.
 *  4. Seletor de período: mês atual / mês anterior.
 *
 * Padrões: useState + useEffect, imports relativos, TS strict, design neo-brutalista empresa.
 */

import { useState } from 'react';
import {
  TrendingDown,
  AlertTriangle,
  BarChart2,
  Users,
  Clock,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import { useSpendLimit, useFinancialBI } from '../../hooks/useFinancialBI';
import { customPeriod, currentMonthPeriod } from '../../services/financialBIService';
import type { BIPeriod } from '../../services/financialBIService';
import { useToast } from '../../contexts/ToastContext';

// ---------------------------------------------------------------------------
// Helpers de formatacao
// ---------------------------------------------------------------------------

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatHours(h: number): string {
  if (h === 0) return '0h';
  return `${h.toFixed(1)}h`;
}

function formatPercent(v: number): string {
  return `${v.toFixed(1)}%`;
}

// Retorna o periodo do mes anterior
function previousMonthPeriod(): BIPeriod {
  const now = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const y = firstOfPrev.getFullYear();
  const m = String(firstOfPrev.getMonth() + 1).padStart(2, '0');
  const fy = firstOfThisMonth.getFullYear();
  const fm = String(firstOfThisMonth.getMonth() + 1).padStart(2, '0');
  return customPeriod(`${y}-${m}-01`, `${fy}-${fm}-01`);
}

function periodLabel(p: BIPeriod): string {
  const d = new Date(p.start + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Subcomponente: SpendLimitCard
// ---------------------------------------------------------------------------

interface SpendLimitCardProps {
  spendLimitAmount: number | null;
  accumulatedSpend: number;
  loading: boolean;
  onSave: (amount: number, thresholds: number[]) => Promise<boolean>;
}

function SpendLimitCard({ spendLimitAmount, accumulatedSpend, loading, onSave }: SpendLimitCardProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const pct = spendLimitAmount && spendLimitAmount > 0
    ? Math.min((accumulatedSpend / spendLimitAmount) * 100, 100)
    : 0;

  const barColor =
    pct >= 100
      ? 'bg-red-600'
      : pct >= 90
        ? 'bg-red-400'
        : pct >= 80
          ? 'bg-yellow-400'
          : 'bg-blue-600';

  const textColor =
    pct >= 100
      ? 'text-red-600'
      : pct >= 90
        ? 'text-red-500'
        : pct >= 80
          ? 'text-yellow-600'
          : 'text-blue-600';

  async function handleSave() {
    const parsed = parseFloat(inputValue.replace(',', '.'));
    if (isNaN(parsed) || parsed <= 0) {
      addToast('Informe um valor valido maior que zero.', 'error');
      return;
    }
    setSaving(true);
    const ok = await onSave(parsed, [80, 90, 100]);
    setSaving(false);
    if (ok) {
      addToast('Teto de gasto salvo!', 'success');
      setEditing(false);
      setInputValue('');
    } else {
      addToast('Erro ao salvar o teto. Tente novamente.', 'error');
    }
  }

  if (loading) {
    return (
      <div className="bg-white border-2 border-black rounded-2xl p-6 animate-pulse space-y-4">
        <div className="h-6 bg-gray-200 rounded-xl w-1/3" />
        <div className="h-4 bg-gray-200 rounded-xl w-2/3" />
        <div className="h-4 bg-gray-200 rounded-xl w-full" />
      </div>
    );
  }

  return (
    <div className="bg-white border-2 border-black rounded-2xl p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <DollarSign size={20} strokeWidth={3} />
          <h2 className="text-xl font-black uppercase">Teto de Gasto Mensal</h2>
        </div>
        <button
          onClick={() => {
            setEditing((e) => !e);
            setInputValue(spendLimitAmount ? String(spendLimitAmount) : '');
          }}
          className="text-sm font-black uppercase px-4 py-2 rounded-xl border-2 border-black hover:bg-black hover:text-white transition-colors"
          aria-label={editing ? 'Cancelar edicao do teto' : 'Editar teto de gasto'}
        >
          {editing ? 'Cancelar' : spendLimitAmount ? 'Editar' : 'Configurar'}
        </button>
      </div>

      {editing ? (
        <div className="space-y-3">
          <label htmlFor="spendLimitInput" className="block text-sm font-black uppercase text-gray-600">
            Novo teto mensal (R$)
          </label>
          <input
            id="spendLimitInput"
            type="number"
            min="1"
            step="0.01"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Ex: 5000,00"
            className="w-full border-2 border-black rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary text-lg font-bold tabular-nums"
          />
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <Info size={12} />
            Alertas in-app ao atingir 80%, 90% e 100% do teto. WhatsApp em breve.
          </p>
          <button
            onClick={handleSave}
            disabled={saving || !inputValue}
            className="w-full bg-black hover:bg-primary text-white px-6 py-3 rounded-xl font-black uppercase transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Salvando...' : 'Salvar Teto'}
          </button>
        </div>
      ) : spendLimitAmount && spendLimitAmount > 0 ? (
        <div className="space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs font-bold uppercase text-gray-500">Gasto acumulado</p>
              <p className={`text-2xl font-black tabular-nums ${textColor}`}>{formatBRL(accumulatedSpend)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold uppercase text-gray-500">Teto</p>
              <p className="text-2xl font-black tabular-nums">{formatBRL(spendLimitAmount)}</p>
            </div>
          </div>
          {/* Barra de progresso */}
          <div
            className="w-full bg-gray-100 border-2 border-black rounded-full h-5 overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progresso do teto de gasto: ${Math.round(pct)}%`}
          >
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className={`text-sm font-bold tabular-nums ${textColor}`}>
            {formatPercent(pct)} utilizado
            {pct >= 100 && ' — Teto ultrapassado!'}
            {pct >= 90 && pct < 100 && ' — Atencao: proximo do limite!'}
          </p>
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <Info size={12} />
            Alertas in-app ao atingir 80%, 90% e 100%. WhatsApp em breve.
          </p>
        </div>
      ) : (
        <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-4 text-center">
          <p className="text-sm text-gray-500 font-bold">Nenhum teto configurado.</p>
          <p className="text-xs text-gray-400 mt-1">Configure para receber alertas antes de estourar o orcamento.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponente: RevenueCard
// ---------------------------------------------------------------------------

interface RevenueCardProps {
  monthlyRevenueAmount: number | null;
  loading: boolean;
  onSave: (amount: number) => Promise<boolean>;
}

function RevenueCard({ monthlyRevenueAmount, loading, onSave }: RevenueCardProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  async function handleSave() {
    const parsed = parseFloat(inputValue.replace(',', '.'));
    if (isNaN(parsed) || parsed < 0) {
      addToast('Informe um valor valido (use 0 se nao houve faturamento).', 'error');
      return;
    }
    setSaving(true);
    const ok = await onSave(parsed);
    setSaving(false);
    if (ok) {
      addToast('Faturamento salvo!', 'success');
      setEditing(false);
      setInputValue('');
    } else {
      addToast('Erro ao salvar o faturamento. Tente novamente.', 'error');
    }
  }

  if (loading) {
    return (
      <div className="bg-white border-2 border-black rounded-2xl p-6 animate-pulse space-y-4">
        <div className="h-6 bg-gray-200 rounded-xl w-1/2" />
        <div className="h-4 bg-gray-200 rounded-xl w-full" />
      </div>
    );
  }

  return (
    <div className="bg-white border-2 border-black rounded-2xl p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingDown size={20} strokeWidth={3} />
          <h2 className="text-xl font-black uppercase">Faturamento do Mes</h2>
        </div>
        <button
          onClick={() => {
            setEditing((e) => !e);
            setInputValue(monthlyRevenueAmount != null ? String(monthlyRevenueAmount) : '');
          }}
          className="text-sm font-black uppercase px-4 py-2 rounded-xl border-2 border-black hover:bg-black hover:text-white transition-colors"
          aria-label={editing ? 'Cancelar edicao do faturamento' : 'Informar faturamento do mes'}
        >
          {editing ? 'Cancelar' : monthlyRevenueAmount != null ? 'Atualizar' : 'Informar'}
        </button>
      </div>

      {editing ? (
        <div className="space-y-3">
          <label htmlFor="revenueInput" className="block text-sm font-black uppercase text-gray-600">
            Faturamento bruto do mes (R$)
          </label>
          <input
            id="revenueInput"
            type="number"
            min="0"
            step="0.01"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Ex: 50000,00"
            className="w-full border-2 border-black rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary text-lg font-bold tabular-nums"
          />
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <Info size={12} />
            Usado para calcular custo de freelas como % do faturamento. Nao compartilhado externamente.
          </p>
          <button
            onClick={handleSave}
            disabled={saving || inputValue === ''}
            className="w-full bg-black hover:bg-primary text-white px-6 py-3 rounded-xl font-black uppercase transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Salvando...' : 'Salvar Faturamento'}
          </button>
        </div>
      ) : monthlyRevenueAmount != null ? (
        <div>
          <p className="text-xs font-bold uppercase text-gray-500">Faturamento declarado</p>
          <p className="text-3xl font-black tabular-nums text-blue-600">{formatBRL(monthlyRevenueAmount)}</p>
          <p className="text-xs text-gray-500 mt-1">Destrava o indicador custo-%-faturamento no painel abaixo.</p>
        </div>
      ) : (
        <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-4 text-center">
          <p className="text-sm text-gray-500 font-bold">Nenhum faturamento informado.</p>
          <p className="text-xs text-blue-600 mt-1 font-bold">Informe para desbloquear o indicador de custo-%-faturamento.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponente: SkeletonBI
// ---------------------------------------------------------------------------

function SkeletonBI() {
  return (
    <div className="space-y-6 animate-pulse">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-white border-2 border-black rounded-2xl p-6 space-y-4">
          <div className="h-6 bg-gray-200 rounded-xl w-1/3" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="h-16 bg-gray-200 rounded-xl" />
            <div className="h-16 bg-gray-200 rounded-xl" />
          </div>
          <div className="space-y-3">
            {[...Array(3)].map((_, j) => (
              <div key={j} className="h-14 bg-gray-200 rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagina principal
// ---------------------------------------------------------------------------

type PeriodKey = 'current' | 'previous';

export default function CompanyFinancial() {
  const [periodKey, setPeriodKey] = useState<PeriodKey>('current');
  const [showSpendWorkerAll, setShowSpendWorkerAll] = useState(false);

  const period: BIPeriod = periodKey === 'current' ? currentMonthPeriod() : previousMonthPeriod();

  const {
    spendLimit,
    monthlyRevenue,
    loading: limitLoading,
    upsertSpendLimit,
    upsertMonthlyRevenue,
  } = useSpendLimit();

  const {
    data,
    loading: biLoading,
    error: biError,
    refresh: refreshBI,
  } = useFinancialBI(period);

  const accumulatedSpend = data?.accumulatedSpend.totalAmount ?? 0;
  const spendByWorker = data?.spendByWorker ?? [];
  const costRatio = data?.costRatio;
  const noShowCost = data?.noShowCost;
  const concentrationFlags = data?.concentrationFlags ?? [];

  const WORKER_PREVIEW = 5;
  const workersToShow = showSpendWorkerAll ? spendByWorker : spendByWorker.slice(0, WORKER_PREVIEW);
  const flaggedWorkers = concentrationFlags.filter((f) => f.flagged);

  async function handleSaveLimit(amount: number, thresholds: number[]): Promise<boolean> {
    const ok = await upsertSpendLimit({ amount, alertThresholds: thresholds });
    if (ok) refreshBI();
    return ok;
  }

  async function handleSaveRevenue(amount: number): Promise<boolean> {
    const ok = await upsertMonthlyRevenue(amount);
    if (ok) refreshBI();
    return ok;
  }

  return (
    <div className="flex flex-col gap-8 pb-20 md:pb-12 font-sans text-accent max-w-4xl mx-auto">

      {/* Header */}
      <header>
        <h1 className="text-4xl font-black uppercase tracking-tighter mb-2">Financeiro</h1>
        <p className="text-gray-500 text-sm">Controle de gasto, faturamento e indicadores de freelas.</p>
      </header>

      {/* Seletor de periodo */}
      <div className="flex gap-3">
        {(['current', 'previous'] as PeriodKey[]).map((key) => {
          const p = key === 'current' ? currentMonthPeriod() : previousMonthPeriod();
          const isActive = periodKey === key;
          return (
            <button
              key={key}
              onClick={() => setPeriodKey(key)}
              className={`px-5 py-2.5 rounded-xl border-2 font-black uppercase text-sm transition-all
                ${isActive
                  ? 'bg-black text-white border-black shadow-[4px_4px_0px_0px_rgba(0,166,81,1)]'
                  : 'bg-white text-gray-500 border-black hover:bg-gray-100'
                }`}
            >
              {periodLabel(p)}
            </button>
          );
        })}
      </div>

      {/* Teto + Faturamento */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <SpendLimitCard
          spendLimitAmount={spendLimit?.amount ?? null}
          accumulatedSpend={accumulatedSpend}
          loading={limitLoading}
          onSave={handleSaveLimit}
        />
        <RevenueCard
          monthlyRevenueAmount={monthlyRevenue?.amount ?? null}
          loading={limitLoading}
          onSave={handleSaveRevenue}
        />
      </div>

      {/* BI Section */}
      {biLoading ? (
        <SkeletonBI />
      ) : biError ? (
        <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6 text-center">
          <p className="font-black text-red-600 uppercase text-sm">{biError}</p>
          <button
            onClick={refreshBI}
            className="mt-3 px-6 py-2 rounded-xl border-2 border-black font-black uppercase text-sm hover:bg-black hover:text-white transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      ) : !data || (accumulatedSpend === 0 && spendByWorker.length === 0) ? (
        <div className="bg-white border-2 border-black rounded-2xl p-10 text-center shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
          <BarChart2 size={40} className="mx-auto mb-4 text-gray-300" />
          <p className="font-black text-gray-500 uppercase text-sm">Nenhum dado no periodo selecionado.</p>
          <p className="text-xs text-gray-400 mt-1">Os indicadores aparecem conforme os turnos sao concluidos.</p>
        </div>
      ) : (
        <div className="space-y-6">

          {/* BI-3: Ratio custo/hora + custo-%-faturamento */}
          {costRatio && (
            <section className="bg-white border-2 border-black rounded-2xl p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex items-center gap-2 mb-5">
                <BarChart2 size={20} strokeWidth={3} />
                <h2 className="text-xl font-black uppercase">Indicadores de Custo</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Custo total */}
                <div className="bg-gray-50 border-2 border-black rounded-xl p-4">
                  <p className="text-xs font-black uppercase text-gray-500 mb-1">Custo Total</p>
                  <p className="text-2xl font-black tabular-nums">{formatBRL(costRatio.totalCost)}</p>
                  <p className="text-xs text-gray-400 mt-1">{costRatio.totalHours > 0 ? `${formatHours(costRatio.totalHours)} de trabalho` : 'Sem horas registradas'}</p>
                </div>

                {/* Custo por hora */}
                <div className="bg-gray-50 border-2 border-black rounded-xl p-4">
                  <p className="text-xs font-black uppercase text-gray-500 mb-1">Custo / Hora</p>
                  {costRatio.costPerHour != null ? (
                    <p className="text-2xl font-black tabular-nums">{formatBRL(costRatio.costPerHour)}<span className="text-sm font-bold">/h</span></p>
                  ) : (
                    <p className="text-sm text-gray-400 font-bold">—</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">Media no periodo</p>
                </div>

                {/* Custo % faturamento */}
                <div className={`border-2 rounded-xl p-4 ${costRatio.costPercentRevenue != null ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-dashed border-gray-300'}`}>
                  <p className="text-xs font-black uppercase text-gray-500 mb-1">Custo % Faturamento</p>
                  {costRatio.costPercentRevenue != null ? (
                    <>
                      <p className="text-2xl font-black tabular-nums text-blue-600">{formatPercent(costRatio.costPercentRevenue)}</p>
                      <p className="text-xs text-gray-400 mt-1">do faturamento declarado</p>
                    </>
                  ) : (
                    <div>
                      <p className="text-sm text-gray-400 font-bold">Bloqueado</p>
                      <p className="text-xs text-blue-600 mt-1 font-bold">Informe o faturamento acima para desbloquear.</p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* BI-2: Gasto por freela */}
          {spendByWorker.length > 0 && (
            <section className="bg-white border-2 border-black rounded-2xl p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Users size={20} strokeWidth={3} />
                  <h2 className="text-xl font-black uppercase">Gasto por Freela</h2>
                </div>
                <span className="text-xs font-bold bg-gray-100 text-gray-600 px-2 py-1 rounded-full border-2 border-black">
                  {spendByWorker.length} freela{spendByWorker.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div id="spend-worker-list" className="space-y-3">
                {workersToShow.map((w, idx) => (
                  <div key={w.workerId} className="flex items-center gap-4 bg-gray-50 border-2 border-black rounded-xl p-4 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all">
                    {/* Ranking */}
                    <span className="text-lg font-black text-gray-400 w-6 text-center shrink-0">{idx + 1}</span>

                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-xl border-2 border-black bg-gray-200 shrink-0 overflow-hidden flex items-center justify-center">
                      {w.workerAvatarUrl ? (
                        <img src={w.workerAvatarUrl} alt={w.workerName} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-base font-black text-gray-500">{w.workerName.charAt(0).toUpperCase()}</span>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-sm truncate">{w.workerName}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Clock size={11} />
                          {formatHours(w.totalHours)}
                        </span>
                        <span className="text-xs text-gray-400">{w.shiftsCount} turno{w.shiftsCount !== 1 ? 's' : ''}</span>
                        {w.hoursSource === 'estimated' && (
                          <span className="text-[10px] font-black uppercase bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full border border-yellow-300">
                            Horas estimadas
                          </span>
                        )}
                        {w.hoursSource === 'mixed' && (
                          <span className="text-[10px] font-black uppercase bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full border border-orange-300">
                            Horas mistas
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Valor */}
                    <p className="font-black tabular-nums text-base shrink-0">{formatBRL(w.totalAmount)}</p>
                  </div>
                ))}
              </div>

              {spendByWorker.length > WORKER_PREVIEW && (
                <button
                  onClick={() => setShowSpendWorkerAll((v) => !v)}
                  className="mt-4 w-full flex items-center justify-center gap-2 py-2 rounded-xl border-2 border-black font-black uppercase text-xs hover:bg-black hover:text-white transition-colors"
                  aria-expanded={showSpendWorkerAll}
                  aria-controls="spend-worker-list"
                >
                  {showSpendWorkerAll ? (
                    <><ChevronUp size={14} /> Ver menos</>
                  ) : (
                    <><ChevronDown size={14} /> Ver mais {spendByWorker.length - WORKER_PREVIEW} freelas</>
                  )}
                </button>
              )}
            </section>
          )}

          {/* BI-4: Custo de no-show (sempre rotulado estimativa) */}
          {noShowCost && (
            <section className={`border-2 rounded-2xl p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] ${noShowCost.estimatedCount > 0 ? 'bg-orange-50 border-orange-300' : 'bg-white border-black'}`}>
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle size={20} strokeWidth={3} className={noShowCost.estimatedCount > 0 ? 'text-orange-600' : 'text-gray-400'} />
                <h2 className="text-xl font-black uppercase">Custo de No-Show</h2>
                <span className="text-[10px] font-black uppercase bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full border border-yellow-300 ml-auto">
                  Estimativa
                </span>
              </div>

              {noShowCost.estimatedCount === 0 ? (
                <p className="text-sm text-gray-500 font-bold">Nenhum no-show estimado no periodo. Otimo!</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-white border-2 border-orange-300 rounded-xl p-4">
                    <p className="text-xs font-black uppercase text-orange-600 mb-1">No-shows estimados</p>
                    <p className="text-3xl font-black tabular-nums text-orange-600">{noShowCost.estimatedCount}</p>
                    <p className="text-xs text-gray-400 mt-1">Turnos com convite aceito e sem checkout</p>
                  </div>
                  <div className="bg-white border-2 border-orange-300 rounded-xl p-4">
                    <p className="text-xs font-black uppercase text-orange-600 mb-1">Custo de oportunidade</p>
                    <p className="text-3xl font-black tabular-nums text-orange-600">{formatBRL(noShowCost.estimatedAmount)}</p>
                    <p className="text-xs text-gray-400 mt-1">Valor dos turnos nao executados</p>
                  </div>
                </div>
              )}

              <p className="text-xs text-gray-400 mt-3 flex items-start gap-1">
                <Info size={12} className="shrink-0 mt-0.5" />
                Estimativa heuristica v1 — baseada em convites aceitos sem checkout. Sem coluna explicita de no-show na base de dados atual.
              </p>
            </section>
          )}

          {/* BI-5: Flags de concentracao */}
          {concentrationFlags.length > 0 && (
            <section className={`border-2 rounded-2xl p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] ${flaggedWorkers.length > 0 ? 'bg-red-50 border-red-300' : 'bg-white border-black'}`}>
              <div className="flex items-center gap-2 mb-5">
                <AlertTriangle size={20} strokeWidth={3} className={flaggedWorkers.length > 0 ? 'text-red-600' : 'text-gray-400'} />
                <h2 className="text-xl font-black uppercase">Concentracao de Horas</h2>
                {flaggedWorkers.length > 0 && (
                  <span className="text-[10px] font-black uppercase bg-red-100 text-red-700 px-2 py-0.5 rounded-full border border-red-300 ml-auto">
                    {flaggedWorkers.length} alerta{flaggedWorkers.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {flaggedWorkers.length > 0 && (
                <div className="bg-red-100 border-2 border-red-300 rounded-xl p-4 mb-4">
                  <p className="text-sm font-black text-red-700 uppercase">Risco de vinculo trabalhista detectado</p>
                  <p className="text-xs text-red-600 mt-1">
                    Freelas marcados em vermelho ultrapassaram {concentrationFlags[0]?.hoursThreshold}h
                    e {concentrationFlags[0]?.daysThreshold} dias distintos no periodo. Avalie com seu departamento juridico.
                  </p>
                </div>
              )}

              <div className="space-y-3">
                {concentrationFlags.map((f) => (
                  <div
                    key={f.workerId}
                    className={`flex items-center gap-4 rounded-xl p-4 border-2 transition-all
                      ${f.flagged
                        ? 'bg-red-50 border-red-300 shadow-[4px_4px_0px_0px_rgba(220,38,38,0.4)]'
                        : 'bg-gray-50 border-black'
                      }`}
                  >
                    <div className="w-10 h-10 rounded-xl border-2 border-black bg-gray-200 shrink-0 flex items-center justify-center">
                      <span className="text-base font-black text-gray-500">{f.workerName.charAt(0).toUpperCase()}</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-black text-sm">{f.workerName}</p>
                        {f.flagged && (
                          <span className="text-[10px] font-black uppercase bg-red-600 text-white px-2 py-0.5 rounded-full">
                            Atencao vinculo
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {formatHours(f.totalHours)} em {f.distinctDays} dia{f.distinctDays !== 1 ? 's' : ''} distintos
                        {f.flagged && ` — acima de ${f.hoursThreshold}h / ${f.daysThreshold} dias`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-xs text-gray-400 mt-3 flex items-start gap-1">
                <Info size={12} className="shrink-0 mt-0.5" />
                Flag quando um freela ultrapassa {concentrationFlags[0]?.hoursThreshold ?? 150}h E {concentrationFlags[0]?.daysThreshold ?? 20} dias distintos no periodo.
              </p>
            </section>
          )}

        </div>
      )}
    </div>
  );
}
