/**
 * CertificationService — Repositório de certificações e capacitações (F8).
 *
 * Spec: `.harness/spec/certificacoes/spec.md`.
 * DDL aprovado (fonte normativa — prevalece sobre a spec): `.harness/spec/certificacoes/ddl-aprovado.md`.
 * ADR: `.harness/memory-bank/decisions/ADR-20260821-certificacoes-metadado-sem-arquivo.md`.
 * Migration: `supabase/migrations/20260817001300_worker_certifications_trainings.sql`.
 *
 * Dois objetos, políticas de escrita opostas:
 * - `worker_trainings` (interno): só a EMPRESA com vínculo insere (nunca o freela — DS3 fecha a
 *   auto-atribuição via FK para `companies` + `worker_id <> company_id`). Revoga-se, não se apaga.
 * - `worker_certifications` (externo): só o FREELA insere/edita conteúdo. Empresa com vínculo só
 *   escreve `verified_*`, sempre em nome própria (`is_company_owner`). Editar conteúdo DERRUBA a
 *   conferência anterior (DS2, trigger `enforce_certification_update_scope`) — nunca reconferimos
 *   no client, é o banco quem decide.
 *
 * O que este service NUNCA faz (D1/D2 do gate):
 * - Upload de arquivo / bucket / signed URL — v1 é só metadado (ADR-20260821).
 * - Calcular ou gravar "status de validade" — vencimento é SEMPRE derivado via
 *   `isCertificationExpired` (`lib/dateUtils.ts`), nunca persistido.
 * - Escrever em `notified_30d_at`/`notified_expired_at` — são livro-caixa exclusivo do agendador
 *   (fora do `GRANT UPDATE` de coluna; um payload que as inclua falha com 42501).
 *
 * Padrão do projeto: `useState`/`useEffect` + supabase direto (Article 5), erros por retorno
 * estruturado (nunca throw para a UI), `logError` para diagnóstico.
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import type { WorkerCertification, WorkerTraining } from '../types';
import { getAuthenticatedCompanyId as resolverEmpresaDaSessao } from './companyScopeService';

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

export interface CertificationMutationResult {
  success: boolean;
  error?: string;
}

export interface CreateCertificationResult {
  certification: WorkerCertification | null;
  error?: string;
}

export interface CreateTrainingResult {
  training: WorkerTraining | null;
  error?: string;
}

/** Campos de CONTEÚDO editáveis pelo dono da certificação (freela) — nunca `verified_*`. */
export interface CertificationContentInput {
  title: string;
  issuer?: string | null;
  registration_number?: string | null;
  issued_at?: string | null;
  expires_at?: string | null;
}

/** Formato mínimo devolvido pelo Postgres em erros de query do supabase-js. */
interface SupabaseErrorLike {
  code?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Retorna o `company_id` da empresa autenticada.
 * Lança erro se não houver sessão ou se o usuário não for empresa.
 * (Mesmo helper duplicado em `teamListService.ts`/`teamConnectionService.ts` — o projeto não tem
 * módulo compartilhado de sessão de empresa; duplicar aqui mantém o service independente.)
 */
async function getAuthenticatedCompanyId(): Promise<string> {
    // Delega ao seam: `owner_id` sozinho e a ancora ANTIGA -- nao cobre empresa cujo id e o do
  // proprio usuario, nem gerente de unidade (company_members). Ver companyScopeService.
  return resolverEmpresaDaSessao();
}

/**
 * Retorna o id do freela autenticado (`workers.id = auth.users.id`, mesmo padrão de
 * `attendanceConfirmationService`/`paymentRecordService` — nunca uma tabela separada de sessão).
 */
async function getAuthenticatedWorkerId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Sessão expirada. Faça login novamente.');
  return user.id;
}

/** Traduz erro de RLS (42501 / "row-level security") para mensagem útil — nunca repassa texto cru. */
function translateRlsError(error: SupabaseErrorLike | null | undefined, fallback: string): string {
  const code = error?.code ?? '';
  const message = (error?.message ?? '').toLowerCase();
  if (code === '42501' || message.includes('row-level security')) {
    return 'Você não tem vínculo com este freela, ou a permissão mudou.';
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// CertificationService
// ---------------------------------------------------------------------------

export const CertificationService = {
  // ---------------------------------------------------------------------
  // worker_certifications — dono é o freela
  // ---------------------------------------------------------------------

  /** Lista as próprias certificações (freela autenticado). */
  async listMyCertifications(): Promise<WorkerCertification[] | null> {
    try {
      const workerId = await getAuthenticatedWorkerId();
      const { data, error } = await supabase
        .from('worker_certifications')
        .select('*')
        .eq('worker_id', workerId)
        .order('created_at', { ascending: false });

      if (error) {
        logError('certification.listMyCertifications', error);
        return null;
      }
      return (data ?? []) as WorkerCertification[];
    } catch (err) {
      logError('certification.listMyCertifications', err);
      return null;
    }
  },

  /**
   * Lista as certificações de um freela específico (empresa com vínculo — `can_view_worker_profile`
   * na policy `wc_select`; RLS decide, aqui só propagamos o filtro por `worker_id`).
   * Vencida NUNCA é filtrada aqui (R8) — a UI decide o badge via `isCertificationExpired`.
   */
  async listWorkerCertifications(workerId: string): Promise<WorkerCertification[]> {
    try {
      const { data, error } = await supabase
        .from('worker_certifications')
        .select('*')
        .eq('worker_id', workerId)
        .order('created_at', { ascending: false });

      if (error) {
        logError('certification.listWorkerCertifications', error);
        return [];
      }
      return (data ?? []) as WorkerCertification[];
    } catch (err) {
      logError('certification.listWorkerCertifications', err);
      return [];
    }
  },

  /**
   * Cadastra uma certificação (só o próprio freela — `wc_insert_owner` exige `verified_*`/`notified_*`
   * nulos no INSERT, então nunca enviamos esses campos aqui).
   */
  async createCertification(input: CertificationContentInput): Promise<CreateCertificationResult> {
    try {
      const trimmedTitle = input.title.trim();
      if (!trimmedTitle) {
        return { certification: null, error: 'Informe um título para a certificação.' };
      }

      const workerId = await getAuthenticatedWorkerId();

      const { data, error } = await supabase
        .from('worker_certifications')
        .insert({
          worker_id: workerId,
          title: trimmedTitle,
          issuer: input.issuer ?? null,
          registration_number: input.registration_number ?? null,
          issued_at: input.issued_at ?? null,
          expires_at: input.expires_at ?? null,
        })
        .select()
        .single();

      if (error || !data) {
        logError('certification.createCertification', error);
        return { certification: null, error: 'Não foi possível cadastrar a certificação.' };
      }

      return { certification: data as WorkerCertification };
    } catch (err) {
      logError('certification.createCertification', err);
      return { certification: null, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  /**
   * Edita o CONTEÚDO de uma certificação (só o dono — trigger valida o ator no banco).
   * Envia SÓ os campos de conteúdo: nunca `verified_*`/`notified_*` (o `GRANT UPDATE` de coluna
   * até aceitaria enviá-los sem mudança, mas manter o payload restrito evita erro silencioso caso
   * o caller monte o objeto errado). Editar conteúdo DERRUBA a conferência da empresa (DS2) — isso
   * é decisão do trigger, não deste service; a UI deve avisar antes de chamar este método.
   * `.select('id')` + checagem de 0 linhas: sob RLS, UPDATE que não casa com `USING` retorna 0
   * linhas sem erro (mesmo padrão de `teamListService.renameList`).
   */
  async updateCertificationContent(
    id: string,
    input: CertificationContentInput,
  ): Promise<CertificationMutationResult> {
    try {
      const trimmedTitle = input.title.trim();
      if (!trimmedTitle) {
        return { success: false, error: 'Informe um título para a certificação.' };
      }

      const { data, error } = await supabase
        .from('worker_certifications')
        .update({
          title: trimmedTitle,
          issuer: input.issuer ?? null,
          registration_number: input.registration_number ?? null,
          issued_at: input.issued_at ?? null,
          expires_at: input.expires_at ?? null,
        })
        .eq('id', id)
        .select('id');

      if (error) {
        logError('certification.updateCertificationContent', error);
        return { success: false, error: 'Não foi possível editar a certificação.' };
      }

      if (!data || data.length === 0) {
        return {
          success: false,
          error: 'Não foi possível editar: a certificação não existe mais ou não é sua.',
        };
      }

      return { success: true };
    } catch (err) {
      logError('certification.updateCertificationContent', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  /** Exclui uma certificação (só o dono — `wc_delete_owner`, LGPD art. 18, VI). */
  async deleteCertification(id: string): Promise<CertificationMutationResult> {
    try {
      const { data, error } = await supabase
        .from('worker_certifications')
        .delete()
        .eq('id', id)
        .select('id');

      if (error) {
        logError('certification.deleteCertification', error);
        return { success: false, error: 'Não foi possível excluir a certificação.' };
      }

      if (!data || data.length === 0) {
        return {
          success: false,
          error: 'Não foi possível excluir: a certificação não existe mais ou não é sua.',
        };
      }

      return { success: true };
    } catch (err) {
      logError('certification.deleteCertification', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  /**
   * Empresa marca a certificação como conferida, SEMPRE em nome própria (o trigger rejeita
   * `verified_by_company_id` diferente de `is_company_owner`). Nunca envia campos de conteúdo —
   * o trigger rejeitaria o UPDATE inteiro se algum viesse alterado (A6).
   */
  async verifyCertification(id: string, note?: string): Promise<CertificationMutationResult> {
    try {
      const companyId = await getAuthenticatedCompanyId();
      const trimmedNote = note?.trim();

      const { data, error } = await supabase
        .from('worker_certifications')
        .update({
          verified_by_company_id: companyId,
          verified_note: trimmedNote && trimmedNote.length > 0 ? trimmedNote : null,
        })
        .eq('id', id)
        .select('id');

      if (error) {
        logError('certification.verifyCertification', error);
        return { success: false, error: translateRlsError(error, 'Não foi possível conferir a certificação.') };
      }

      if (!data || data.length === 0) {
        return {
          success: false,
          error: 'Não foi possível conferir: você não tem mais vínculo com este freela.',
        };
      }

      return { success: true };
    } catch (err) {
      logError('certification.verifyCertification', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  /**
   * Remove a conferência (empresa desfaz um "marcar como conferida" feito por engano). O trigger
   * zera `verified_at`/`verified_note` junto quando `verified_by_company_id` vai para NULL.
   */
  async unverifyCertification(id: string): Promise<CertificationMutationResult> {
    try {
      const { data, error } = await supabase
        .from('worker_certifications')
        .update({ verified_by_company_id: null })
        .eq('id', id)
        .select('id');

      if (error) {
        logError('certification.unverifyCertification', error);
        return { success: false, error: translateRlsError(error, 'Não foi possível desfazer a conferência.') };
      }

      if (!data || data.length === 0) {
        return {
          success: false,
          error: 'Não foi possível desfazer: você não tem mais vínculo com este freela.',
        };
      }

      return { success: true };
    } catch (err) {
      logError('certification.unverifyCertification', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  // ---------------------------------------------------------------------
  // worker_trainings — dono é a empresa
  // ---------------------------------------------------------------------

  /** Lista os próprios treinamentos (freela autenticado — dado pessoal sobre ele, LGPD art. 18, II). */
  async listMyTrainings(): Promise<WorkerTraining[]> {
    try {
      const workerId = await getAuthenticatedWorkerId();
      const { data, error } = await supabase
        .from('worker_trainings')
        .select('*')
        .eq('worker_id', workerId)
        .order('completed_at', { ascending: false });

      if (error) {
        logError('certification.listMyTrainings', error);
        return [];
      }
      return (data ?? []) as WorkerTraining[];
    } catch (err) {
      logError('certification.listMyTrainings', err);
      return [];
    }
  },

  /**
   * Lista os treinamentos que a EMPRESA AUTENTICADA registrou para um freela (nunca os de outra
   * empresa — A15/R12: a policy `wt_select` já ancora em `is_company_owner(company_id)`, mas o
   * filtro explícito por `company_id` aqui documenta a intenção e evita que um caller esqueça o
   * `.eq` e trate "0 linhas por RLS" como "esse freela nunca foi treinado").
   */
  async listCompanyTrainings(workerId: string): Promise<WorkerTraining[]> {
    try {
      const companyId = await getAuthenticatedCompanyId();
      const { data, error } = await supabase
        .from('worker_trainings')
        .select('*')
        .eq('worker_id', workerId)
        .eq('company_id', companyId)
        .order('completed_at', { ascending: false });

      if (error) {
        logError('certification.listCompanyTrainings', error);
        return [];
      }
      return (data ?? []) as WorkerTraining[];
    } catch (err) {
      logError('certification.listCompanyTrainings', err);
      return [];
    }
  },

  /**
   * Registra um treinamento interno (só empresa com vínculo real — DS3: a FK para `companies` +
   * `worker_id <> company_id` fecham a auto-atribuição pelo freela; a policy ainda exige
   * `can_view_worker_profile(worker_id)` e `created_by = auth.uid()`).
   */
  async registerTraining(
    workerId: string,
    title: string,
    completedAt: string,
    note?: string,
  ): Promise<CreateTrainingResult> {
    try {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        return { training: null, error: 'Informe um título para o treinamento.' };
      }

      const companyId = await getAuthenticatedCompanyId();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { training: null, error: 'Sessão expirada. Faça login novamente.' };

      const trimmedNote = note?.trim();

      const { data, error } = await supabase
        .from('worker_trainings')
        .insert({
          company_id: companyId,
          worker_id: workerId,
          title: trimmedTitle,
          completed_at: completedAt,
          note: trimmedNote && trimmedNote.length > 0 ? trimmedNote : null,
          created_by: user.id,
        })
        .select()
        .single();

      if (error || !data) {
        logError('certification.registerTraining', error);
        return {
          training: null,
          error: translateRlsError(error, 'Não foi possível registrar o treinamento.'),
        };
      }

      return { training: data as WorkerTraining };
    } catch (err) {
      logError('certification.registerTraining', err);
      return { training: null, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  /**
   * Revoga um treinamento registrado por engano (one-way — o trigger rejeita reverter um
   * `revoked_at` já preenchido). Só a empresa dona do registro (`is_company_owner`, via RLS).
   * Sem policy de DELETE nesta tabela: é registro de auditoria, revoga-se, não se apaga.
   */
  async revokeTraining(id: string, reason: string): Promise<CertificationMutationResult> {
    try {
      const trimmedReason = reason.trim();
      if (!trimmedReason) {
        return { success: false, error: 'Informe o motivo da revogação.' };
      }

      const { data, error } = await supabase
        .from('worker_trainings')
        .update({ revoked_at: new Date().toISOString(), revoked_reason: trimmedReason })
        .eq('id', id)
        .select('id');

      if (error) {
        logError('certification.revokeTraining', error);
        return { success: false, error: 'Não foi possível revogar o treinamento.' };
      }

      if (!data || data.length === 0) {
        return {
          success: false,
          error: 'Não foi possível revogar: o treinamento não existe mais ou não é seu.',
        };
      }

      return { success: true };
    } catch (err) {
      logError('certification.revokeTraining', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },
};
