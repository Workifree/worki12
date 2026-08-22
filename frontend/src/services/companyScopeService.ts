/**
 * CompanyScopeService — resolução única de "qual empresa esta sessão opera" (F13 Fase 4).
 *
 * Spec: `.harness/spec/multi-unidade/spec.md` (R11-R13).
 * DDL aprovado (fonte normativa — onde spec e DDL divergem, o DDL vence):
 * `.harness/spec/multi-unidade/ddl-aprovado.md` §7.
 * Migration: `supabase/migrations/20260818100300_manager_invite_rpcs.sql` (`get_my_companies`).
 *
 * `get_my_companies()` é o ÚNICO resolvedor de escopo de empresa do frontend (contrato do §7):
 * `teamConnectionService.getAuthenticatedCompanyId()` e `CompanyProfile.tsx` consomem este
 * módulo em vez de `.eq('id', authUser.id).single()` / `.eq('owner_id', user.id)`.
 *
 * Seletor de unidade (R13): quando a sessão opera mais de uma unidade (gerente de duas lojas,
 * ou sócio navegando por unidade), a UI guarda a unidade CORRENTE em estado local — aqui, um
 * singleton em memória + `sessionStorage` (sobrevive a navegação entre páginas da SPA e a um
 * F5, mas NUNCA vaza para a URL, por decisão de simplicidade do v1). `getAuthenticatedCompanyId()`
 * e qualquer outro consumidor deste módulo respeitam a seleção automaticamente.
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import type { MyCompany } from '../types';

const SELECTED_COMPANY_STORAGE_KEY = 'worki_selected_company_id';

let inMemorySelectedCompanyId: string | null | undefined;

function readStoredSelection(): string | null {
  if (inMemorySelectedCompanyId !== undefined) return inMemorySelectedCompanyId;
  try {
    inMemorySelectedCompanyId = sessionStorage.getItem(SELECTED_COMPANY_STORAGE_KEY);
  } catch {
    // sessionStorage indisponível (ex.: modo privado restrito) — degrada para "sem seleção".
    inMemorySelectedCompanyId = null;
  }
  return inMemorySelectedCompanyId;
}

/**
 * Define a unidade corrente escolhida pelo seletor (R13). `null` limpa a seleção (volta a
 * resolver pela empresa primária — `pickPrimaryCompany`).
 */
export function setSelectedCompanyId(companyId: string | null): void {
  inMemorySelectedCompanyId = companyId;
  try {
    if (companyId) {
      sessionStorage.setItem(SELECTED_COMPANY_STORAGE_KEY, companyId);
    } else {
      sessionStorage.removeItem(SELECTED_COMPANY_STORAGE_KEY);
    }
  } catch {
    // best-effort — o singleton em memória já cobre a sessão atual da aba.
  }
}

export function getSelectedCompanyId(): string | null {
  return readStoredSelection();
}

/**
 * Toda unidade que a sessão autenticada opera (dono direto, gerente ativo, sócio/operador da
 * organização). SEMPRE via `auth.uid()` — nunca aceita um uid de parâmetro. Lança se a RPC
 * falhar (chamador decide como degradar: onboarding, "sem perfil", etc. — nunca tratamos zero
 * linhas como erro aqui, é um resultado válido para "sessão sem empresa ainda").
 */
export async function getMyCompanies(): Promise<MyCompany[]> {
  const { data, error } = await supabase.rpc('get_my_companies');
  if (error) throw error;
  return (data ?? []) as MyCompany[];
}

/**
 * Escolhe a empresa "primária" de uma lista: a linha `role === 'owner'` primeiro (dona direta
 * ou legada), senão a primeira da lista devolvida pela RPC (contrato do ddl-aprovado.md §7,
 * regra 2 — usado por `ProtectedRoute` para decidir onboarding/TOS quando não há seleção ativa).
 */
export function pickPrimaryCompany(companies: MyCompany[]): MyCompany | null {
  if (companies.length === 0) return null;
  return companies.find((c) => c.role === 'owner') ?? companies[0];
}

/**
 * A empresa CORRENTE da sessão: respeita o seletor de unidade (R13) quando a seleção ainda é
 * válida para esta sessão; cai para a primária caso contrário (primeira sessão, seleção órfã
 * após revogação, etc.).
 */
export function pickCurrentCompany(companies: MyCompany[]): MyCompany | null {
  const selected = getSelectedCompanyId();
  if (selected) {
    const match = companies.find((c) => c.company_id === selected);
    if (match) return match;
  }
  return pickPrimaryCompany(companies);
}

/**
 * `company_id` da unidade corrente da sessão autenticada. Lança com mensagem amigável quando a
 * sessão não opera nenhuma empresa — mesmo contrato de erro que `teamConnectionService` tinha
 * antes deste refactor ("Perfil de empresa não encontrado."), para não mudar comportamento
 * observável dos ~15 pontos de chamada existentes.
 */
export async function getAuthenticatedCompanyId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Sessão expirada. Faça login novamente.');

  let companies: MyCompany[];
  try {
    companies = await getMyCompanies();
  } catch (error) {
    logError('companyScopeService.getAuthenticatedCompanyId', error);
    throw new Error('Perfil de empresa não encontrado.');
  }

  const current = pickCurrentCompany(companies);
  if (!current) throw new Error('Perfil de empresa não encontrado.');
  return current.company_id;
}
