/**
 * TeamConnectionService — gerencia o roster "minha equipe" (Slice 1, R1/R2).
 *
 * Modelo: aresta bilateral consentida (handshake UMA vez).
 * - Empresa adiciona o freela via QR / link / telefone → conexão nasce 'pending'.
 * - Freela aceita → 'accepted'. Convites de turno seguintes NÃO re-pedem handshake.
 * - Freela pode sair/bloquear → 'blocked'.
 *
 * Avisos do architect (ADR-001):
 * - Criar-turno e aceite NÃO chamam reserve_escrow (postpago é Slice 2).
 * - A empresa NÃO pode forjar 'accepted' (RLS WITH CHECK).
 * - Envio de SMS para o canal 'phone' é Slice 4 — aqui só criamos o registro.
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import type {
  TeamConnection,
  TeamConnectionSource,
  TeamConnectionStatus,
  TeamMember,
  MyStore,
  WorkerProfile,
  CompanyProfile,
} from '../types';

// ---------------------------------------------------------------------------
// Tipos auxiliares internos
// ---------------------------------------------------------------------------

export interface CreateConnectionResult {
  connection: TeamConnection | null;
  error?: string;
  /** true quando a conexão já existia (idempotência de convite de equipe) */
  alreadyExists?: boolean;
}

export interface UpdateConnectionResult {
  success: boolean;
  error?: string;
}

/**
 * Token de convite de conexão via link (R1-b).
 * Gerado pelo service e armazenado como metadata na conexão.
 * Resolução: o link traz o token → service lê a conexão pending → worker aceita.
 */
export interface ConnectionInviteToken {
  token: string;
  /** URL pública do link de convite */
  url: string;
}

/** Prefixo que identifica um token de convite gerado por um WORKER (link transitivo). */
const WORKER_TOKEN_PREFIX = 'w_';

// ---------------------------------------------------------------------------
// Helpers de query de empresa (session)
// ---------------------------------------------------------------------------

/**
 * Retorna o `company_id` da empresa autenticada.
 * Lança erro se não houver sessão ou se o usuário não for empresa.
 */
async function getAuthenticatedCompanyId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Sessão expirada. Faça login novamente.');

  const { data: company, error } = await supabase
    .from('companies')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle();

  if (error) throw error;
  if (!company) throw new Error('Perfil de empresa não encontrado.');

  return company.id as string;
}

// ---------------------------------------------------------------------------
// TeamConnectionService
// ---------------------------------------------------------------------------

export const TeamConnectionService = {
  // -------------------------------------------------------------------------
  // EMPRESA: adicionar freela à equipe
  // -------------------------------------------------------------------------

  /**
   * Adiciona um worker ao roster da empresa (cria conexão 'pending').
   *
   * @param workerId  UUID do worker (a câmera/scan é responsabilidade da UI).
   * @param source    Canal de origem: 'qr' | 'link' | 'phone'.
   *
   * Canal 'phone': cria o registro pending; o envio de SMS é Slice 4 (NÃO chamado aqui).
   * Canal 'link':  gera um token estável; use `generateInviteToken()` para obter a URL.
   * Canal 'qr':    a UI fornece o workerId após decode do QR; apenas cria a conexão.
   *
   * Idempotente: se a conexão já existir retorna `alreadyExists: true` sem erro.
   */
  async addToTeam(
    workerId: string,
    source: TeamConnectionSource,
  ): Promise<CreateConnectionResult> {
    try {
      const companyId = await getAuthenticatedCompanyId();

      // Verificar se já existe (idempotência — UNIQUE team_connections_unique_pair)
      const { data: existing, error: checkErr } = await supabase
        .from('team_connections')
        .select('*')
        .eq('company_id', companyId)
        .eq('worker_id', workerId)
        .maybeSingle();

      if (checkErr) {
        logError('teamConnection.addToTeam.check', checkErr);
        return { connection: null, error: 'Erro ao verificar conexão existente.' };
      }

      if (existing) {
        return {
          connection: existing as TeamConnection,
          alreadyExists: true,
        };
      }

      const { data, error } = await supabase
        .from('team_connections')
        .insert({
          company_id: companyId,
          worker_id: workerId,
          status: 'pending' as TeamConnectionStatus,
          source,
        })
        .select()
        .single();

      if (error) {
        // Corrida: insert concorrente pode ter criado antes de nós (race condition)
        if (error.code === '23505') {
          return { connection: null, alreadyExists: true };
        }
        logError('teamConnection.addToTeam.insert', error);
        return { connection: null, error: 'Não foi possível adicionar o freela à equipe.' };
      }

      return { connection: data as TeamConnection };
    } catch (err) {
      logError('teamConnection.addToTeam', err);
      return {
        connection: null,
        error: err instanceof Error ? err.message : 'Erro inesperado.',
      };
    }
  },

  /**
   * Gera um token de convite de link estável para a empresa.
   *
   * Estratégia: o token é derivado APENAS do `company_id` (base64url),
   * portanto é estável entre renders — o link enviado ao freela não muda.
   * Segurança real vem do RLS; o token só identifica a empresa do link.
   * A UI monta a URL: `https://app.worki.com/convite/{token}`.
   * O resolver do link chama `resolveInviteToken(token)` para descobrir a empresa.
   */
  generateInviteToken(companyId: string): ConnectionInviteToken {
    // Token estável: derivado apenas do company_id (sem timestamp).
    const token = btoa(companyId).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const url = `${window.location.origin}/convite/${token}`;
    return { token, url };
  },

  /**
   * Resolve um token de link de convite → retorna o `company_id`.
   * Retorna null se o token for inválido, malformado, ou for um token de worker
   * (prefixo `w_` — ver `generateWorkerInviteToken`).
   */
  resolveInviteToken(token: string): string | null {
    if (this.isWorkerInviteToken(token)) return null;
    try {
      // Reverter base64url → base64 padrão antes de decodificar
      const padded = token.replace(/-/g, '+').replace(/_/g, '/');
      const companyId = atob(padded);
      if (!companyId || companyId.length < 30) return null;
      return companyId;
    } catch {
      return null;
    }
  },

  // -------------------------------------------------------------------------
  // Link transitivo — "meu link" (worker) + repasse de contato já conectado
  // -------------------------------------------------------------------------

  /**
   * Gera um token de convite de link ESTÁVEL para um WORKER (direção inversa do
   * `generateInviteToken`, que é empresa→worker).
   *
   * Uso (R-transitivo):
   * - Worker gera o próprio link ("Meu link") e compartilha com uma empresa.
   * - Empresa que JÁ tem esse worker no elenco pode repassar o MESMO link a
   *   outra empresa (ex.: "tenho o Adriano no elenco → repasso o link dele
   *   pro Gabriel"). Não é preciso pedir ao worker — a empresa já conhece o
   *   `worker_id` via `team_connections`.
   *
   * Prefixo `w_` distingue de um token de empresa (`generateInviteToken`),
   * que não tem prefixo. Resolução acontece em `resolveWorkerInviteToken`.
   * A URL usa a MESMA rota `/convite/:token` — `InviteAccept` decide o fluxo
   * pelo prefixo.
   */
  generateWorkerInviteToken(workerId: string): ConnectionInviteToken {
    const encoded = btoa(workerId).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const token = `${WORKER_TOKEN_PREFIX}${encoded}`;
    const url = `${window.location.origin}/convite/${token}`;
    return { token, url };
  },

  /** true se o token for um link de worker (prefixo `w_`). */
  isWorkerInviteToken(token: string): boolean {
    return token.startsWith(WORKER_TOKEN_PREFIX);
  },

  /**
   * Resolve um token de link de worker → retorna o `worker_id`.
   * Retorna null se o token não tiver o prefixo `w_` ou for malformado.
   */
  resolveWorkerInviteToken(token: string): string | null {
    if (!this.isWorkerInviteToken(token)) return null;
    try {
      const raw = token.slice(WORKER_TOKEN_PREFIX.length);
      const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
      const workerId = atob(padded);
      if (!workerId || workerId.length < 30) return null;
      return workerId;
    } catch {
      return null;
    }
  },

  /**
   * Adiciona o worker do link (`w_...`) à equipe da EMPRESA autenticada.
   *
   * Direção inversa de `addToTeamByToken`: aqui quem abre o link precisa estar
   * autenticado como EMPRESA (o worker é identificado pelo token, não pela
   * sessão). Reusa `addToTeam` (mesma idempotência/RLS já usada pelo canal
   * 'phone' — a empresa já pode adicionar qualquer `worker_id` que conheça).
   *
   * Se a sessão ativa não for de uma empresa, `addToTeam` retorna o erro de
   * `getAuthenticatedCompanyId()` (ex.: "Perfil de empresa não encontrado.").
   */
  async addWorkerToTeamByToken(token: string): Promise<CreateConnectionResult> {
    const workerId = this.resolveWorkerInviteToken(token);
    if (!workerId) {
      return { connection: null, error: 'Link de contato inválido ou expirado.' };
    }

    const { data: worker, error: workerErr } = await supabase
      .from('workers')
      .select('id')
      .eq('id', workerId)
      .maybeSingle();

    if (workerErr) {
      logError('teamConnection.addWorkerToTeamByToken.check', workerErr);
      return { connection: null, error: 'Erro ao verificar o freela do link.' };
    }
    if (!worker) {
      return { connection: null, error: 'Freela do link não encontrado.' };
    }

    return this.addToTeam(workerId, 'link');
  },

  /**
   * Adiciona o worker autenticado à equipe da empresa identificada pelo token de convite.
   *
   * O `workerId` é derivado da sessão ativa (NÃO aceito por parâmetro) para evitar
   * que um worker A passe workerId=B e crie conexão em nome de B sem consentimento.
   *
   * Fluxo: worker clica no link → chama este método (sem args de identidade) →
   * conexão criada como 'pending'; worker aceita via acceptConnection.
   *
   * @param token  Token de convite da URL (gerado por generateInviteToken).
   */
  async addToTeamByToken(token: string): Promise<CreateConnectionResult> {
    // 1. Resolver empresa a partir do token
    const companyId = this.resolveInviteToken(token);
    if (!companyId) {
      return { connection: null, error: 'Link de convite inválido ou expirado.' };
    }

    // 2. Derivar workerId da sessão autenticada
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { connection: null, error: 'Sessão expirada. Faça login antes de aceitar o convite.' };
    }
    const workerId = user.id;

    // 3. Verificar que a empresa existe
    const { data: company, error: cErr } = await supabase
      .from('companies')
      .select('id')
      .eq('id', companyId)
      .single();

    if (cErr || !company) {
      return { connection: null, error: 'Empresa do convite não encontrada.' };
    }

    // 4. Idempotência: verificar se já existe a conexão
    const { data: existing } = await supabase
      .from('team_connections')
      .select('*')
      .eq('company_id', companyId)
      .eq('worker_id', workerId)
      .maybeSingle();

    if (existing) {
      return { connection: existing as TeamConnection, alreadyExists: true };
    }

    // 5. Inserir conexão pending
    const { data, error } = await supabase
      .from('team_connections')
      .insert({
        company_id: companyId,
        worker_id: workerId,
        status: 'pending' as TeamConnectionStatus,
        source: 'link' as TeamConnectionSource,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return { connection: null, alreadyExists: true };
      }
      logError('teamConnection.addToTeamByToken.insert', error);
      return { connection: null, error: 'Não foi possível registrar o convite.' };
    }

    return { connection: data as TeamConnection };
  },

  // -------------------------------------------------------------------------
  // WORKER: aceitar ou bloquear/sair
  // -------------------------------------------------------------------------

  /**
   * Worker aceita uma conexão pendente (pending → accepted).
   * Máquina de estados validada aqui: só aceita se status for 'pending'.
   */
  async acceptConnection(connectionId: string): Promise<UpdateConnectionResult> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { success: false, error: 'Sessão expirada.' };

      // Validar estado atual (máquina de estados no service — ADR-001)
      const { data: current, error: fetchErr } = await supabase
        .from('team_connections')
        .select('id, status, worker_id')
        .eq('id', connectionId)
        .maybeSingle();

      if (fetchErr) {
        logError('teamConnection.acceptConnection.fetch', fetchErr);
        return { success: false, error: 'Conexão não encontrada.' };
      }
      if (!current) return { success: false, error: 'Conexão não encontrada.' };
      if (current.worker_id !== user.id) {
        return { success: false, error: 'Você não é o freela desta conexão.' };
      }
      if (current.status !== 'pending') {
        return {
          success: false,
          error: `Transição inválida: status atual é '${current.status}', esperado 'pending'.`,
        };
      }

      const { error } = await supabase
        .from('team_connections')
        .update({
          status: 'accepted' as TeamConnectionStatus,
          accepted_at: new Date().toISOString(),
        })
        .eq('id', connectionId)
        .eq('worker_id', user.id);

      if (error) {
        logError('teamConnection.acceptConnection.update', error);
        return { success: false, error: 'Erro ao aceitar conexão.' };
      }

      return { success: true };
    } catch (err) {
      logError('teamConnection.acceptConnection', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro inesperado.',
      };
    }
  },

  /**
   * Worker sai/bloqueia uma empresa (→ 'blocked').
   * Funciona para status 'pending' (recusar convite de equipe) ou 'accepted' (sair).
   */
  async blockConnection(connectionId: string): Promise<UpdateConnectionResult> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { success: false, error: 'Sessão expirada.' };

      // Validar propriedade (deve ser o worker da conexão)
      const { data: current, error: fetchErr } = await supabase
        .from('team_connections')
        .select('id, status, worker_id')
        .eq('id', connectionId)
        .maybeSingle();

      if (fetchErr || !current) {
        logError('teamConnection.blockConnection.fetch', fetchErr);
        return { success: false, error: 'Conexão não encontrada.' };
      }
      if (current.worker_id !== user.id) {
        return { success: false, error: 'Você não é o freela desta conexão.' };
      }
      if (current.status === 'blocked') {
        return { success: true }; // já bloqueada — idempotente
      }

      const { error } = await supabase
        .from('team_connections')
        .update({
          status: 'blocked' as TeamConnectionStatus,
          blocked_by: user.id,
        })
        .eq('id', connectionId)
        .eq('worker_id', user.id);

      if (error) {
        logError('teamConnection.blockConnection.update', error);
        return { success: false, error: 'Erro ao bloquear conexão.' };
      }

      return { success: true };
    } catch (err) {
      logError('teamConnection.blockConnection', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro inesperado.',
      };
    }
  },

  // -------------------------------------------------------------------------
  // EMPRESA: listar equipe aceita ("minha equipe")
  // -------------------------------------------------------------------------

  /**
   * Lista os membros aceitos da equipe da empresa autenticada.
   * Retorna conexões 'accepted' com perfil do worker embutido.
   */
  async listTeamMembers(): Promise<TeamMember[]> {
    try {
      const companyId = await getAuthenticatedCompanyId();

      const { data, error } = await supabase
        .from('team_connections')
        .select(
          `
          *,
          worker:workers (
            id,
            full_name,
            avatar_url,
            photo_url,
            primary_role,
            roles,
            rating_average,
            reviews_count,
            completed_jobs_count,
            city
          )
        `,
        )
        .eq('company_id', companyId)
        .eq('status', 'accepted')
        .order('accepted_at', { ascending: false });

      if (error) {
        logError('teamConnection.listTeamMembers', error);
        return [];
      }

      return ((data ?? []) as Array<TeamConnection & { worker: WorkerProfile }>).map(
        (row) => ({
          connection: {
            id: row.id,
            company_id: row.company_id,
            worker_id: row.worker_id,
            status: row.status,
            source: row.source,
            blocked_by: row.blocked_by,
            created_at: row.created_at,
            accepted_at: row.accepted_at,
            updated_at: row.updated_at,
          },
          worker: row.worker,
        }),
      );
    } catch (err) {
      logError('teamConnection.listTeamMembers', err);
      return [];
    }
  },

  /**
   * Lista todas as conexões da empresa (pending + accepted + blocked).
   * Útil para a UI de gestão da equipe.
   */
  async listAllConnections(): Promise<TeamConnection[]> {
    try {
      const companyId = await getAuthenticatedCompanyId();

      const { data, error } = await supabase
        .from('team_connections')
        .select(
          `
          *,
          worker:workers (
            id,
            full_name,
            avatar_url,
            photo_url,
            primary_role,
            rating_average,
            city
          )
        `,
        )
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (error) {
        logError('teamConnection.listAllConnections', error);
        return [];
      }

      return (data ?? []) as TeamConnection[];
    } catch (err) {
      logError('teamConnection.listAllConnections', err);
      return [];
    }
  },

  // -------------------------------------------------------------------------
  // WORKER: listar "minhas lojas"
  // -------------------------------------------------------------------------

  /**
   * Lista as conexões aceitas do worker autenticado ("minhas lojas").
   * Retorna conexões 'accepted' com perfil da empresa embutido.
   */
  async listMyStores(): Promise<MyStore[]> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('team_connections')
        .select(
          `
          *,
          company:companies (
            id,
            name,
            logo_url,
            rating_average,
            reviews_count,
            industry,
            address
          )
        `,
        )
        .eq('worker_id', user.id)
        .eq('status', 'accepted')
        .order('accepted_at', { ascending: false });

      if (error) {
        logError('teamConnection.listMyStores', error);
        return [];
      }

      return ((data ?? []) as Array<TeamConnection & { company: CompanyProfile }>).map(
        (row) => ({
          connection: {
            id: row.id,
            company_id: row.company_id,
            worker_id: row.worker_id,
            status: row.status,
            source: row.source,
            blocked_by: row.blocked_by,
            created_at: row.created_at,
            accepted_at: row.accepted_at,
            updated_at: row.updated_at,
          },
          company: row.company,
        }),
      );
    } catch (err) {
      logError('teamConnection.listMyStores', err);
      return [];
    }
  },

  /**
   * Lista conexões pendentes (convites de equipe) do worker autenticado.
   * Para a UI do worker aceitar/recusar convites de equipe.
   */
  async listPendingConnections(): Promise<TeamConnection[]> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('team_connections')
        .select(
          `
          *,
          company:companies (
            id,
            name,
            logo_url,
            rating_average,
            industry,
            address
          )
        `,
        )
        .eq('worker_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) {
        logError('teamConnection.listPendingConnections', error);
        return [];
      }

      return (data ?? []) as TeamConnection[];
    } catch (err) {
      logError('teamConnection.listPendingConnections', err);
      return [];
    }
  },

  // -------------------------------------------------------------------------
  // Validação: checar se um worker é da equipe aceita de uma empresa
  // -------------------------------------------------------------------------

  /**
   * Retorna true se o worker for conexão 'accepted' da empresa.
   * Usado antes de criar um convite de turno (R5/ADR-001).
   */
  async isWorkerInTeam(companyId: string, workerId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('team_connections')
      .select('id')
      .eq('company_id', companyId)
      .eq('worker_id', workerId)
      .eq('status', 'accepted')
      .maybeSingle();

    if (error) {
      logError('teamConnection.isWorkerInTeam', error);
      return false;
    }

    return !!data;
  },
};
