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
import { TeamConnectionService } from '../services/teamConnectionService';
import { useToast } from '../contexts/ToastContext';
import type { TeamConnection, TeamMember, MyStore, TeamConnectionSource } from '../types';
import { getAuthenticatedCompanyId } from '../services/companyScopeService';
import { checkSession } from '../lib/authSession';
import { logError } from '../lib/logger';
import { useLatestResponse } from './useLatestResponse';

// ---------------------------------------------------------------------------
// Hook para EMPRESA — gerenciar "minha equipe"
// ---------------------------------------------------------------------------

export interface UseCompanyTeamResult {
  /** Sessão ou consulta falharam: lista vazia aqui não significa Elenco vazio. */
  erroCarga: boolean;
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
  /** Recarregar dados. `silent`: sem esqueleto e sem trocar a tela por erro. */
  refresh: (options?: { silent?: boolean }) => unknown;
}

export function useCompanyTeam(): UseCompanyTeamResult {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [pendingConnections, setPendingConnections] = useState<TeamConnection[]>([]);
  const [companyId, setCompanyId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [erroCarga, setErroCarga] = useState(false);
  const navigate = useNavigate();
  const { addToast } = useToast();

  const beginTeam = useLatestResponse();
  const fetchTeam = useCallback(
    async (isActive: () => boolean = () => true, silent = false) => {
      const claim = beginTeam();
      const session = await checkSession();
      if (session.status === 'signed_out') {
        if (!silent) navigate('/login');
        return;
      }
      if (session.status === 'unavailable') {
        if (!isActive() || silent) return;
        setErroCarga(true);
        setLoading(false);
        return;
      }

      if (!silent) setLoading(true);
      // `owner_id` sozinho e a ancora antiga: para o gerente de unidade isto ficava NULO e o
      // historico "N turnos com voce" do cartao sumia, embora a lista de membros (que ja usa o
      // seam) aparecesse — duas metades da mesma tela discordando sobre qual empresa e esta.
      const empresaOperada = await getAuthenticatedCompanyId().catch(() => null);
      if (isActive() && empresaOperada) setCompanyId(empresaOperada);

      try {
        const [members, all] = await Promise.all([
          TeamConnectionService.listTeamMembers(),
          TeamConnectionService.listAllConnections(),
        ]);
        if (!isActive() || !claim()) return;
        setTeamMembers(members);
        setPendingConnections(all.filter((c) => c.status === 'pending'));
        setErroCarga(false);
      } catch (error) {
        if (!isActive()) return;
        // Mantém o que já estava na tela e sinaliza a falha.
        logError('useCompanyTeam.load', error);
        if (silent) return;
        setErroCarga(true);
      }
      setLoading(false);
    },
    [navigate, beginTeam],
  );

  useEffect(() => {
    let active = true;
    void fetchTeam(() => active);
    return () => {
      active = false;
    };
  }, [fetchTeam]);

  const load = useCallback(
    (options?: { silent?: boolean }) => {
      const done = fetchTeam(undefined, options?.silent === true);
      // Só a recarga de fundo devolve a promessa (quem a espera é o tempo real).
      return options?.silent ? done : void done;
    },
    [fetchTeam],
  );

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

  return { teamMembers, pendingConnections, loading, erroCarga, companyId, addWorker, removeWorker, refresh: load };
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
  erroCarga: boolean;
  /** Aceitar convite de equipe. */
  acceptConnection: (connectionId: string) => Promise<boolean>;
  /** Bloquear/sair de uma empresa. */
  blockConnection: (connectionId: string) => Promise<boolean>;
  declineConnection: (connectionId: string) => Promise<boolean>;
  /** Recarregar dados. `silent`: sem esqueleto e sem trocar a tela por erro. */
  refresh: (options?: { silent?: boolean }) => unknown;
}

export function useWorkerStores(): UseWorkerStoresResult {
  const [myStores, setMyStores] = useState<MyStore[]>([]);
  const [pendingConnections, setPendingConnections] = useState<TeamConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [erroCarga, setErroCarga] = useState(false);
  const navigate = useNavigate();
  const { addToast } = useToast();

  const beginStores = useLatestResponse();
  const load = useCallback(
    async (isActive: () => boolean = () => true, silent = false) => {
      const claim = beginStores();
      const session = await checkSession();
      if (!isActive()) return;
      if (session.status === 'signed_out') {
        if (!silent) navigate('/login');
        return;
      }
      if (session.status === 'unavailable') {
        if (silent) return;
        setErroCarga(true);
        setLoading(false);
        return;
      }

      if (!silent) setLoading(true);
      const [stores, pending] = await Promise.all([
        TeamConnectionService.listMyStores(),
        TeamConnectionService.listPendingConnections(),
      ]);
      if (!isActive()) return;
      if (silent && (stores === null || pending === null)) return;
      if (!claim()) return;

      // null = fetch falhou; manter o que ja esta na tela e sinalizar erro em vez de
      // esvaziar a carteira ("Voce ainda nao tem clientes" mentiria — N1).
      setErroCarga(stores === null || pending === null);
      if (stores !== null) setMyStores(stores);
      if (pending !== null) setPendingConnections(pending);
      setLoading(false);
    },
    [navigate, beginStores],
  );

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [load]);

  const refresh = useCallback(
    (options?: { silent?: boolean }) => {
      const done = load(undefined, options?.silent === true);
      // Só a recarga de fundo devolve a promessa (quem a espera é o tempo real).
      return options?.silent ? done : void done;
    },
    [load],
  );

  const acceptConnection = useCallback(
    async (connectionId: string): Promise<boolean> => {
      const result = await TeamConnectionService.acceptConnection(connectionId);
      if (result.error) {
        addToast(result.error, 'error');
        return false;
      }
      addToast('Empresa adicionada às suas empresas!', 'success');
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
    erroCarga,
    acceptConnection,
    blockConnection,
    declineConnection,
    refresh,
  };
}
