/**
 * BonusTrail — trilha de bônus do operador (estilo missões). Rota: /company/trilha.
 * Spec: .harness/spec/trilha-bonus-operador (R20-R25). Toda regra mora no banco; a tela só mostra
 * o que o operador pode ver (nenhum motivo de exclusão, flag ou limiar — AF7/AF9).
 * `api` é injetável; o padrão é o `BonusTrailService`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import PageMeta from '../../components/PageMeta';
import BackToGestao from '../../components/company/BackToGestao';
import { Button, Card, PageHeader } from '../../components/ui';
import AlmostThere from '../../components/bonus/AlmostThere';
import CelebrationBanner, { type Celebration } from '../../components/bonus/CelebrationBanner';
import PayoutPanel from '../../components/bonus/PayoutPanel';
import Roadmap from '../../components/bonus/Roadmap';
import TrailGate from '../../components/bonus/TrailGate';
import TrailNumbers from '../../components/bonus/TrailNumbers';
import { lastTrailDay, milestoneCount } from '../../components/bonus/trailView';
import type { AcceptOutcome, BonusTrailApi } from '../../components/bonus/types';
import { useToast } from '../../contexts/ToastContext';
import { useBonusTrail } from '../../hooks/useBonusTrail';
import { resetBonusTrailAccessCache } from '../../hooks/useBonusTrailAccess';
import { logError } from '../../lib/logger';
import { BonusTrailService } from '../../services/bonusTrailService';

interface BonusTrailProps {
  api?: BonusTrailApi;
}

export default function BonusTrail({ api = BonusTrailService }: BonusTrailProps) {
  const { addToast } = useToast();
  const { snapshot, loading, failed, stale, reload, pendingCelebrations, acknowledgeCelebrations } = useBonusTrail(api);
  const [banner, setBanner] = useState<Celebration[]>([]);
  const shownIds = useRef(new Set<string>());
  const showTrail = snapshot?.status === 'active' || snapshot?.status === 'ended';

  const accept = useCallback(
    async (pixKey: string | null): Promise<AcceptOutcome> => {
      const outcome = await api.acceptEnrollment(pixKey);
      if (outcome === 'ok') {
        resetBonusTrailAccessCache();
        await reload();
      }
      return outcome;
    },
    [api, reload],
  );

  const guarded = useCallback(
    async <T,>(label: string, action: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        const result = await action();
        await reload();
        return result;
      } catch (error) {
        logError(`BonusTrail.${label}`, error);
        return fallback;
      }
    },
    [reload],
  );

  // Marca como comemorado AO EXIBIR (sem depender de clique); a lista exibida fica local.
  useEffect(() => {
    if (!showTrail) return;
    const fresh = pendingCelebrations.filter((c) => !shownIds.current.has(c.awardId));
    if (fresh.length === 0) return;
    fresh.forEach((c) => shownIds.current.add(c.awardId));
    setBanner((prev) => [...prev, ...fresh]);
    void acknowledgeCelebrations();
  }, [showTrail, pendingCelebrations, acknowledgeCelebrations]);

  const closeBanner = useCallback(() => setBanner([]), []);

  if (loading) {
    return (
      <div role="status" className="mx-auto max-w-3xl animate-pulse space-y-4">
        <span className="sr-only">Carregando a trilha</span>
        <div className="h-10 w-2/3 rounded-xl bg-gray-200" />
        <div className="h-28 rounded-xl bg-gray-200" />
        <div className="h-40 rounded-xl bg-gray-200" />
      </div>
    );
  }

  if (failed || !snapshot) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackToGestao />
        <Card className="text-center">
          <h1 className="text-xl font-bold">Não conseguimos abrir a trilha agora</h1>
          <p className="mt-2 text-sm text-gray-700">Seus marcos continuam registrados. Tente de novo em instantes.</p>
          <Button variant="dark" size="lg" className="mt-4" onClick={() => void reload()}>
            Tentar de novo
          </Button>
        </Card>
      </div>
    );
  }

  const s = snapshot;
  const count = milestoneCount(s.milestones);
  const lastDay = lastTrailDay(s.endsAt);
  let subtitle = 'Conclua marcos e receba bônus por PIX.';
  if (s.status === 'active' && lastDay) subtitle = `Sua trilha vai até ${lastDay}.`;
  if (s.status === 'ended') subtitle = lastDay ? `Sua trilha terminou em ${lastDay}.` : 'Sua trilha terminou.';

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <PageMeta title="Trilha de bônus" description="Seus marcos e bônus em dinheiro." />
      <div>
        <BackToGestao />
        <PageHeader title="Trilha de bônus" subtitle={subtitle} />
      </div>

      {/* Região viva sempre montada: o leitor de tela anuncia o aviso sem roubar o foco. */}
      <div role="status" data-testid="bonus-live">
        {banner.length > 0 && <CelebrationBanner items={banner} onClose={closeBanner} />}
      </div>

      {stale && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border-2 border-black bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-bold">Não conseguimos atualizar agora. Estes são os últimos dados carregados.</p>
          <Button variant="secondary" size="lg" onClick={() => void reload()}>
            Atualizar
          </Button>
        </div>
      )}

      {!showTrail && (
        <TrailGate
          status={s.status as 'disabled' | 'not_enrolled' | 'invited' | 'identity_required'}
          minPayoutCents={s.minPayoutCents}
          onAccept={accept}
        />
      )}

      {showTrail && (
        <>
          <TrailNumbers snapshot={s} />

          {s.status === 'active' && <AlmostThere shifts={s.pendingShifts} />}

          <section aria-labelledby="bonus-roadmap-title" className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="bonus-roadmap-title" className="text-lg font-bold">
                Marcos
              </h2>
              <p className="text-base font-bold tabular-nums" data-testid="bonus-counter">
                {count.done} de {count.total} marcos concluídos
              </p>
            </div>
            <Roadmap milestones={s.milestones} ended={s.status === 'ended'} />
          </section>

          <PayoutPanel
            snapshot={s}
            notify={addToast}
            onRequest={() => guarded('requestPayout', () => api.requestPayout(), 'error')}
            onCancel={() => guarded('cancelPayout', () => api.cancelPayout(), 'error')}
            onSavePix={(key) => guarded('setPixKey', () => api.setPixKey(key), 'error')}
          />
        </>
      )}
    </div>
  );
}
