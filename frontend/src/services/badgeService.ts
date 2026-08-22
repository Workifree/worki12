/**
 * BadgeService — Badges das empresas onde o freela já trabalhou (F12).
 *
 * Spec: `.harness/spec/badges-empresas/spec.md`.
 * DDL aprovado (fonte normativa — 10 desvios normativos DS1–DS10): `.harness/spec/badges-empresas/ddl-aprovado.md`.
 * ADR: `.harness/memory-bank/decisions/ADR-20260821-badges-historico-de-empresas.md`.
 * Migration: `supabase/migrations/20260817001400_worker_company_badges.sql`.
 *
 * DIVISÃO DE RESPONSABILIDADE COM O BANCO:
 *
 *   Badge é DERIVADO em query, nunca armazenado (D1). A leitura sempre passa por
 *   `get_worker_company_badges` (SECURITY DEFINER) — nunca `.from('applications')`/`.from('reviews')`
 *   direto no client, porque a leitura cross-empresa exige o furo estreito da DEFINER (a RLS de
 *   `applications` só deixa cada empresa ver os próprios turnos).
 *
 *   `worker_company_badge_prefs` NÃO tem policy de INSERT/UPDATE/DELETE — a única escrita é
 *   `set_worker_badge_visibility` (SECURITY DEFINER, sempre `auth.uid()`, nunca recebe `worker_id`).
 *   Este service nunca faz `.update()`/`.insert()` direto na tabela.
 *
 *   `workers.badges_hidden` (chave-mestra, DS2) é a EXCEÇÃO: é `UPDATE` direto na tabela `workers`
 *   (a policy self já cobre — Article 5, sem RPC nova). `setBadgesHiddenGlobal` faz isso.
 *
 * FRONTEIRA CRÍTICA (Article 8) — este service NÃO move saldo:
 *  - NÃO chama nenhuma RPC de saldo (reserve/release/refund/authorize/capture).
 *  - NÃO toca `wallets`, `escrow_transactions`, `wallet_transactions`, `shift_payments`.
 *  - Ocultar/reexibir badge NUNCA altera `applications`/`reviews`/XP/`completed_jobs_count`.
 *
 * Padrão do projeto: `useState`/`useEffect` + supabase direto (Article 5), erros por retorno
 * estruturado (nunca throw para a UI), `logError` para diagnóstico, degradação elegante quando a
 * RPC ainda não existe no schema cache (`PGRST202` — deploy do frontend adiantado em relação à
 * migration, mesmo padrão de `serviceTermService`/`linkRiskService`).
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import type { CompanyBadge } from '../types';

// ---------------------------------------------------------------------------
// Tipos de resultado
// ---------------------------------------------------------------------------

export interface GetCompanyBadgesResult {
  badges: CompanyBadge[];
  /** true = a leitura falhou (rede/RPC/erro inesperado). Nunca confundir com "sem badges" (lista vazia). */
  failed: boolean;
}

/** Formato mínimo devolvido pelo Postgres/PostgREST em erros de query/RPC do supabase-js. */
interface SupabaseErrorLike {
  message?: string;
  code?: string;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * `PGRST202` = função não encontrada no schema cache do PostgREST (migration ainda não aplicada
 * no ambiente, ou nome/assinatura divergente). Mesmo tratamento de `serviceTermService`/
 * `linkRiskService`: degradar sem quebrar a tela.
 */
function isMissingRpc(error: SupabaseErrorLike): boolean {
  return error.code === 'PGRST202' || /Could not find the function/i.test(error.message ?? '');
}

// ---------------------------------------------------------------------------
// BadgeService
// ---------------------------------------------------------------------------

export const BadgeService = {
  /**
   * Busca os badges "já trabalhou com" de um freela.
   *
   * A guarda de acesso mora inteira na RPC (DS10 — `WHERE`, nunca `RAISE EXCEPTION`): quem não
   * pode ver recebe `[]`, exatamente igual a "freela sem histórico" — este service NÃO tenta
   * distinguir os dois casos (seria oráculo de existência, A3), e o componente não deve tentar
   * também. `failed=true` é o único sinal de "a leitura em si não funcionou".
   *
   * Ordenação e filtro de `hidden` são feitos inteiramente pela RPC (DS1/DS5) — este service não
   * reordena nem refiltra o array recebido.
   */
  async getCompanyBadges(workerId: string): Promise<GetCompanyBadgesResult> {
    if (!workerId) return { badges: [], failed: false };
    try {
      const { data, error } = await supabase.rpc('get_worker_company_badges', {
        p_worker_id: workerId,
      });

      if (error) {
        const errLike = error as SupabaseErrorLike;
        if (isMissingRpc(errLike)) {
          // Degradação elegante: migration ainda não aplicada no ambiente. Não é falha de rede
          // real do ponto de vista do usuário — mas também não é "sem badges" legítimo.
          return { badges: [], failed: true };
        }
        logError('badgeService.getCompanyBadges', error);
        return { badges: [], failed: true };
      }

      return { badges: (data ?? []) as CompanyBadge[], failed: false };
    } catch (err) {
      logError('badgeService.getCompanyBadges', err);
      return { badges: [], failed: true };
    }
  },

  /**
   * Liga/desliga o badge de UMA empresa específica (bisturi, DS3). Sempre `auth.uid()` do lado do
   * banco — não existe parâmetro `workerId` aqui de propósito (não há como chamar em nome de outro
   * freela). Devolve `false` quando a RPC recusa (sem turno concluído com aquela empresa) — a UI
   * otimista DEVE fazer rollback nesse caso, nunca assumir sucesso.
   */
  async setBadgeVisibility(companyId: string, hidden: boolean): Promise<boolean> {
    if (!companyId) return false;
    try {
      const { data, error } = await supabase.rpc('set_worker_badge_visibility', {
        p_company_id: companyId,
        p_hidden: hidden,
      });

      if (error) {
        logError('badgeService.setBadgeVisibility', error);
        return false;
      }

      return data === true;
    } catch (err) {
      logError('badgeService.setBadgeVisibility', err);
      return false;
    }
  },

  /**
   * Chave-mestra (DS2): `workers.badges_hidden`. UPDATE direto — não é RPC, a policy self
   * ("Workers can update their own profile", `id = auth.uid()`) já cobre (Article 5).
   * Ligada, terceiros recebem `[]` de `getCompanyBadges` para este worker; o próprio freela
   * continua vendo tudo (senão não há como reverter — A5).
   *
   * `.select('id')` obrigatório (patterns.md / `teamConnectionService.removeFromTeam`): sob RLS
   * um UPDATE que não casa nenhuma linha (workerId errado, ou policy não cobre) devolve 0 linhas
   * sem erro — sem isso a UI diria "Seção ocultada" mesmo sem ter gravado nada, uma falsa
   * confirmação num controle de privacidade.
   */
  async setBadgesHiddenGlobal(workerId: string, hidden: boolean): Promise<boolean> {
    if (!workerId) return false;
    try {
      const { data, error } = await supabase
        .from('workers')
        .update({ badges_hidden: hidden })
        .eq('id', workerId)
        .select('id');

      if (error) {
        logError('badgeService.setBadgesHiddenGlobal', error);
        return false;
      }

      return (data?.length ?? 0) > 0;
    } catch (err) {
      logError('badgeService.setBadgesHiddenGlobal', err);
      return false;
    }
  },
};
