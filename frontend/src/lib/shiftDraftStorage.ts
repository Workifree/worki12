/**
 * Rascunho do lote no aparelho (formato v2). A chave deriva de `jobDraftKey`, então o logout
 * (`clearJobDrafts`) já a apaga. O rascunho v1 do formulário único continua na chave dele.
 */
import { jobDraftKey } from './jobDraft';
import type { ShiftDraftBatch } from './shiftDrafts';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Último envio ao banco: reaproveita o id enquanto o conteúdo for o mesmo. */
export interface SentBatch {
  id: string;
  fingerprint: string;
  /** A resposta não chegou: o lote pode existir. */
  uncertain: boolean;
}

export interface StoredShiftDraft {
  batch: ShiftDraftBatch;
  sent: SentBatch | null;
}

export const batchDraftKey = (userId: string, companyId: string) => `${jobDraftKey(userId, companyId)}:lote`;

export function saveShiftDraft(key: string, draft: StoredShiftDraft, now = Date.now()): void {
  try {
    localStorage.setItem(key, JSON.stringify({ v: 2, em: now, ...draft }));
  } catch {
    // storage indisponível: rascunho é só conveniência
  }
}

export function loadShiftDraft(key: string, now = Date.now()): StoredShiftDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<StoredShiftDraft> & { v?: number; em?: number };
    const batch = data.batch;
    if (data.v !== 2 || !batch?.template || !Array.isArray(batch.rows) || now - (data.em ?? 0) > MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return { batch, sent: data.sent ?? null };
  } catch {
    return null;
  }
}

export function clearShiftDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // idem
  }
}
