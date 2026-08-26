/**
 * ServiceTermService — Termo de prestação de serviço com aceite eletrônico (F6).
 *
 * Spec: `.harness/spec/termo-prestacao/spec.md` (R1/R3/R4/A4/A9/R6 REESCRITOS pelo gate).
 * DDL aprovado (fonte normativa): `.harness/spec/termo-prestacao/ddl-aprovado.md`.
 * ADR: `.harness/memory-bank/decisions/ADR-20260818-termo-congelado-no-aceite.md`.
 * Migration: `supabase/migrations/20260817001100_service_terms.sql`.
 *
 * DIVISÃO DE RESPONSABILIDADE COM O BANCO — o ponto mais importante deste arquivo:
 *
 *   O estado do termo (rascunho vs. congelado, bloqueio por CPF ausente, idempotência do
 *   aceite, imutabilidade pós-aceite) mora INTEIRO na RPC `accept_service_term` (SECURITY
 *   DEFINER) e no trigger `enforce_service_term_immutability`. Este service NUNCA decide
 *   isso no client — ele só chama a RPC e traduz o `outcome`. Mesmo raciocínio de
 *   `AttendanceConfirmationService`/`ShiftCallService`.
 *
 *   `service_terms` NÃO tem policy de INSERT/UPDATE para `authenticated` — as duas únicas
 *   escritas são o trigger de geração (no registro do pagamento) e a RPC de aceite, ambos
 *   SECURITY DEFINER. Este service nunca faz `.update()`/`.insert()` direto na tabela.
 *
 * CHAVE É O PAGAMENTO, NUNCA O TURNO: existem N termos por (job_id, worker_id) ao longo do
 * tempo — um por marcador de `shift_payments`, incluindo os estornados (a empresa pode
 * registrar um novo marcador depois de estornar o antigo). `getByShiftPayment` é chaveado
 * em `shift_payment_id`. NÃO CRIAR `getByJob` — devolveria o termo errado quando houver mais
 * de um marcador histórico para o mesmo (turno, freela). Ver DDL aprovado §1 pergunta 3(a).
 *
 * FRONTEIRA CRÍTICA (Article 8/9/10) — este service NÃO move saldo:
 *  - NÃO chama nenhuma RPC de saldo (reserve/release/refund/authorize/capture).
 *  - NÃO toca `wallets` nem `escrow_transactions`.
 *  - `service_terms.amount` é cópia declaratória, nunca lida por RPC financeira.
 *  - Sem `service_role` no client — RPC roda `authenticated`.
 *
 * Padrão do projeto: `useState`/`useEffect` + supabase direto (Article 5), erros por retorno
 * estruturado (nunca throw para a UI), `logError` para diagnóstico, degradação elegante
 * quando a RPC ainda não existe no schema cache (`PGRST202` — deploy do frontend adiantado
 * em relação à migration).
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import type { ServiceTerm, ServiceTermAcceptOutcome } from '../types';

// ---------------------------------------------------------------------------
// Tipos de resultado
// ---------------------------------------------------------------------------

export interface AcceptServiceTermResult {
  outcome: ServiceTermAcceptOutcome;
  /** Só presente quando outcome='accepted' ou 'already_accepted'. */
  acceptedAt?: string;
  error?: string;
}

/**
 * C-TERM-FETCH-FAIL (achado ALTO, terceira iteração): `term: null` sozinho é AMBÍGUO —
 * "pagamento legado sem termo" (A9/scheduled) e "a query falhou (rede/RLS/PGRST)" viravam
 * o MESMO `null` na versão anterior. O componente lia isso como "sem termo" e habilitava
 * "Confirmar Recebimento" mesmo quando havia um termo pendente que simplesmente não pôde
 * ser lido — colapsando de volta no cenário do BLOCKER fechado (aceite nunca verificado).
 *
 * `failed=true` é o único sinal de "não sei responder"; o chamador (`ServiceTermSection`)
 * DEVE tratar isso como bloqueio (falhar fechado), nunca como "sem termo".
 */
export interface GetServiceTermResult {
  term: ServiceTerm | null;
  /** true = a leitura falhou (rede/RLS/erro inesperado) — não é o mesmo que "sem termo". */
  failed: boolean;
}

/** Formato mínimo devolvido pelo Postgres/PostgREST em erros de query/RPC do supabase-js. */
interface SupabaseErrorLike {
  message?: string;
  code?: string;
}

/** Shape jsonb devolvido por `accept_service_term`. */
interface AcceptServiceTermRpcResult {
  outcome?: string;
  accepted_at?: string;
}

// ---------------------------------------------------------------------------
// Tradução de outcome → mensagem de erro para a UI
// ---------------------------------------------------------------------------

/**
 * Exportado de propósito (achado do evaluator em `attendanceConfirmationService`, 18/08/2026
 * — mutation testing pegou testes verdes por acidente quando a tradução foi trocada por um
 * retorno genérico fixo): os testes importam este mapa e comparam a mensagem EXATA, nunca só
 * `toBeTruthy()`. 'already_accepted' não entra aqui — é tratado como sucesso (idempotente).
 */
export const OUTCOME_ERRORS: Partial<Record<ServiceTermAcceptOutcome, string>> = {
  unauthenticated: 'Sessão expirada. Faça login novamente.',
  not_found: 'Termo não encontrado.',
  forbidden: 'Você não tem permissão para aceitar este termo.',
  payment_voided: 'Este pagamento foi estornado — o termo não pode mais ser aceito.',
  // C-TERM-CPF-DEADEND (achado MÉDIO, terceira iteração): esta mensagem era
  // 'Complete seu CPF no perfil...', mas `pages/Profile.tsx` não tem campo de edição de
  // `workers.cpf` — a mesma interação prometia uma tela que não resolve nada. Alinhada
  // com o banner já honesto de `ServiceTermSection` (fala com a empresa/suporte), em vez
  // de apontar para `/profile`. Não referenciar link para `/profile` aqui (a spec A3 pede
  // isso, mas o autor da spec confirmou que vai corrigir A3 — não seguir o texto antigo).
  // A3 voltou à forma original em 25/08/2026: enquanto `/profile` não tinha campo de CPF, apontar
  // para lá seria mandar a pessoa para um beco sem saída, e a mensagem honesta era "fale com o
  // suporte". O campo existe agora (débito #3), então o caminho volta a ser o do próprio freela.
  missing_cpf:
    'Seu cadastro está sem um CPF válido. Cadastre o seu em Perfil para poder assinar o termo.',
};

function translateOutcome(outcome: string | undefined): string {
  return (
    OUTCOME_ERRORS[(outcome ?? '') as ServiceTermAcceptOutcome] ??
    'Não foi possível registrar o aceite do termo.'
  );
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * `PGRST202` = função não encontrada no schema cache do PostgREST (migration ainda não
 * aplicada no ambiente, ou nome/assinatura divergente). Mesmo tratamento de `linkRiskService`:
 * degradar sem quebrar a tela, nunca travar o fluxo de confirmação de recebimento por causa
 * de uma feature adjacente ainda não implantada.
 */
function isMissingRpc(error: SupabaseErrorLike): boolean {
  return error.code === 'PGRST202' || /Could not find the function/i.test(error.message ?? '');
}

// ---------------------------------------------------------------------------
// ServiceTermService
// ---------------------------------------------------------------------------

export const ServiceTermService = {
  /**
   * Busca o termo (rascunho ou aceito) vinculado a UM marcador de pagamento específico.
   * `.maybeSingle()`: `shift_payment_id` é UNIQUE, então nunca há mais de uma linha.
   *
   * Chaveado no PAGAMENTO, nunca no turno — não existe (nem deve existir) um `getByJob`.
   * Termo só existe para `shift_payments.status === 'recorded'` (o trigger de geração não
   * dispara em 'scheduled'); para um pagamento estornado sem termo ainda gerado, ou para um
   * `shiftPaymentId` inexistente/sem vínculo desta sessão (RLS), devolve `{ term: null, failed: false }`.
   *
   * C-TERM-FETCH-FAIL: quando a QUERY em si falha (rede, RLS negando por erro — não por
   * ausência legítima —, RPC/PostgREST fora do ar), devolve `{ term: null, failed: true }`.
   * Nunca lança — o chamador decide o que fazer com `failed`, mas o padrão seguro é tratar
   * como bloqueio (ver `ServiceTermSection`).
   */
  async getByShiftPayment(shiftPaymentId: string): Promise<GetServiceTermResult> {
    if (!shiftPaymentId) return { term: null, failed: false };
    try {
      const { data, error } = await supabase
        .from('service_terms')
        .select('*')
        .eq('shift_payment_id', shiftPaymentId)
        .maybeSingle();

      if (error) {
        logError('serviceTerm.getByShiftPayment', error);
        return { term: null, failed: true };
      }
      return { term: (data as ServiceTerm) ?? null, failed: false };
    } catch (err) {
      logError('serviceTerm.getByShiftPayment', err);
      return { term: null, failed: true };
    }
  },

  /**
   * Aceite eletrônico do termo pelo freela autenticado. Dispara `accept_service_term`, que
   * RE-RENDERIZA `term_text` com os dados vigentes (CPF incluído) e grava junto com
   * `accepted_at`, no mesmo UPDATE (ADR-20260818) — o congelamento acontece no banco, nunca
   * neste service.
   *
   * Idempotente por construção (RPC usa `FOR UPDATE` + `WHERE accepted_at IS NULL`): duplo
   * clique/retry no mesmo id sempre devolve `already_accepted` na segunda chamada, com o
   * `accepted_at` da PRIMEIRA vez, nunca sobrescrito.
   */
  async acceptServiceTerm(serviceTermId: string): Promise<AcceptServiceTermResult> {
    if (!serviceTermId) {
      return { outcome: 'not_found', error: 'Termo não informado.' };
    }
    try {
      const { data, error } = await supabase.rpc('accept_service_term', {
        p_service_term_id: serviceTermId,
      });

      if (error) {
        const errLike = error as SupabaseErrorLike;
        if (isMissingRpc(errLike)) {
          // Degradação elegante (LM-5-like): migration ainda não aplicada no ambiente.
          // Não decidimos "aceito" no client — reportamos falha genuína, sem log ruidoso.
          return { outcome: 'not_found', error: 'Recurso indisponível no momento. Tente novamente em instantes.' };
        }
        logError('serviceTerm.acceptServiceTerm', error);
        return { outcome: 'not_found', error: 'Não foi possível registrar o aceite do termo.' };
      }

      const result = (data ?? {}) as AcceptServiceTermRpcResult;
      const outcome = (result.outcome ?? 'not_found') as ServiceTermAcceptOutcome;

      if (outcome === 'accepted' || outcome === 'already_accepted') {
        return { outcome, acceptedAt: result.accepted_at };
      }

      return { outcome, error: translateOutcome(outcome) };
    } catch (err) {
      logError('serviceTerm.acceptServiceTerm', err);
      return { outcome: 'not_found', error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },
};
