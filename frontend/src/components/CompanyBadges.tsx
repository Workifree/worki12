import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Star, EyeOff, Eye, ShieldOff } from 'lucide-react';
import { BadgeService } from '../services/badgeService';
import { useToast } from '../contexts/ToastContext';
import { logError } from '../lib/logger';
import { supabase } from '../lib/supabase';
import type { CompanyBadge } from '../types';

// -----------------------------------------------------------------------------------------------
// CompanyBadges (F12) — "Já trabalhou com" (selos de empresas onde o freela concluiu turno).
//
// Spec/contrato: `.harness/spec/badges-empresas/ddl-aprovado.md` §5.
// ADR: `.harness/memory-bank/decisions/ADR-20260821-badges-historico-de-empresas.md`.
//
// Fetch = BadgeService (nunca `.from('applications'|'reviews')` direto — a leitura cross-empresa
// exige a RPC SECURITY DEFINER; ver comentário de topo de `badgeService.ts`).
//
// mode='manage' (Profile.tsx — o dono do perfil):
//   - Recebe TODOS os badges, inclusive ocultos (`hidden: true` na linha) — é o único jeito de
//     reexibir (DS1). Cada badge tem um botão olho aberto/fechado que chama
//     `setBadgeVisibility(companyId, !hidden)`.
//   - `false` devolvido pela RPC é RECUSA (sem turno concluído com aquela empresa), não erro —
//     a UI NUNCA assume sucesso otimista sem confirmar o retorno.
//   - Switch de chave-mestra (`workers.badges_hidden`) some com a seção inteira para terceiros;
//     o dono continua vendo tudo com aviso explícito.
//
// mode='view' (WorkerPublicProfile.tsx — a empresa olhando):
//   - Terceiros NUNCA recebem badge oculto (a RPC já filtra) — não há botão de olho aqui.
//
// Proibido (DS5): ordenar por `avg_rating`, criar campo `score`, combinar notas de empresas
// diferentes. A ordem vem pronta do service (`last_shift_at DESC`) — este componente NUNCA
// reordena o array recebido.
// -----------------------------------------------------------------------------------------------

interface CompanyBadgesProps {
  workerId: string;
  mode: 'view' | 'manage';
}

function formatShiftsLabel(count: number): string {
  return count === 1 ? '1 turno' : `${count} turnos`;
}

function initialsFrom(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function BadgeRating({ avgRating, reviewsCount }: { avgRating: number | null; reviewsCount: number }) {
  // avg_rating === null significa "esta empresa nunca avaliou" — NUNCA renderizar como 0 estrelas
  // (inventaria uma nota ruim que ninguém deu). Distinção visual: badge cinza "sem avaliação".
  if (avgRating === null || reviewsCount === 0) {
    return (
      <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-500 px-2 py-0.5 rounded-pill text-[11px] font-bold uppercase">
        Sem avaliação
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-pill text-[11px] font-bold tabular-nums">
      <Star size={12} className="fill-yellow-500 text-yellow-500" />
      {avgRating.toFixed(1)}
      <span className="text-yellow-600/70">({reviewsCount})</span>
    </span>
  );
}

export default function CompanyBadges({ workerId, mode }: CompanyBadgesProps) {
  const navigate = useNavigate();
  const { addToast } = useToast();

  // DS11 (.harness/spec/badges-empresas/ddl-aprovado.md §2.1): /empresa/:id e worker-only
  // (ProtectedRoute.workerOnlyPaths). Em mode='view' quem clica e SEMPRE uma empresa (o
  // componente so monta em /company/worker/:id), entao o destino e a rota-espelho sob
  // CompanyLayout. INVARIANTE: mode='view' => caller e 'hire'; mode='manage' => caller e 'work'.
  // Montar CompanyBadges em qualquer tela nova exige revalidar esta invariante.
  const profileBase = mode === 'view' ? '/company/empresa' : '/empresa';

  const [badges, setBadges] = useState<CompanyBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [badgesHiddenGlobal, setBadgesHiddenGlobalState] = useState(false);
  const [savingCompanyId, setSavingCompanyId] = useState<string | null>(null);
  const [savingGlobal, setSavingGlobal] = useState(false);

  const load = useCallback(async () => {
    if (!workerId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await BadgeService.getCompanyBadges(workerId);
    setBadges(result.badges);
    setFailed(result.failed);
    setLoading(false);
  }, [workerId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await load();
      if (!active) return;
    })();
    return () => { active = false; };
  }, [load]);

  // Chave-mestra: só relevante em modo gerência (o dono vendo/ligando). Lida direto de `workers`
  // (mesmo padrão do BadgeService — self, coberto pela policy existente).
  useEffect(() => {
    if (mode !== 'manage' || !workerId) return;
    let active = true;
    void (async () => {
      const { data, error } = await supabase
        .from('workers')
        .select('badges_hidden')
        .eq('id', workerId)
        .maybeSingle();
      if (!active) return;
      if (error) {
        logError('CompanyBadges.loadBadgesHiddenGlobal', error);
        return;
      }
      setBadgesHiddenGlobalState(Boolean((data as { badges_hidden?: boolean } | null)?.badges_hidden));
    })();
    return () => { active = false; };
  }, [mode, workerId]);

  const handleToggleBadge = useCallback(async (companyId: string, currentlyHidden: boolean) => {
    setSavingCompanyId(companyId);
    const nextHidden = !currentlyHidden;
    const ok = await BadgeService.setBadgeVisibility(companyId, nextHidden);
    setSavingCompanyId(null);

    if (!ok) {
      // false = recusa do banco (sem turno concluído com esta empresa) — NUNCA tratar como
      // sucesso otimista. Nenhuma mudança de estado local; avisamos e mantemos como estava.
      addToast('Não foi possível alterar a visibilidade deste selo.', 'error');
      return;
    }

    setBadges((prev) => prev.map((b) => (b.company_id === companyId ? { ...b, hidden: nextHidden } : b)));
    addToast(nextHidden ? 'Selo ocultado.' : 'Selo reexibido.', 'success');
  }, [addToast]);

  const handleToggleGlobal = useCallback(async () => {
    const nextHidden = !badgesHiddenGlobal;
    setSavingGlobal(true);
    const ok = await BadgeService.setBadgesHiddenGlobal(workerId, nextHidden);
    setSavingGlobal(false);

    if (!ok) {
      addToast('Não foi possível alterar essa configuração agora.', 'error');
      return;
    }

    setBadgesHiddenGlobalState(nextHidden);
    addToast(
      nextHidden
        ? 'Seção ocultada. Ninguém mais verá onde você já trabalhou.'
        : 'Seção reexibida. Empresas com vínculo voltam a ver seus selos.',
      'success'
    );
  }, [addToast, badgesHiddenGlobal, workerId]);

  if (mode === 'view' && !loading && !failed && badges.length === 0) {
    // Terceiro sem badges (ou sem vínculo, ou dono escondeu tudo) — a RPC não distingue os
    // casos de propósito (sem oráculo de existência). Não renderizar nada: seção vazia não é
    // informação, é ausência de informação.
    return null;
  }

  return (
    <div className="mt-8 bg-white border-2 border-black rounded-2xl p-6 sm:p-8 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="text-xl font-black uppercase flex items-center gap-2">
          <Building2 size={20} /> Já trabalhou com
        </h3>
      </div>

      {mode === 'manage' && (
        <div className="flex items-start justify-between gap-4 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-4 mb-5">
          <div className="flex items-start gap-2 min-w-0">
            <ShieldOff size={18} className="mt-0.5 flex-shrink-0 text-gray-500" />
            <div className="min-w-0">
              <p className="text-sm font-black uppercase text-gray-800">Não exibir onde já trabalhei</p>
              <p className="text-xs text-gray-500 font-medium mt-0.5">
                Chave-mestra: liga e nenhuma empresa vê seus selos (nem esta seção), mesmo com vínculo
                ativo. Você continua vendo tudo aqui para poder desligar de novo quando quiser.
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={badgesHiddenGlobal}
            aria-label="Não exibir onde já trabalhei para outras empresas"
            disabled={savingGlobal}
            onClick={() => void handleToggleGlobal()}
            className={`relative flex-shrink-0 w-14 h-8 rounded-pill border-2 border-black transition-colors min-h-11 ${
              badgesHiddenGlobal ? 'bg-black' : 'bg-gray-200'
            } ${savingGlobal ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white border-2 border-black transition-transform ${
                badgesHiddenGlobal ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-200 rounded-xl" />
          ))}
        </div>
      ) : failed ? (
        <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-4 text-center">
          <p className="text-sm font-bold text-gray-400 mb-3">Não foi possível carregar os selos agora.</p>
          <button onClick={() => void load()} className="bg-black text-white font-black uppercase text-xs px-4 min-h-11 rounded-xl hover:bg-primary transition-colors">
            Tentar de novo
          </button>
        </div>
      ) : badges.length === 0 ? (
        <p className="text-sm font-bold text-gray-400 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-4 text-center">
          Ainda sem selos. Eles aparecem aqui depois do primeiro turno concluído em uma empresa.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {badges.map((badge) => (
            <div
              key={badge.company_id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`${profileBase}/${badge.company_id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`${profileBase}/${badge.company_id}`);
                }
              }}
              className={`text-left border-2 border-black rounded-xl p-4 flex items-start gap-3 cursor-pointer transition-all hover:shadow-[4px_4px_0px_0px_rgba(0,166,81,1)] hover:-translate-y-0.5 min-h-11 ${
                badge.hidden ? 'opacity-60 bg-gray-50' : 'bg-white'
              }`}
            >
              {badge.company_logo_url ? (
                <img
                  src={badge.company_logo_url}
                  alt={`Logo de ${badge.company_name}`}
                  className="w-11 h-11 rounded-xl border-2 border-black object-cover flex-shrink-0"
                />
              ) : (
                <div
                  className="w-11 h-11 rounded-xl border-2 border-black bg-black text-white flex items-center justify-center font-black text-sm flex-shrink-0"
                  aria-hidden="true"
                >
                  {initialsFrom(badge.company_name)}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="font-black uppercase text-sm truncate">{badge.company_name}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded-pill text-[11px] font-bold uppercase">
                    {formatShiftsLabel(badge.shifts_count)}
                  </span>
                  <BadgeRating avgRating={badge.avg_rating} reviewsCount={badge.reviews_count} />
                  {mode === 'manage' && badge.hidden && (
                    <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded-pill text-[11px] font-bold uppercase">
                      Oculto
                    </span>
                  )}
                </div>
              </div>

              {mode === 'manage' && (
                <button
                  type="button"
                  aria-label={badge.hidden ? `Reexibir selo de ${badge.company_name}` : `Ocultar selo de ${badge.company_name}`}
                  disabled={savingCompanyId === badge.company_id}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleToggleBadge(badge.company_id, badge.hidden);
                  }}
                  className={`flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-xl border-2 border-black transition-colors ${
                    savingCompanyId === badge.company_id ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'
                  }`}
                >
                  {badge.hidden ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
