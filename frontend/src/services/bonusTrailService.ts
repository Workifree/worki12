/**
 * BonusTrailService — Trilha de bônus do operador (lado do operador).
 *
 * Contrato REAL: `supabase/migrations/20261124000300_trilha_bonus_s3_aceite_e_saque.sql`.
 * ADR: ADR-20261124-trilha-bonus-operador (C2, C4, C10).
 *
 * Implementa `BonusTrailApi` (o contrato da tela) reaproveitando o parser do adaptador
 * (`components/bonus/rpcApi.ts`), para existir UM só mapeamento snake_case -> camelCase.
 * Acrescenta o que o adaptador não tem:
 *   - `getAccessStatus` / `hasActiveEnrollment`: consulta LEVE (`p_light = true`), que NÃO roda a
 *     avaliação no banco. É a que o menu deve usar.
 *   - ações nunca lançam: falha vira `'error'` e vai para o logger (padrão dos demais services).
 *
 * `getMyTrail` continua lançando em falha (o hook da tela distingue "sem dado" de "desatualizado").
 *
 * Nada aqui move dinheiro: o bônus é pago por PIX manual, fora do Worki (Article 8). O admin não
 * passa por aqui: usa a edge function `admin-data` (Article 10).
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { bonusRpcApi, parseSnapshot } from '../components/bonus/rpcApi';
import type {
  AcceptOutcome,
  BonusTrailApi,
  BonusTrailStatus,
  PayoutOutcome,
  PixOutcome,
} from '../components/bonus/types';

async function safely<T>(context: string, action: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await action();
  } catch (error) {
    logError(context, error);
    return fallback;
  }
}

/**
 * Status da inscrição sem avaliar a trilha. `null` = não deu para saber (rede/erro): quem chama
 * decide, e o menu trata como "sem acesso".
 */
async function getAccessStatus(): Promise<BonusTrailStatus | null> {
  return safely<BonusTrailStatus | null>(
    'bonusTrailService.getAccessStatus',
    async () => {
      const { data, error } = await supabase.rpc('bonus_get_my_trail', { p_light: true });
      if (error) throw error;
      return parseSnapshot(data).status;
    },
    null,
  );
}

export const BonusTrailService = {
  getAccessStatus,

  /** R20: o item de menu só aparece com inscrição `active`. */
  async hasActiveEnrollment(): Promise<boolean> {
    return (await getAccessStatus()) === 'active';
  },

  getMyTrail() {
    return bonusRpcApi.getMyTrail();
  },

  acceptEnrollment(pixKey: string | null): Promise<AcceptOutcome> {
    const key = pixKey?.trim() ? pixKey.trim() : null;
    return safely<AcceptOutcome>('bonusTrailService.acceptEnrollment', () => bonusRpcApi.acceptEnrollment(key), 'error');
  },

  setPixKey(pixKey: string): Promise<PixOutcome> {
    return safely<PixOutcome>('bonusTrailService.setPixKey', () => bonusRpcApi.setPixKey(pixKey.trim()), 'error');
  },

  requestPayout(): Promise<PayoutOutcome> {
    return safely<PayoutOutcome>('bonusTrailService.requestPayout', () => bonusRpcApi.requestPayout(), 'error');
  },

  cancelPayout(): Promise<PayoutOutcome> {
    return safely<PayoutOutcome>('bonusTrailService.cancelPayout', () => bonusRpcApi.cancelPayout(), 'error');
  },

  /** Lista vazia não vai ao banco (a RPC recusa). Falha só impede o "não repetir confete". */
  markCelebrated(awardIds: string[]): Promise<void> {
    if (awardIds.length === 0) return Promise.resolve();
    return safely<void>('bonusTrailService.markCelebrated', () => bonusRpcApi.markCelebrated(awardIds), undefined);
  },
} satisfies BonusTrailApi & Record<string, unknown>;
