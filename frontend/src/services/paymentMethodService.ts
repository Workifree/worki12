/**
 * PaymentMethodService — gerencia métodos de pagamento on-file da empresa (cartão tokenizado).
 *
 * Slice 2 / ADR-20260622-pagamento-postpago.
 * PCI / Article 10: o PAN nunca toca o banco — só o token opaco do Asaas + metadados.
 *
 * Padrão de imports: relativo sem alias @/ (padrão do projeto).
 * Padrão de fetch: invokeFunction para operações privilegiadas; supabase direto para leituras.
 */

import { supabase } from '../lib/supabase';
import { invokeFunction } from './api';
import { logError } from '../lib/logger';
import type { PaymentMethod } from '../types';

// ---------------------------------------------------------------------------
// Tipos de input/output da UI de cartão
// ---------------------------------------------------------------------------

/**
 * Dados necessários para tokenizar um cartão de crédito.
 * O PAN (number, ccv) trafega APENAS nesta chamada, server→Asaas.
 * NUNCA persiste no DB do Worki.
 */
export interface SaveCardInput {
  holderName: string;
  /** PAN completo — vai direto para o Asaas, não é gravado. */
  number: string;
  /** MM */
  expiryMonth: string;
  /** YYYY ou YY */
  expiryYear: string;
  /** CVV/CVC */
  ccv: string;
  holderInfo: {
    name: string;
    email: string;
    /** CPF ou CNPJ (só dígitos ou formatado — a Edge Function limpa). */
    cpfCnpj: string;
    /** CEP (só dígitos ou formatado). */
    postalCode: string;
    addressNumber: string;
    phone: string;
  };
}

export interface SaveCardResult {
  success: boolean;
  paymentMethodId?: string;
  brand?: string | null;
  last4?: string | null;
  error?: string;
}

export interface CapturePaymentResult {
  success: boolean;
  error?: string;
  chargeOnDemand?: boolean;
}

export interface ReleaseHoldResult {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const PaymentMethodService = {
  /**
   * Tokeniza e salva um cartão de crédito da empresa.
   *
   * Invoca a Edge Function `asaas-tokenize-card` (Article 10: PAN não passa pelo DB).
   * Idempotente: re-tokenizar o mesmo cartão não cria linha duplicada (UNIQUE company+token).
   *
   * @param input Dados do cartão (PAN + holderInfo).
   * @returns { success, paymentMethodId, brand, last4 } ou { success: false, error }.
   */
  async savePaymentMethod(input: SaveCardInput): Promise<SaveCardResult> {
    try {
      const result = await invokeFunction<{
        success: boolean;
        paymentMethodId?: string;
        brand?: string | null;
        last4?: string | null;
        error?: string;
      }>('asaas-tokenize-card', input as unknown as Record<string, unknown>);

      if (!result.success) {
        return { success: false, error: result.error || 'Erro ao salvar cartão.' };
      }

      return {
        success: true,
        paymentMethodId: result.paymentMethodId,
        brand: result.brand,
        last4: result.last4,
      };
    } catch (error: unknown) {
      logError('paymentMethodService.savePaymentMethod', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erro ao salvar cartão.',
      };
    }
  },

  /**
   * Lista os métodos de pagamento cadastrados pela empresa autenticada.
   * Leitura direta via supabase (RLS garante isolamento por dono).
   */
  async listPaymentMethods(): Promise<PaymentMethod[]> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      // Resolver company_id a partir do owner_id
      const { data: company, error: companyErr } = await supabase
        .from('companies')
        .select('id')
        .eq('owner_id', user.id)
        .maybeSingle();

      if (companyErr || !company) return [];

      const { data, error } = await supabase
        .from('payment_methods')
        .select('id, company_id, brand, last4, holder_name, is_default, created_at, updated_at')
        .eq('company_id', company.id)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) {
        logError('paymentMethodService.listPaymentMethods', error);
        return [];
      }

      // Não expor asaas_credit_card_token na listagem (PCI — token opaco, mas desnecessário na UI)
      return (data ?? []) as PaymentMethod[];
    } catch (error: unknown) {
      logError('paymentMethodService.listPaymentMethods', error);
      return [];
    }
  },

  /**
   * Retorna o método de pagamento default da empresa autenticada, ou null.
   */
  async getDefaultPaymentMethod(): Promise<PaymentMethod | null> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: company } = await supabase
        .from('companies')
        .select('id')
        .eq('owner_id', user.id)
        .maybeSingle();

      if (!company) return null;

      const { data } = await supabase
        .from('payment_methods')
        .select('id, company_id, brand, last4, holder_name, is_default, created_at, updated_at')
        .eq('company_id', company.id)
        .eq('is_default', true)
        .maybeSingle();

      return (data as PaymentMethod | null);
    } catch (error: unknown) {
      logError('paymentMethodService.getDefaultPaymentMethod', error);
      return null;
    }
  },

  /**
   * Captura o pagamento postpago de um turno concluído.
   *
   * Para turnos kind='postpaid': invoca asaas-capture-payment (captura o hold ou charge_on_demand).
   * NÃO deve ser chamado para turnos prepago (esses usam WalletService.releaseEscrow).
   *
   * Idempotente: recapturar não duplica crédito.
   */
  async capturePayment(jobId: string, workerId: string): Promise<CapturePaymentResult> {
    try {
      const result = await invokeFunction<{ success: boolean; chargeOnDemand?: boolean; error?: string }>(
        'asaas-capture-payment',
        { jobId, workerId }
      );

      return {
        success: result.success,
        chargeOnDemand: result.chargeOnDemand,
      };
    } catch (error: unknown) {
      logError('paymentMethodService.capturePayment', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erro ao capturar pagamento.',
      };
    }
  },

  /**
   * Libera o hold postpago (cancelamento / no-show antes da captura).
   * Invoca asaas-release-hold (RPC release_hold_postpago + DELETE no Asaas).
   * Idempotente: escrow já refunded → success silencioso.
   */
  async releaseHold(jobId: string, reason?: string): Promise<ReleaseHoldResult> {
    try {
      await invokeFunction('asaas-release-hold', {
        jobId,
        reason: reason ?? 'Cancelamento/no-show antes da conclusão',
      });
      return { success: true };
    } catch (error: unknown) {
      logError('paymentMethodService.releaseHold', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erro ao liberar hold.',
      };
    }
  },
};
