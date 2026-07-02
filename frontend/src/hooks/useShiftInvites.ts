/**
 * useShiftInvites — hook de UI para convites de turno push (Slice 1, R5/R7/R8).
 *
 * Dois modos de uso:
 *   - useWorkerInvites: lista convites pendentes do worker + actions de resposta.
 *   - useCompanyInvites: lista convites enviados por job + action de convidar.
 *
 * Padrão do projeto: useState + useEffect + supabase direto (Art. 5 — sem React Query).
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ShiftInviteService } from '../services/shiftInviteService';
import { useToast } from '../contexts/ToastContext';
import type { Application, InvitationResponse } from '../types';

// ---------------------------------------------------------------------------
// Hook para WORKER — aba "Convites"
// ---------------------------------------------------------------------------

export interface UseWorkerInvitesResult {
  /** Convites de turno pendentes (status='invited'). */
  pendingInvites: Application[];
  loading: boolean;
  /** ID do convite sendo processado (para loading state no botão). */
  respondingId: string | null;
  /** Aceitar ou recusar um convite. */
  respond: (applicationId: string, response: InvitationResponse) => Promise<boolean>;
  /** Recarregar convites. */
  refresh: () => void;
}

export function useWorkerInvites(): UseWorkerInvitesResult {
  const [pendingInvites, setPendingInvites] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { addToast } = useToast();

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      navigate('/login');
      return;
    }

    setLoading(true);
    const invites = await ShiftInviteService.listPendingInvites();
    setPendingInvites(invites);
    setLoading(false);
  }, [navigate]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        navigate('/login');
        return;
      }

      setLoading(true);
      const invites = await ShiftInviteService.listPendingInvites();
      if (!active) return;
      setPendingInvites(invites);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [navigate]);

  const respond = useCallback(
    async (applicationId: string, response: InvitationResponse): Promise<boolean> => {
      setRespondingId(applicationId);
      const result = await ShiftInviteService.respondToInvite(applicationId, response);
      setRespondingId(null);

      if (result.error) {
        addToast(result.error, 'error');
        return false;
      }

      if (response === 'accepted') {
        addToast('Turno confirmado! Bom trabalho.', 'success');
      } else {
        addToast('Convite recusado.', 'info');
      }

      // Recarregar lista (o convite respondido some dos pendentes)
      load();
      return true;
    },
    [addToast, load],
  );

  return { pendingInvites, loading, respondingId, respond, refresh: load };
}

// ---------------------------------------------------------------------------
// Hook para EMPRESA — gerenciar convites por job
// ---------------------------------------------------------------------------

export interface UseCompanyInvitesResult {
  /** Convites enviados para o job. */
  invites: Application[];
  loading: boolean;
  /** ID do worker sendo convidado (para loading state). */
  invitingWorkerId: string | null;
  /** Convidar worker da equipe para o turno. */
  invite: (workerId: string, opts?: { expiresInHours?: number; message?: string }) => Promise<boolean>;
  /** Recarregar convites do job. */
  refresh: () => void;
}

export function useCompanyInvites(jobId: string | null | undefined): UseCompanyInvitesResult {
  const [invites, setInvites] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [invitingWorkerId, setInvitingWorkerId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { addToast } = useToast();

  const load = useCallback(async () => {
    // Guarda: jobId ainda não existe (ex.: turno em criação) — não consulta, evita 400
    // (`job_id=eq.` vazio é filtro inválido no PostgREST).
    if (!jobId) {
      setInvites([]);
      setLoading(false);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      navigate('/login');
      return;
    }

    setLoading(true);
    const list = await ShiftInviteService.listInvitesByJob(jobId);
    setInvites(list);
    setLoading(false);
  }, [jobId, navigate]);

  useEffect(() => {
    let active = true;

    void (async () => {
      // Guarda: jobId ainda não existe (ex.: turno em criação) — não consulta, evita 400
      // (`job_id=eq.` vazio é filtro inválido no PostgREST).
      if (!jobId) {
        if (!active) return;
        setInvites([]);
        setLoading(false);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        navigate('/login');
        return;
      }

      setLoading(true);
      const list = await ShiftInviteService.listInvitesByJob(jobId);
      if (!active) return;
      setInvites(list);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [jobId, navigate]);

  const invite = useCallback(
    async (
      workerId: string,
      opts: { expiresInHours?: number; message?: string } = {},
    ): Promise<boolean> => {
      // Guarda: sem jobId (turno ainda não criado/persistido) não há para onde convidar.
      if (!jobId) {
        addToast('Turno ainda não foi criado. Tente novamente em instantes.', 'error');
        return false;
      }
      setInvitingWorkerId(workerId);
      const result = await ShiftInviteService.inviteWorkerToShift(jobId, workerId, opts);
      setInvitingWorkerId(null);

      if (result.alreadyInvited) {
        addToast('Este freela já foi convidado para este turno.', 'info');
        return true;
      }
      if (result.error) {
        addToast(result.error, 'error');
        return false;
      }

      addToast('Convite enviado com sucesso!', 'success');
      load();
      return true;
    },
    [jobId, addToast, load],
  );

  return { invites, loading, invitingWorkerId, invite, refresh: load };
}
