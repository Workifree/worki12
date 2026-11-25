/**
 * useShiftInvites — hooks de UI para convites/chamados de turno.
 *
 * Três modos de uso:
 *   - useWorkerInvites: convites pendentes do freela + resposta (aceitar/recusar).
 *   - useCompanyInvites: convites enviados por turno + convite individual (delega ao chamado).
 *   - useShiftCalls: painel de chamados de um turno (visão da empresa).
 *
 * DUAS ORIGENS, UMA LISTA — o ponto que exige atenção neste arquivo:
 *
 *   Depois do F1, um convite pendente pode vir de `shift_call_targets` (chamado) OU de uma
 *   `applications` com status 'invited' criada antes da feature. As duas continuam vivas em
 *   produção e o freela não deve perceber diferença nenhuma: mesma lista, mesmos botões.
 *   `PendingInvite` normaliza as duas, e `respond` roteia para a RPC nova ou para o caminho
 *   legado conforme a origem. Convites legados morrem sozinhos quando forem respondidos ou
 *   expirarem — não há migração de dados, de propósito.
 *
 * Padrão do projeto: useState + useEffect + supabase direto (Art. 5 — sem React Query).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkSession } from '../lib/authSession';
import { logError } from '../lib/logger';
import { ShiftInviteService } from '../services/shiftInviteService';
import { ShiftCallService } from '../services/shiftCallService';
import { useToast } from '../contexts/ToastContext';
import type {
  Application,
  InvitationResponse,
  PendingInvite,
  ShiftCall,
  ShiftCallOutcome,
} from '../types';

// ---------------------------------------------------------------------------
// Normalização e tradução de resultado
// ---------------------------------------------------------------------------

/** Convite legado (`applications` 'invited') na forma normalizada. */
function legacyToPendingInvite(app: Application): PendingInvite {
  return {
    source: 'legacy',
    id: app.id,
    applicationId: app.id,
    jobId: app.job_id,
    expiresAt: app.invitation_expires_at ?? null,
    // Convite legado é sempre individual — não havia disparo múltiplo antes do F1.
    disputed: false,
    targetsCount: 1,
    slots: app.job?.slots ?? 1,
    job: app.job,
  };
}

interface OutcomeMessage {
  text: string;
  tone: 'success' | 'error' | 'info';
  /** Sucesso do ponto de vista do fluxo (a resposta foi registrada). */
  ok: boolean;
}

/**
 * Traduz o `outcome` da RPC para o que o freela lê na tela.
 *
 * Nenhuma variante de "você perdeu a corrida" é tratada como erro: perder não é falha do freela
 * nem culpa dele, e a mensagem precisa deixar explícito que ele continua no elenco. Tratar isso
 * como erro vermelho seria ensinar o freela a não responder rápido — o oposto do que a feature
 * existe para produzir.
 */
function messageForOutcome(outcome: ShiftCallOutcome): OutcomeMessage {
  switch (outcome) {
    case 'claimed':
      return { text: 'Vaga garantida! Turno confirmado.', tone: 'success', ok: true };
    case 'already_hired':
      return { text: 'Você já está neste turno.', tone: 'info', ok: true };
    case 'declined':
      return { text: 'Convite recusado.', tone: 'info', ok: true };
    case 'filled':
      return {
        text: 'Outro freela aceitou primeiro. Você continua no elenco e recebe os próximos.',
        tone: 'info',
        ok: true,
      };
    case 'expired':
      return { text: 'Este chamado expirou.', tone: 'info', ok: true };
    case 'cancelled':
    case 'not_open':
      return { text: 'A empresa encerrou este chamado.', tone: 'info', ok: true };
    case 'already_responded':
      return { text: 'Você já respondeu a este chamado.', tone: 'info', ok: true };
    case 'blocked_cancelled':
      return {
        text: 'Este turno foi cancelado para você antes. Fale com a empresa.',
        tone: 'error',
        ok: false,
      };
    case 'unauthenticated':
      return { text: 'Sessão expirada. Faça login novamente.', tone: 'error', ok: false };
    case 'not_target':
    case 'forbidden':
    case 'not_found':
    default:
      return { text: 'Não foi possível responder a este chamado.', tone: 'error', ok: false };
  }
}

const NO_INVITES: Application[] = [];

/** Alvos que ainda contam como convidados: chamado aberto e sem resposta, ou aceito. */
function activeCallWorkerIds(calls: ShiftCall[]): string[] {
  const now = Date.now();
  return calls.flatMap((call) => {
    const open = call.status === 'open' && !(new Date(call.expires_at).getTime() <= now);
    return (call.targets ?? [])
      .filter((target) => target.response === 'accepted' || (open && !target.response))
      .map((target) => target.worker_id);
  });
}

// ---------------------------------------------------------------------------
// Hook para WORKER — aba "Convites"
// ---------------------------------------------------------------------------

export interface UseWorkerInvitesResult {
  /** Convites pendentes, de qualquer origem (chamado novo ou convite legado). */
  pendingInvites: PendingInvite[];
  loading: boolean;
  /** Não deu para carregar (rede). Diferente de "nenhum convite": a tela oferece tentar de novo. */
  error?: boolean;
  /** ID do convite sendo processado (para loading state no botão). */
  respondingId: string | null;
  /** Aceitar ou recusar. Recebe o `id` do PendingInvite (não o do chamado). */
  respond: (inviteId: string, response: InvitationResponse) => Promise<boolean>;
  /** Recarregar. */
  refresh: () => void;
}

/**
 * `useWorkerInvites` roda em DUAS instancias ao mesmo tempo: uma no `InviteTakeover` (que vive no
 * MainLayout, ao lado da pagina) e outra na propria pagina (`MyJobs`, `Dashboard`). Cada uma tem
 * seu proprio `useState`, entao quando o freela aceitava pelo takeover, so a instancia do takeover
 * recarregava: o overlay fechava e o MESMO convite continuava listado atras dele, com o botao
 * ACEITAR ativo. O aceite tinha funcionado (application 'hired', chamado 'filled'), mas a tela
 * dizia o contrario e convidava a clicar de novo.
 *
 * Sem store global (Article 5: useState/useEffect direto), as instancias se avisam por evento de
 * janela. `origem` evita que quem disparou recarregue duas vezes.
 */
export const EVENTO_CONVITES = 'worki:convites-mudaram';
let proximaInstancia = 0;

export function useWorkerInvites(): UseWorkerInvitesResult {
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const navigate = useNavigate();
  const { addToast } = useToast();
  const instanciaIdRef = useRef<number | null>(null);
  if (instanciaIdRef.current === null) instanciaIdRef.current = ++proximaInstancia;
  const instanciaId = instanciaIdRef.current;

  const fetchInvites = useCallback(async (): Promise<PendingInvite[]> => {
    // As duas origens em paralelo — nenhuma depende da outra.
    const [calls, legacy] = await Promise.all([
      ShiftCallService.listPendingForWorkerChecked(),
      ShiftInviteService.listPendingInvitesChecked(),
    ]);

    // Um chamado e um convite legado do MESMO turno seriam a mesma vaga aparecendo duas vezes.
    // Não deveria acontecer (`inviteWorkerToShift` recusa quando já existe application), mas se
    // acontecer o chamado vence: é o caminho que a RPC sabe arbitrar.
    const jobIdsWithCall = new Set(calls.map((invite) => invite.jobId));

    return [
      ...calls,
      ...legacy.filter((app) => !jobIdsWithCall.has(app.job_id)).map(legacyToPendingInvite),
    ];
  }, []);

  const load = useCallback(
    async (isActive: () => boolean = () => true) => {
      const session = await checkSession();
      if (!isActive()) return;
      if (session.status === 'signed_out') {
        navigate('/login');
        return;
      }
      if (session.status === 'unavailable') {
        logError('useWorkerInvites.session', session.error);
        setError(true);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const invites = await fetchInvites();
        if (!isActive()) return;
        setError(false);
        setPendingInvites(invites);
      } catch (err) {
        logError('useWorkerInvites.fetch', err);
        if (!isActive()) return;
        // Mantém o que já estava na tela: falha de consulta não esvazia a lista.
        setError(true);
      }
      setLoading(false);
    },
    [navigate, fetchInvites],
  );

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [load]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  // Outra instancia respondeu um convite — esta precisa refletir isso.
  useEffect(() => {
    const aoMudar = (e: Event) => {
      if ((e as CustomEvent<{ origem?: number }>).detail?.origem === instanciaId) return;
      void load();
    };
    window.addEventListener(EVENTO_CONVITES, aoMudar);
    return () => window.removeEventListener(EVENTO_CONVITES, aoMudar);
  }, [load, instanciaId]);

  const respond = useCallback(
    async (inviteId: string, response: InvitationResponse): Promise<boolean> => {
      const invite = pendingInvites.find((item) => item.id === inviteId);
      if (!invite) return false;

      setRespondingId(inviteId);

      let ok: boolean;
      if (invite.source === 'legacy' && invite.applicationId) {
        const result = await ShiftInviteService.respondToInvite(invite.applicationId, response);
        ok = !result.error;
        if (result.error) {
          addToast(result.error, 'error');
        } else {
          addToast(
            response === 'accepted' ? 'Turno confirmado! Bom trabalho.' : 'Convite recusado.',
            response === 'accepted' ? 'success' : 'info',
          );
        }
      } else {
        const result =
          response === 'accepted'
            ? await ShiftCallService.claimSlot(invite.callId ?? '')
            : await ShiftCallService.declineCall(invite.callId ?? '');
        const message = messageForOutcome(result.outcome);
        addToast(message.text, message.tone);
        ok = message.ok;
      }

      setRespondingId(null);
      // Recarrega sempre: mesmo quando o freela perde a corrida, a lista mudou (o chamado saiu).
      load();
      // ...e avisa as OUTRAS instancias do hook (takeover <-> pagina) que a lista mudou.
      window.dispatchEvent(new CustomEvent(EVENTO_CONVITES, { detail: { origem: instanciaId } }));
      return ok;
    },
    [pendingInvites, addToast, load, instanciaId],
  );

  return { pendingInvites, loading, error, respondingId, respond, refresh };
}

// ---------------------------------------------------------------------------
// Hook para EMPRESA — convites de um turno
// ---------------------------------------------------------------------------

export interface UseCompanyInvitesResult {
  /** Convites enviados para o turno (fluxo legado + histórico). */
  invites: Application[];
  /**
   * Quem já está convidado para o turno, das DUAS origens: `applications` (convite legado ou já
   * aceito) e alvos de `shift_calls` (o convite de hoje, que não cria application até o aceite).
   * É o que decide entre "Convidar" e "Convidado".
   */
  invitedWorkerIds: string[];
  loading: boolean;
  /** ID do worker sendo convidado (para loading state). */
  invitingWorkerId: string | null;
  /** Convidar UM worker (atalho de chamado com um alvo). */
  invite: (workerId: string, opts?: { expiresInHours?: number; message?: string }) => Promise<boolean>;
  /** Recarregar. */
  refresh: () => void;
}

export function useCompanyInvites(jobId: string | null | undefined): UseCompanyInvitesResult {
  // O que foi lido vem carimbado com o turno: ao trocar de turno, nada do anterior vaza.
  const [loaded, setLoaded] = useState<{ jobId: string; invites: Application[]; calledIds: string[] } | null>(
    null,
  );
  // Marcado na hora em que o envio dá certo, sem esperar a releitura (que pode falhar na rede).
  const [justInvited, setJustInvited] = useState<{ jobId: string; workerId: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [invitingWorkerId, setInvitingWorkerId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { addToast } = useToast();

  const load = useCallback(
    async (isActive: () => boolean = () => true) => {
      // Guarda: jobId ainda não existe (ex.: turno em criação) — não consulta, evita 400
      // (`job_id=eq.` vazio é filtro inválido no PostgREST).
      if (!jobId) {
        setLoading(false);
        return;
      }

      const session = await checkSession();
      if (!isActive()) return;
      if (session.status === 'signed_out') {
        navigate('/login');
        return;
      }
      if (session.status === 'unavailable') {
        logError('useCompanyInvites.session', session.error);
        setLoading(false);
        return;
      }

      setLoading(true);
      const [list, calls] = await Promise.all([
        ShiftInviteService.listInvitesByJob(jobId),
        ShiftCallService.listCallsByJob(jobId),
      ]);
      if (!isActive()) return;
      setLoaded({ jobId, invites: list, calledIds: activeCallWorkerIds(calls) });
      setLoading(false);
    },
    [jobId, navigate],
  );

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [load]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  const current = loaded && loaded.jobId === jobId ? loaded : null;
  const invites = current?.invites ?? NO_INVITES;
  const invitedWorkerIds = Array.from(
    new Set([
      ...invites.map((item) => item.worker_id),
      ...(current?.calledIds ?? []),
      ...justInvited.filter((item) => item.jobId === jobId).map((item) => item.workerId),
    ]),
  );

  const invite = useCallback(
    async (
      workerId: string,
      opts: { expiresInHours?: number; message?: string } = {},
    ): Promise<boolean> => {
      if (!jobId) {
        addToast('Turno ainda não foi criado. Tente novamente em instantes.', 'error');
        return false;
      }
      setInvitingWorkerId(workerId);
      const result = await ShiftInviteService.inviteWorkerToShift(jobId, workerId, opts);
      setInvitingWorkerId(null);

      if (result.alreadyInvited) {
        setJustInvited((prev) => [...prev, { jobId, workerId }]);
        addToast('Este freela já foi convidado para este turno.', 'info');
        load();
        return true;
      }
      if (result.error) {
        addToast(result.error, 'error');
        return false;
      }

      setJustInvited((prev) => [...prev, { jobId, workerId }]);
      addToast('Convite enviado com sucesso!', 'success');
      load();
      return true;
    },
    [jobId, addToast, load],
  );

  return { invites, invitedWorkerIds, loading, invitingWorkerId, invite, refresh };
}

// ---------------------------------------------------------------------------
// Hook para EMPRESA — painel de chamados do turno
// ---------------------------------------------------------------------------

export interface UseShiftCallsResult {
  calls: ShiftCall[];
  loading: boolean;
  /** Chamado ainda aberto deste turno (o que a UI destaca), se houver. */
  openCall: ShiftCall | null;
  cancellingId: string | null;
  cancel: (callId: string) => Promise<boolean>;
  refresh: () => void;
}

export function useShiftCalls(jobId: string | null | undefined): UseShiftCallsResult {
  const [calls, setCalls] = useState<ShiftCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const { addToast } = useToast();

  const load = useCallback(async () => {
    if (!jobId) {
      setCalls([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setCalls(await ShiftCallService.listCallsByJob(jobId));
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!jobId) {
        if (!active) return;
        setCalls([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const list = await ShiftCallService.listCallsByJob(jobId);
      if (!active) return;
      setCalls(list);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [jobId]);

  const cancel = useCallback(
    async (callId: string): Promise<boolean> => {
      setCancellingId(callId);
      const result = await ShiftCallService.cancelShiftCall(callId);
      setCancellingId(null);

      if (!result.success) {
        addToast(result.error ?? 'Não foi possível cancelar o chamado.', 'error');
        return false;
      }
      addToast('Chamado cancelado.', 'info');
      load();
      return true;
    },
    [addToast, load],
  );

  const openCall = calls.find((call) => call.status === 'open') ?? null;

  return { calls, loading, openCall, cancellingId, cancel, refresh: load };
}
