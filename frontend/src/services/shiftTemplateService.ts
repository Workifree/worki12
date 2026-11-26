/**
 * Modelos de turno da empresa (tabela `shift_templates`, migration 20261204000100).
 * O modelo pertence à EMPRESA. Excluir = arquivar (a tabela não tem DELETE); desfazer = desarquivar.
 */
import { supabase } from '../lib/supabase';
import {
  sanitizeSavedTemplate, templateToSave,
  type RowDefaults, type SavedShiftTemplate, type ShiftDraftTemplate,
} from '../lib/shiftDrafts';

const COLUMNS = 'id, name, template, defaults';

export async function listShiftTemplates(companyId: string): Promise<SavedShiftTemplate[]> {
  const { data, error } = await supabase
    .from('shift_templates').select(COLUMNS)
    .eq('company_id', companyId).is('archived_at', null)
    .order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => sanitizeSavedTemplate(row as { id: string; name: string; template: unknown; defaults: unknown }));
}

export type SaveTemplateResult = { ok: true; template: SavedShiftTemplate } | { ok: false; reason: 'duplicate' | 'limit' | 'error' };

export async function saveShiftTemplate(
  companyId: string, name: string, template: ShiftDraftTemplate, defaults: RowDefaults,
): Promise<SaveTemplateResult> {
  const { data: session } = await supabase.auth.getUser();
  const userId = session.user?.id;
  if (!userId) return { ok: false, reason: 'error' };
  const payload = templateToSave(template, defaults);
  const { data, error } = await supabase
    .from('shift_templates')
    .insert({ company_id: companyId, name: name.trim().slice(0, 60), template: payload.template, defaults: payload.defaults, created_by: userId })
    .select(COLUMNS).single();
  if (error) {
    if (error.code === '23505') return { ok: false, reason: 'duplicate' };
    // Acoplado ao texto da exceção do gatilho shift_templates_limit (migration 20261204000100/200).
    if (error.code === '23514' && /limite/.test(error.message)) return { ok: false, reason: 'limit' };
    return { ok: false, reason: 'error' };
  }
  return { ok: true, template: sanitizeSavedTemplate(data as { id: string; name: string; template: unknown; defaults: unknown }) };
}

/**
 * Edita um modelo existente (nome, conteúdo e padrões). A tabela só deixa a EMPRESA dona alterar essas
 * colunas; sem permissão (ou modelo já excluído) nada muda e o resultado é 'error'.
 */
export async function updateShiftTemplate(
  id: string, name: string, template: ShiftDraftTemplate, defaults: RowDefaults,
): Promise<SaveTemplateResult> {
  const payload = templateToSave(template, defaults);
  const { data, error } = await supabase
    .from('shift_templates')
    .update({ name: name.trim().slice(0, 60), template: payload.template, defaults: payload.defaults })
    .eq('id', id).is('archived_at', null)
    .select(COLUMNS);
  if (error) {
    if (error.code === '23505') return { ok: false, reason: 'duplicate' };
    return { ok: false, reason: 'error' };
  }
  const row = data?.[0];
  if (!row) return { ok: false, reason: 'error' };
  return { ok: true, template: sanitizeSavedTemplate(row as { id: string; name: string; template: unknown; defaults: unknown }) };
}

/** Arquivar (excluir) ou desarquivar (desfazer). Devolve false se nada mudou (sem permissão ou nome já em uso). */
export async function setShiftTemplateArchived(id: string, archived: boolean): Promise<boolean> {
  const { data, error } = await supabase
    .from('shift_templates').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id).select('id');
  return !error && (data?.length ?? 0) > 0;
}
