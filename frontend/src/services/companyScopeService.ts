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
import type { CompanyRole, MyCompany } from '../types';
import { clearAllTeamMemberHints } from '../lib/teamInviteToken';

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
// ── Cache de rajada ─────────────────────────────────────────────────────────────────────────
// Auditoria de rede (01/09/2026): o dashboard da empresa disparava `get_my_companies` OITO vezes
// na mesma carga — cada serviço resolve o seam por conta própria, e cada resolução ia à rede.
// O seam continua sendo o ÚNICO resolvedor (contrato do §7 intacto); ele só passa a responder
// de memória por uma janela curta. TTL de 30s: longo o bastante para colapsar a rajada de uma
// tela, curto o bastante para um convite de gerente aceito em outra aba aparecer sozinho.
const COMPANIES_CACHE_TTL_MS = 30_000;
let companiesCache: { promise: Promise<MyCompany[]>; at: number } | null = null;

/** Derruba o cache — chamar após aceite/revogação de gerente e em troca de sessão. */
export function invalidateCompanyScope(): void {
  companiesCache = null;
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // um ouvinte quebrado não pode impedir os outros
    }
  });
}

const listeners = new Set<() => void>();

/**
 * Avisa quem mostra dado derivado do seam (Sidebar, atalhos) que o escopo mudou — ex.: convidar
 * a primeira pessoa liga `team_enabled` e o menu "Equipe" aparece sem recarregar a página.
 * Devolve a função de cancelamento.
 */
export function subscribeCompanyScope(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

// Troca de sessão invalida sozinha (login/logout/refresh de usuário). O try/catch existe porque
// os testes mockam `lib/supabase` só com o que usam, e este módulo não pode explodir no import.
try {
  let lastUserId: string | null = null;
  supabase.auth.onAuthStateChange((event, session) => {
    const userId = session?.user?.id ?? null;
    if (event === 'SIGNED_OUT') {
      // Aparelho compartilhado: a marca "já foi da equipe" não sobrevive ao logout.
      clearAllTeamMemberHints();
      clearNavHints();
      lastUserId = null;
      invalidateCompanyScope();
      return;
    }
    // O Supabase redispara SIGNED_IN ao voltar o foco da aba com a MESMA sessão: sem esse filtro cada
    // retorno derrubaria o cache do seam e refaria todas as consultas em cascata.
    const sameUser = event === 'SIGNED_IN' && userId !== null && userId === lastUserId;
    if (userId) lastUserId = userId;
    if (!sameUser && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
      invalidateCompanyScope();
    }
  });
} catch {
  /* ambiente de teste sem auth completo */
}

export async function getMyCompanies(): Promise<MyCompany[]> {
  const agora = Date.now();
  if (companiesCache && agora - companiesCache.at < COMPANIES_CACHE_TTL_MS) {
    return companiesCache.promise;
  }
  const promessa = (async () => {
    const { data, error } = await supabase.rpc('get_my_companies');
    if (error) throw error;
    return (data ?? []) as MyCompany[];
  })();
  companiesCache = { promise: promessa, at: agora };
  // Erro NUNCA fica cacheado: a próxima chamada tenta de novo.
  promessa.catch(() => {
    if (companiesCache?.promise === promessa) companiesCache = null;
  });
  return promessa;
}

/**
 * Escolhe a empresa "primária" de uma lista: a linha `role === 'owner'` primeiro (dona direta
 * ou legada), senão a primeira da lista devolvida pela RPC (contrato do ddl-aprovado.md §7,
 * regra 2 — usado por `ProtectedRoute` para decidir onboarding/TOS quando não há seleção ativa).
 */
export function pickPrimaryCompany(companies: MyCompany[]): MyCompany | null {
  if (companies.length === 0) return null;
  // Ordem de poder (Equipe e encarregados): dono > operador > gerente > encarregado. Não dá para
  // confiar na ordem da RPC (`ORDER BY role` é alfabético: 'encarregado' viria antes de 'owner').
  // Empate de papel preserva a ordem original (sort estável) — o contrato antigo de "primeira da
  // lista" para dois gerentes continua valendo.
  return [...companies].sort((a, b) => ROLE_POWER[a.role] - ROLE_POWER[b.role])[0];
}

const ROLE_POWER: Record<CompanyRole, number> = {
  owner: 0,
  operator: 1,
  manager: 2,
  encarregado: 3,
};

/** Gestor = quem administra a empresa (dono, operador da organização, gerente). Encarregado não. */
export function isGestor(company: MyCompany | null | undefined): boolean {
  if (isUnconfirmedManager(company)) return false; // convidado que o dono ainda não confirmou opera zero
  return company?.role === 'owner' || company?.role === 'operator' || company?.role === 'manager';
}

/** Gestor convidado que ainda não foi confirmado: vê só "Aguardando confirmação". `confirmed` ausente = confirmado. */
export function isUnconfirmedManager(company: MyCompany | null | undefined): boolean {
  return company?.role === 'manager' && company.confirmed === false;
}

/** Qualquer pessoa da equipe (Encarregado ou Gestor) esperando a confirmação "é ele?". */
export function isAwaitingConfirmation(company: MyCompany | null | undefined): boolean {
  return isUnconfirmedEncarregado(company) || isUnconfirmedManager(company);
}

/**
 * R22: Encarregado que entrou mas o Gestor ainda não confirmou ("é ele?"). Só este papel depende
 * de confirmação; `confirmed` ausente (RPC antiga) conta como confirmado para não trancar ninguém.
 */
export function isUnconfirmedEncarregado(company: MyCompany | null | undefined): boolean {
  return company?.role === 'encarregado' && company.confirmed === false;
}

/**
 * R23 (divulgação progressiva): o destaque "Equipe" na navegação só aparece ao Gestor quando a
 * empresa já tem ao menos uma pessoa. Dono único chega à tela por Gestão > Equipe.
 */
export function showTeamNav(company: MyCompany | null | undefined): boolean {
  return isGestor(company) && company?.team_enabled === true;
}

/**
 * A tela Hoje entra na navegação só para quem tem equipe (R23) ou é encarregado. Dono único
 * mantém o "Início" de sempre. Regra única — Sidebar e BottomNav usam esta.
 */
export function hasTeamNav(company: MyCompany | null | undefined): boolean {
  return company?.role === 'encarregado' || company?.team_enabled === true;
}

const TEAM_NAV_HINT_KEY = 'worki_team_nav_hint';

/**
 * Dica do último valor de `hasTeamNav` (sessionStorage), lida ENQUANTO a empresa ainda carrega:
 * evita o "flash" de Início -> Hoje no primeiro render de quem tem equipe. É só aparência; a
 * navegação real sempre usa a empresa resolvida.
 */
export function readTeamNavHint(): boolean {
  try {
    return sessionStorage.getItem(TEAM_NAV_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeTeamNavHint(value: boolean): void {
  try {
    sessionStorage.setItem(TEAM_NAV_HINT_KEY, value ? '1' : '0');
  } catch {
    // best-effort
  }
}

const NAV_ROLE_HINT_KEY = 'worki_nav_role_hint';

export type NavRoleHint = 'gestor' | 'encarregado';

/**
 * Mesmo padrão da dica acima, para o papel: o menu não pode mostrar Elenco/Relatórios e esconder
 * depois. `null` = nunca resolvido nesta sessão (a navegação assume o menu restrito).
 */
export function readNavRoleHint(): NavRoleHint | null {
  try {
    const value = sessionStorage.getItem(NAV_ROLE_HINT_KEY);
    return value === 'gestor' || value === 'encarregado' ? value : null;
  } catch {
    return null;
  }
}

export function writeNavRoleHint(value: NavRoleHint): void {
  try {
    sessionStorage.setItem(NAV_ROLE_HINT_KEY, value);
  } catch {
    // best-effort
  }
}

/** Troca de unidade: as dicas de menu eram da unidade anterior (senão itens aparecem e somem). */
export function switchCompanyUnit(companyId: string): void {
  setSelectedCompanyId(companyId);
  clearNavHints();
}

function clearNavHints(): void {
  try {
    sessionStorage.removeItem(NAV_ROLE_HINT_KEY);
    sessionStorage.removeItem(TEAM_NAV_HINT_KEY);
  } catch {
    // best-effort
  }
}

/**
 * R16: só sócio/operador (organization_members ativo) vê a visão consolidada da organização
 * (`/company/organization`). Regra única — a navegação (lib/navigation) deve usar esta.
 */
export function canSeeOrganization(company: MyCompany | null | undefined): boolean {
  return company?.role === 'owner' || company?.role === 'operator';
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
