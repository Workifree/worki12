import { useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import ModalShell from '../ModalShell';
import { Button, Field } from '../ui';
import { todayInBrazil } from '../../lib/dateUtils';
import {
  coverageMessage,
  coverageSpanDays,
  createCoverage,
  MAX_COVERAGE_DAYS,
  type CoverageResult,
} from '../../services/shiftOperationService';

export interface CoveragePerson {
  userId: string;
  label: string;
}

interface CoverageModalProps {
  companyId: string;
  /**
   * Encarregados ativos e confirmados (candidatos a "de" e "para"): a cobertura só existe entre
   * encarregados, então quem chama já filtra pelo papel. Com `fixedFromUserId`, a própria pessoa
   * entra na lista (para o texto) e só as OUTRAS aparecem em "Quem cobre".
   */
  people: CoveragePerson[];
  /** Quando preenchido, o "de" é fixo (encarregado cobrindo os próprios turnos). */
  fixedFromUserId?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}

function plusDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function br(dateOnly: string): string {
  const [, m, d] = dateOnly.split('-');
  return `${d}/${m}`;
}

/**
 * "Cobrir [pessoa] de A a B" (R18/A15): quem cobre opera os turnos da outra pessoa na janela. O fim
 * é AUTOMÁTICO (a própria janela) — sem nada a desfazer. O responsável registrado não muda.
 */
export default function CoverageModal({ companyId, people, fixedFromUserId, onClose, onDone }: CoverageModalProps) {
  const today = todayInBrazil();
  const [from, setFrom] = useState<string | null>(fixedFromUserId ?? null);
  const [to, setTo] = useState<string | null>(null);
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(plusDays(today, 6));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<CoverageResult | null>(null);

  const span = coverageSpanDays(startsOn, endsOn);
  const windowOk = Number.isFinite(span) && span >= 1 && span <= MAX_COVERAGE_DAYS;
  const windowError = !Number.isFinite(span)
    ? 'Escolha as duas datas.'
    : span < 1
      ? 'A data final precisa ser igual ou depois da inicial.'
      : span > MAX_COVERAGE_DAYS
        ? `No máximo ${MAX_COVERAGE_DAYS} dias.`
        : undefined;

  const toOptions = useMemo(() => people.filter((p) => p.userId !== from), [people, from]);
  const fromLabel = people.find((p) => p.userId === from)?.label ?? 'a pessoa';
  const toLabel = people.find((p) => p.userId === to)?.label ?? 'a outra pessoa';
  const ready = Boolean(from && to && windowOk);

  const confirm = async () => {
    if (!from || !to) return;
    setBusy(true);
    setProblem(null);
    const result = await createCoverage({ companyId, fromUserId: from, toUserId: to, startsOn, endsOn });
    setBusy(false);
    if (result.outcome === 'created') {
      onDone(coverageMessage(result));
      return;
    }
    setProblem(result);
  };

  return (
    <ModalShell labelledBy="coverage-title" onClose={() => { if (!busy) onClose(); }}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-black bg-blue-50">
          <CalendarClock size={20} aria-hidden="true" />
        </div>
        <div>
          <h2 id="coverage-title" className="text-xl font-bold">Cobrir turnos</h2>
          <p className="mt-1 text-sm text-gray-700">
            Escolha quem será coberto, quem cobre e o período. Ao fim do período, tudo volta ao normal sozinho.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {!fixedFromUserId && (
          <fieldset>
            <legend className="mb-1.5 text-sm font-bold">Quem será coberto</legend>
            <div className="flex flex-wrap gap-2">
              {people.map((p) => (
                <button
                  key={p.userId}
                  type="button"
                  aria-pressed={from === p.userId}
                  disabled={busy}
                  onClick={() => { setFrom(p.userId); if (to === p.userId) setTo(null); }}
                  className={`min-h-11 rounded-xl border-2 px-4 text-sm font-bold ${from === p.userId ? 'border-black bg-black text-white' : 'border-gray-300 bg-white hover:border-black'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend className="mb-1.5 text-sm font-bold">Quem cobre</legend>
          <div className="flex flex-wrap gap-2">
            {toOptions.map((p) => (
              <button
                key={p.userId}
                type="button"
                aria-pressed={to === p.userId}
                disabled={busy}
                onClick={() => setTo(p.userId)}
                className={`min-h-11 rounded-xl border-2 px-4 text-sm font-bold ${to === p.userId ? 'border-black bg-black text-white' : 'border-gray-300 bg-white hover:border-black'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="De" required>
            <input type="date" value={startsOn} min={today} disabled={busy} onChange={(e) => setStartsOn(e.target.value)} />
          </Field>
          <Field label="Até" required error={windowError}>
            <input type="date" value={endsOn} min={startsOn || today} disabled={busy} onChange={(e) => setEndsOn(e.target.value)} />
          </Field>
        </div>

        {ready && (
          <p className="rounded-xl border-2 border-black bg-gray-50 p-3 text-sm" role="status">
            <strong>{toLabel}</strong> cobre os turnos de <strong>{fromLabel}</strong> de {br(startsOn)} a {br(endsOn)}
            {' '}({span} {span === 1 ? 'dia' : 'dias'}). A cobertura termina sozinha em {br(endsOn)}; o responsável registrado nos turnos não muda.
          </p>
        )}

        {problem && (
          <p role="alert" className="text-sm font-semibold text-red-700">{coverageMessage(problem)}</p>
        )}

        <div className="flex flex-col gap-3">
          <Button variant="dark" size="lg" fullWidth data-copilot="empresa.cobertura.confirmar" data-copilot-risk="D" disabled={!ready} loading={busy} onClick={() => { void confirm(); }}>
            Criar cobertura
          </Button>
          <Button variant="secondary" size="lg" fullWidth disabled={busy} onClick={onClose}>Voltar</Button>
        </div>
      </div>
    </ModalShell>
  );
}
