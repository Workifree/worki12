/**
 * TeamListService — CRUD das "Listas do Elenco" (F2, `.harness/spec/listas-elenco/spec.md`).
 *
 * Puramente organizacional sobre o elenco já existente (`team_connections`): não cria papel
 * novo, não move dinheiro (Article 8 intacto), não muda a máquina de estados do F1 (Chamado de
 * Turno). Migration: `supabase/migrations/20260817000300_team_lists.sql`.
 * Gate: `.harness/memory-bank/decisions/ADR-20260817-seam-autorizacao-empresa.md`.
 *
 * Landmines do architect (todas obrigatórias — ver ADR + migration):
 * - LM-1: `GRANT UPDATE (name)` é grant de COLUNA. `renameList` envia SÓ `{ name }` — incluir
 *   `updated_at` (ou qualquer outra coluna) devolve 42501 mesmo com RLS satisfeita. `updated_at`
 *   é escrito pelo trigger `normalize_team_list`, nunca pelo client.
 * - LM-2: em `setMembers`, INSERT primeiro, DELETE depois. Não há transação entre chamadas
 *   PostgREST — se o DELETE rodasse antes e o INSERT falhasse na trava de elenco (RLS), a lista
 *   ficaria mutilada (perdeu membros antigos e não ganhou os novos).
 * - LM-3: se não há ninguém para remover, a chamada de DELETE é pulada. `.in('worker_id', [])`
 *   devolve 0 linhas e a checagem de LM-4 leria isso como negação de RLS → erro falso.
 * - LM-4: DELETE/UPDATE sob RLS retorna 0 linhas SEM erro (PostgREST 204). Mesmo padrão de
 *   `teamConnectionService.removeFromTeam`: `.select('id')` sem `maybeSingle()` +
 *   `if (!data || data.length === 0)` em `renameList`, `deleteList` e no DELETE de `setMembers`.
 * - LM-5: `createList` não é atômico (INSERT da lista + INSERT dos membros são duas chamadas
 *   PostgREST). Se a segunda falhar, o INSERT da lista é desfeito (compensação) e o erro
 *   honesto é propagado — nunca fica lista órfã vazia.
 * - LM-6: erro de RLS (42501 / "row-level security") no INSERT de membros é traduzido para
 *   mensagem útil ao usuário, não repassado cru.
 * - LM-11: NÃO existe policy de UPDATE em `team_list_members` — trocar membro é sempre
 *   DELETE + INSERT (é o que `setMembers` faz). Nenhum método deste service tenta um UPDATE ali.
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import type { TeamList, TeamListWithMembers } from '../types';
import { getAuthenticatedCompanyId as resolverEmpresaDaSessao } from './companyScopeService';

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

export interface CreateTeamListResult {
  list: TeamList | null;
  error?: string;
}

export interface TeamListMutationResult {
  success: boolean;
  error?: string;
}

/** Formato mínimo devolvido pelo Postgres em erros de query/RPC do supabase-js. */
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
 * (Mesmo helper de `teamConnectionService.ts` — duplicado de propósito: são services
 * independentes e o projeto não usa um módulo compartilhado de sessão de empresa.)
 */
async function getAuthenticatedCompanyId(): Promise<string> {
    // Delega ao seam: `owner_id` sozinho e a ancora ANTIGA -- nao cobre empresa cujo id e o do
  // proprio usuario, nem gerente de unidade (company_members). Ver companyScopeService.
  return resolverEmpresaDaSessao();
}

/**
 * LM-6: traduz erro de RLS no INSERT de `team_list_members` (o freela não está mais no elenco
 * aceito daquela empresa) para uma mensagem que a pessoa usando a UI entende. Qualquer outro
 * erro cai numa mensagem genérica — nunca repassamos o texto cru do Postgres para a tela.
 */
function translateMembersError(error: SupabaseErrorLike | null | undefined): string {
  const code = error?.code ?? '';
  const message = (error?.message ?? '').toLowerCase();
  if (code === '42501' || message.includes('row-level security')) {
    return 'Um dos freelas selecionados não está mais no seu Elenco.';
  }
  return 'Não foi possível salvar os membros da lista.';
}

// ---------------------------------------------------------------------------
// TeamListService
// ---------------------------------------------------------------------------

export const TeamListService = {
  /**
   * Lista as listas do elenco da empresa autenticada, com os `memberIds` já resolvidos
   * (join `team_list_members` numa única query — sem N+1).
   */
  async listLists(): Promise<TeamListWithMembers[]> {
    try {
      const companyId = await getAuthenticatedCompanyId();

      const { data, error } = await supabase
        .from('team_lists')
        .select('*, team_list_members(worker_id)')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (error) {
        logError('teamList.listLists', error);
        return [];
      }

      type Row = TeamList & { team_list_members: Array<{ worker_id: string }> | null };

      return ((data ?? []) as Row[]).map((row) => ({
        id: row.id,
        company_id: row.company_id,
        name: row.name,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        memberIds: (row.team_list_members ?? []).map((m) => m.worker_id),
      }));
    } catch (err) {
      logError('teamList.listLists', err);
      return [];
    }
  },

  /**
   * Cria uma lista com nome + membros iniciais (membros podem ser vazio — R6 da spec: salvar
   * com zero membros marcados é válido).
   *
   * LM-5: não é atômico (duas chamadas PostgREST). Se o INSERT dos membros falhar, a lista
   * recém-criada é apagada (compensação best-effort) antes de propagar o erro — nunca deixa
   * uma lista vazia órfã por causa de um membro inválido.
   */
  async createList(name: string, workerIds: string[]): Promise<CreateTeamListResult> {
    try {
      const trimmed = name.trim();
      if (!trimmed) {
        return { list: null, error: 'Informe um nome para a lista.' };
      }

      const companyId = await getAuthenticatedCompanyId();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { list: null, error: 'Sessão expirada. Faça login novamente.' };

      const { data: newList, error: insertErr } = await supabase
        .from('team_lists')
        .insert({ company_id: companyId, name: trimmed, created_by: user.id })
        .select()
        .single();

      if (insertErr || !newList) {
        logError('teamList.createList.insert', insertErr);
        return { list: null, error: 'Não foi possível criar a lista.' };
      }

      // Dedup: marcar o mesmo freela duas vezes na UI não deve virar duas linhas (o UNIQUE
      // (list_id, worker_id) derrubaria o INSERT inteiro).
      const uniqueWorkerIds = Array.from(new Set(workerIds));

      if (uniqueWorkerIds.length > 0) {
        const { error: membersErr } = await supabase.from('team_list_members').insert(
          uniqueWorkerIds.map((workerId) => ({
            list_id: newList.id as string,
            worker_id: workerId,
          })),
        );

        if (membersErr) {
          logError('teamList.createList.members', membersErr);
          // LM-5: compensação best-effort. Se o DELETE falhar também, sobra uma lista vazia
          // órfã — pior caso é cosmético (a empresa vê uma lista "Cozinha" com 0 membros e
          // apaga manualmente), nunca dado financeiro nem corrupção de RLS.
          await supabase.from('team_lists').delete().eq('id', newList.id as string);
          return { list: null, error: translateMembersError(membersErr) };
        }
      }

      return { list: newList as TeamList };
    } catch (err) {
      logError('teamList.createList', err);
      return { list: null, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  /**
   * Renomeia uma lista.
   * LM-1: envia SÓ `{ name }` — o GRANT UPDATE é de coluna (só `name`); qualquer outro campo
   * no payload (incluindo `updated_at`) devolve 42501 mesmo com RLS satisfeita.
   * LM-4: `.select('id')` + checagem de 0 linhas — sob RLS um UPDATE que não casa com o
   * `USING` retorna 0 linhas sem erro (204), não exceção.
   */
  async renameList(id: string, name: string): Promise<TeamListMutationResult> {
    try {
      const trimmed = name.trim();
      if (!trimmed) {
        return { success: false, error: 'Informe um nome para a lista.' };
      }

      const { data, error } = await supabase
        .from('team_lists')
        .update({ name: trimmed })
        .eq('id', id)
        .select('id');

      if (error) {
        logError('teamList.renameList', error);
        return { success: false, error: 'Erro ao renomear a lista.' };
      }

      if (!data || data.length === 0) {
        return {
          success: false,
          error: 'Não foi possível renomear: a lista não existe mais ou não pertence à sua empresa.',
        };
      }

      return { success: true };
    } catch (err) {
      logError('teamList.renameList', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  /**
   * Substitui o conjunto de membros da lista pelo `workerIds` informado (diff: INSERT dos
   * novos, DELETE dos removidos).
   *
   * LM-2 (ordem crítica): INSERT primeiro, DELETE depois. Não há transação entre chamadas
   * PostgREST — se o DELETE rodasse antes e o INSERT falhasse (RLS: algum worker saiu do
   * elenco aceito), a lista ficaria mutilada: perdeu os membros antigos removidos e não ganhou
   * os novos, sem chance de rollback no client.
   * LM-3: se não há ninguém para remover, a chamada de DELETE é pulada — `.in('worker_id', [])`
   * devolveria 0 linhas e a checagem de LM-4 leria isso como negação de RLS (erro falso).
   * LM-4: no DELETE, `.select('id')` + checagem de 0 linhas.
   */
  async setMembers(id: string, workerIds: string[]): Promise<TeamListMutationResult> {
    try {
      const { data: currentRows, error: fetchErr } = await supabase
        .from('team_list_members')
        .select('worker_id')
        .eq('list_id', id);

      if (fetchErr) {
        logError('teamList.setMembers.fetch', fetchErr);
        return { success: false, error: 'Erro ao carregar os membros atuais da lista.' };
      }

      const currentIds = new Set((currentRows ?? []).map((r) => r.worker_id as string));
      const nextIds = new Set(workerIds);

      const toAdd = Array.from(nextIds).filter((workerId) => !currentIds.has(workerId));
      const toRemove = Array.from(currentIds).filter((workerId) => !nextIds.has(workerId));

      // LM-2: INSERT primeiro.
      if (toAdd.length > 0) {
        const { error: insertErr } = await supabase.from('team_list_members').insert(
          toAdd.map((workerId) => ({ list_id: id, worker_id: workerId })),
        );

        if (insertErr) {
          logError('teamList.setMembers.insert', insertErr);
          return { success: false, error: translateMembersError(insertErr) };
        }
      }

      // LM-3: pular DELETE com array vazio; LM-2: DELETE só depois do INSERT ter sucedido.
      if (toRemove.length > 0) {
        const { data, error: deleteErr } = await supabase
          .from('team_list_members')
          .delete()
          .eq('list_id', id)
          .in('worker_id', toRemove)
          .select('id');

        if (deleteErr) {
          logError('teamList.setMembers.delete', deleteErr);
          return { success: false, error: 'Erro ao remover membros da lista.' };
        }

        // LM-4: 0 linhas sem erro = RLS negou (lista não é mais desta empresa) — não confundir
        // com "nada para remover", que já foi tratado pelo `if` acima.
        if (!data || data.length === 0) {
          return {
            success: false,
            error: 'Não foi possível atualizar a lista: verifique se ela ainda existe.',
          };
        }
      }

      return { success: true };
    } catch (err) {
      logError('teamList.setMembers', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  /**
   * Exclui uma lista (cascade em `team_list_members` — não remove ninguém do Elenco, R7).
   * LM-4: `.select('id')` + checagem de 0 linhas.
   */
  async deleteList(id: string): Promise<TeamListMutationResult> {
    try {
      const { data, error } = await supabase.from('team_lists').delete().eq('id', id).select('id');

      if (error) {
        logError('teamList.deleteList', error);
        return { success: false, error: 'Erro ao excluir a lista.' };
      }

      if (!data || data.length === 0) {
        return {
          success: false,
          error: 'Não foi possível excluir: a lista não existe mais ou não pertence à sua empresa.',
        };
      }

      return { success: true };
    } catch (err) {
      logError('teamList.deleteList', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },
};
