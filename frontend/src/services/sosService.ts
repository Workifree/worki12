/**
 * SosService — SOS: descoberta automática de freelas próximos em urgência (F11).
 *
 * Fallback do Chamado de Turno (F1): dispara só quando o alcance normal (Elenco) já esgotou e o
 * relógio está apertado (turno em <4h). É o "botão vermelho" que amplia o alcance para fora do
 * Elenco — dentro de um círculo de confiança de segundo grau (opt-in + corte de qualidade +
 * cotas), nunca um diretório aberto.
 *
 * A MEMBRANA QUE ESTE SERVICE NUNCA PODE FURAR (D1 do ADR-20260821):
 *
 *   Abre-se o ALCANCE (a empresa pode EMITIR um convite para fora do Elenco). NÃO se abre a
 *   VISIBILIDADE (a empresa NUNCA VÊ quem está lá fora). O pool é calculado e consumido inteiro
 *   dentro de `create_sos_call` (SECURITY DEFINER) — este service não monta o pool, não lê
 *   `workers` filtrando por `discoverable_for_sos`/`city`, não insere `shift_call_targets` para
 *   um SOS e não insere `notifications` para alvos de SOS (tudo isso é feito pela RPC). A
 *   empresa só recebe `{outcome, call_id, targets_count, expires_at}` — NUNCA a lista de alvos.
 *
 * Consequência prática: `listCallsByJob` (shiftCallService) continua servindo a tela da empresa,
 * mas para um chamado `origin='sos'` a policy `shift_call_targets_select` só devolve os alvos com
 * `response === 'accepted'` — um `.length` sobre esse array NUNCA é o tamanho do pool. Use
 * `shift_calls.targets_count` para isso (contrato §4.2 do ddl-aprovado.md).
 *
 * Padrão do projeto: `useState`/`useEffect` + supabase direto (Article 5), erros por retorno
 * estruturado (nunca throw para a UI), `logError` para diagnóstico.
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import type { ShiftCallReason, SosCallRpcResult, SosEligibility } from '../types';

export interface CreateSosCallOptions {
  reason?: ShiftCallReason;
  message?: string;
}

export interface CreateSosCallResult {
  success: boolean;
  outcome: SosCallRpcResult['outcome'] | 'error';
  callId?: string;
  targetsCount?: number;
  expiresAt?: string;
  /** Mensagem já traduzida para a UI — todo `outcome` de recusa tem uma (contrato §4.5). */
  error?: string;
}

/**
 * Traduz o `outcome` de `create_sos_call` numa mensagem acionável. Nenhum outcome de recusa
 * fica sem explicação — esconder o botão não é guarda suficiente (a RPC recusa de novo).
 */
function describeOutcome(outcome: SosCallRpcResult['outcome']): string | undefined {
  switch (outcome) {
    case 'created':
      return undefined;
    case 'pool_empty':
      return 'Não encontramos freelas elegíveis fora do seu Elenco agora. Tente novamente mais tarde.';
    case 'quota_exceeded':
      return 'Você atingiu o limite de chamados de urgência (1 aberto por vez, 3 a cada 7 dias).';
    case 'not_urgent':
      return 'O SOS só pode ser aberto quando o turno começa em menos de 4 horas.';
    case 'already_filled':
      return 'Este turno já está com todas as vagas preenchidas.';
    case 'team_not_tried':
      return 'Chame primeiro o seu Elenco — o SOS só abre depois que o chamado ao Elenco esgotar.';
    case 'team_call_still_open':
      return 'Ainda há um chamado ao Elenco em aberto para este turno. Aguarde ele encerrar.';
    case 'company_city_missing':
      return 'Cadastre a cidade da sua empresa no perfil para poder usar o SOS.';
    case 'job_started':
      return 'Este turno já começou.';
    case 'job_deleted':
      return 'Este turno foi removido.';
    case 'invalid_reason':
      return 'Motivo inválido.';
    case 'forbidden':
      return 'Você não pode abrir um SOS para este turno.';
    case 'not_found':
      return 'Turno não encontrado.';
    case 'unauthenticated':
      return 'Sessão expirada. Faça login novamente.';
    default:
      return 'Não foi possível abrir o chamado de urgência.';
  }
}

export const SosService = {
  /**
   * O botão "Chamar fora do Elenco" deve aparecer? Leitura pura, sem efeito colateral e sem
   * revelar nada do pool (nem tamanho) — é UX, não a guarda de verdade (essa é a RPC de escrita).
   */
  async checkEligibility(jobId: string): Promise<SosEligibility> {
    try {
      const { data, error } = await supabase.rpc('sos_call_eligibility', { p_job_id: jobId });
      if (error) {
        logError('sosService.checkEligibility', error);
        return { eligible: false, reason: 'error' };
      }
      return (data ?? { eligible: false, reason: 'not_found' }) as SosEligibility;
    } catch (err) {
      logError('sosService.checkEligibility', err);
      return { eligible: false, reason: 'error' };
    }
  },

  /**
   * Abre o SOS. Única porta pela qual um alvo fora do Elenco nasce — tudo (pool, inserts,
   * notificações) acontece dentro de `create_sos_call`. Nunca devolve a lista de alvos.
   */
  async createSosCall(jobId: string, opts: CreateSosCallOptions = {}): Promise<CreateSosCallResult> {
    try {
      if (!jobId) {
        return { success: false, outcome: 'not_found', error: 'Turno não informado.' };
      }

      const { data, error } = await supabase.rpc('create_sos_call', {
        p_job_id: jobId,
        p_reason: opts.reason ?? 'falta',
        p_message: opts.message ?? null,
      });

      if (error) {
        logError('sosService.createSosCall', error);
        return {
          success: false,
          outcome: 'error',
          error: 'Não foi possível abrir o chamado de urgência.',
        };
      }

      const result = (data ?? { outcome: 'not_found' }) as SosCallRpcResult;
      const success = result.outcome === 'created';

      return {
        success,
        outcome: result.outcome,
        callId: result.call_id,
        targetsCount: result.targets_count,
        expiresAt: result.expires_at,
        error: describeOutcome(result.outcome),
      };
    } catch (err) {
      logError('sosService.createSosCall', err);
      return {
        success: false,
        outcome: 'error',
        error: err instanceof Error ? err.message : 'Erro inesperado.',
      };
    }
  },

  /**
   * Opt-in/opt-out do próprio freela autenticado. Efeito imediato — o pool é calculado no
   * momento do disparo, sem cache (A14). Não valida `availability_days` aqui: o gancho de UX
   * (R4/A15, "só oferece o toggle depois de declarar disponibilidade") é responsabilidade da
   * tela (Profile.tsx), não deste service.
   */
  async setDiscoverable(discoverable: boolean): Promise<{ success: boolean; error?: string }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { success: false, error: 'Sessão expirada. Faça login novamente.' };

      const { error } = await supabase
        .from('workers')
        .update({ discoverable_for_sos: discoverable })
        .eq('id', user.id);

      if (error) {
        logError('sosService.setDiscoverable', error);
        return { success: false, error: 'Não foi possível salvar a preferência.' };
      }
      return { success: true };
    } catch (err) {
      logError('sosService.setDiscoverable', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },
};
