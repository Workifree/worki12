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
import { getAuthenticatedCompanyId } from '../services/companyScopeService';

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
  /** Remover worker do elenco da empresa. */
  removeWorker: (workerId: string) => Promise<boolean>;
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
    // `owner_id` sozinho e a ancora antiga: para o gerente de unidade isto ficava NULO e o
    // historico "N turnos com voce" do cartao sumia, embora a lista de membros (que ja usa o
    // seam) aparecesse — duas metades da mesma tela discordando sobre qual empresa e esta.
    const empresaOperada = await getAuthenticatedCompanyId().catch(() => null);
    if (empresaOperada) setCompanyId(empresaOperada);

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
      const empresaOperada = await getAuthenticatedCompanyId().catch(() => null);
      if (active && empresaOperada) setCompanyId(empresaOperada);

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

      if (result.alreadyExists && result.blocked) {
        // O freela bloqueou a empresa — a guarda de consentimento na policy de DELETE
        // (migration 20260816000000) impede reabrir essa conexão por aqui.
        addToast('Não é possível adicionar este freela agora.', 'error');
        return false;
      }
      if (result.alreadyExists) {
        addToast('Este freela já está no seu elenco.', 'info');
        return true;
      }
      if (result.error) {
        addToast(result.error, 'error');
        return false;
      }

      addToast('Convite de elenco enviado! Aguardando aceite do freela.', 'success');
      load();
      return true;
    },
    [addToast, load],
  );

  const removeWorker = useCallback(
    async (workerId: string): Promise<boolean> => {
      const result = await TeamConnectionService.removeFromTeam(workerId);

      if (result.error) {
        addToast(result.error, 'error');
        return false;
      }

      addToast('Freela removido do elenco.', 'success');
      load();
      return true;
    },
    [addToast, load],
  );

  return { teamMembers, pendingConnections, loading, companyId, addWorker, removeWorker, refresh: load };
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
  declineConnection: (connectionId: string) => Promise<boolean>;
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
      addToast('Você agora faz parte do elenco!', 'success');
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
  const declineConnection = useCallback(
    async (connectionId: string): Promise<boolean> => {
      const result = await TeamConnectionService.declineConnection(connectionId);
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
    declineConnection,
    refresh: load,
  };
}
