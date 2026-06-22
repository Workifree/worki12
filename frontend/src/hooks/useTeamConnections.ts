/**
 * useTeamConnections — hook de UI para o roster "minha equipe" e "minhas lojas".
 *
 * Dois modos de uso:
 *   - papel 'company': lista equipe aceita + conexões pendentes da empresa.
 *   - papel 'worker':  lista lojas aceitas + convites de equipe pendentes.
 *
 * Padrão do projeto: useState + useEffect + supabase direto (Art. 5 — sem React Query).
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { TeamConnectionService } from '../services/teamConnectionService';
import { useToast } from '../contexts/ToastContext';
import type { TeamConnection, TeamMember, MyStore, TeamConnectionSource } from '../types';

// ---------------------------------------------------------------------------
// Hook para EMPRESA — gerenciar "minha equipe"
// ---------------------------------------------------------------------------

export interface UseCompanyTeamResult {
  /** Membros aceitos (com perfil do worker). */
  teamMembers: TeamMember[];
  /** Convites de equipe pendentes (empresa enviou, aguarda worker). */
  pendingConnections: TeamConnection[];
  loading: boolean;
  /** company_id real da empresa autenticada (necessário para gerar link de convite estável). */
  companyId: string;
  /** Adicionar worker via QR/link/phone. */
  addWorker: (workerId: string, source: TeamConnectionSource) => Promise<boolean>;
  /** Recarregar dados. */
  refresh: () => void;
}

export function useCompanyTeam(): UseCompanyTeamResult {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [pendingConnections, setPendingConnections] = useState<TeamConnection[]>([]);
  const [companyId, setCompanyId] = useState<string>('');
  const [loading, setLoading] = useState(true);
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
    const { data: company } = await supabase
      .from('companies')
      .select('id')
      .eq('owner_id', user.id)
      .maybeSingle();
    if (company?.id) setCompanyId(company.id as string);

    const [members, all] = await Promise.all([
      TeamConnectionService.listTeamMembers(),
      TeamConnectionService.listAllConnections(),
    ]);

    setTeamMembers(members);
    setPendingConnections(all.filter((c) => c.status === 'pending'));
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
      const { data: company } = await supabase
        .from('companies')
        .select('id')
        .eq('owner_id', user.id)
        .maybeSingle();
      if (active && company?.id) setCompanyId(company.id as string);

      const [members, all] = await Promise.all([
        TeamConnectionService.listTeamMembers(),
        TeamConnectionService.listAllConnections(),
      ]);

      if (!active) return;
      setTeamMembers(members);
      setPendingConnections(all.filter((c) => c.status === 'pending'));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [navigate]);

  const addWorker = useCallback(
    async (workerId: string, source: TeamConnectionSource): Promise<boolean> => {
      const result = await TeamConnectionService.addToTeam(workerId, source);

      if (result.alreadyExists) {
        addToast('Este freela já está na sua equipe.', 'info');
        return true;
      }
      if (result.error) {
        addToast(result.error, 'error');
        return false;
      }

      addToast('Convite de equipe enviado! Aguardando aceite do freela.', 'success');
      load();
      return true;
    },
    [addToast, load],
  );

  return { teamMembers, pendingConnections, loading, companyId, addWorker, refresh: load };
}

// ---------------------------------------------------------------------------
// Hook para WORKER — "minhas lojas" + convites de equipe pendentes
// ---------------------------------------------------------------------------

export interface UseWorkerStoresResult {
  /** Empresas aceitas ("minhas lojas"). */
  myStores: MyStore[];
  /** Convites de equipe pendentes (empresa convidou, aguarda aceite do worker). */
  pendingConnections: TeamConnection[];
  loading: boolean;
  /** Aceitar convite de equipe. */
  acceptConnection: (connectionId: string) => Promise<boolean>;
  /** Bloquear/sair de uma empresa. */
  blockConnection: (connectionId: string) => Promise<boolean>;
  /** Recarregar dados. */
  refresh: () => void;
}

export function useWorkerStores(): UseWorkerStoresResult {
  const [myStores, setMyStores] = useState<MyStore[]>([]);
  const [pendingConnections, setPendingConnections] = useState<TeamConnection[]>([]);
  const [loading, setLoading] = useState(true);
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
    const [stores, pending] = await Promise.all([
      TeamConnectionService.listMyStores(),
      TeamConnectionService.listPendingConnections(),
    ]);

    setMyStores(stores);
    setPendingConnections(pending);
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
      const [stores, pending] = await Promise.all([
        TeamConnectionService.listMyStores(),
        TeamConnectionService.listPendingConnections(),
      ]);

      if (!active) return;
      setMyStores(stores);
      setPendingConnections(pending);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [navigate]);

  const acceptConnection = useCallback(
    async (connectionId: string): Promise<boolean> => {
      const result = await TeamConnectionService.acceptConnection(connectionId);
      if (result.error) {
        addToast(result.error, 'error');
        return false;
      }
      addToast('Você agora faz parte da equipe!', 'success');
      load();
      return true;
    },
    [addToast, load],
  );

  const blockConnection = useCallback(
    async (connectionId: string): Promise<boolean> => {
      const result = await TeamConnectionService.blockConnection(connectionId);
      if (result.error) {
        addToast(result.error, 'error');
        return false;
      }
      addToast('Conexão removida.', 'success');
      load();
      return true;
    },
    [addToast, load],
  );

  return {
    myStores,
    pendingConnections,
    loading,
    acceptConnection,
    blockConnection,
    refresh: load,
  };
}
