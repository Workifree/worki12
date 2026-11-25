/**
 * Escopo de turnos na UI (R9 de equipe-encarregados): o Encarregado nunca consulta nem renderiza
 * turno alheio. Vale o turno em que ele é o responsável ou que cobre na janela da cobertura (mesma
 * regra de `session_can_operate_job`). A leitura de `jobs` no banco continua ampla por decisão da
 * spec: isto é filtro de tela, não barreira de segurança. Falha ao resolver o escopo LANÇA (a tela
 * mostra erro): na dúvida não se mostra turno.
 */
import { supabase } from '../lib/supabase';
import { toBrazilDateOnly } from '../lib/dateUtils';
import { getAuthenticatedCompanyId, getMyCompanies, pickCurrentCompany } from './companyScopeService';

export interface JobScope {
  companyId: string;
  restricted: boolean;
  userId: string | null;
  coverages: Array<{ fromUserId: string; startsOn: string; endsOn: string }>;
}

export async function getJobScope(): Promise<JobScope> {
  const companyId = await getAuthenticatedCompanyId();
  const current = pickCurrentCompany(await getMyCompanies());
  if (current?.role !== 'encarregado') return { companyId, restricted: false, userId: null, coverages: [] };

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (!auth.user) throw authError ?? new Error('Sessão expirada. Faça login novamente.');

  const { data, error } = await supabase
    .from('responsibility_coverages')
    .select('from_user_id, starts_on, ends_on')
    .eq('company_id', companyId)
    .eq('to_user_id', auth.user.id)
    .is('revoked_at', null);
  if (error) throw error;

  return {
    companyId,
    restricted: true,
    userId: auth.user.id,
    coverages: ((data ?? []) as Array<{ from_user_id: string; starts_on: string; ends_on: string }>).map((c) => ({
      fromUserId: c.from_user_id,
      startsOn: c.starts_on,
      endsOn: c.ends_on,
    })),
  };
}

export function canSeeJob(
  scope: JobScope,
  job: { responsible_id?: string | null; start_date?: string | null },
): boolean {
  if (!scope.restricted) return true;
  if (!job.responsible_id) return false;
  if (job.responsible_id === scope.userId) return true;
  if (!job.start_date) return false;
  const date = toBrazilDateOnly(job.start_date);
  return scope.coverages.some(
    (c) => c.fromUserId === job.responsible_id && date >= c.startsOn && date <= c.endsOn,
  );
}

/** Para o filtro `.in('responsible_id', ...)` de consultas com `limit` (a data é conferida depois). */
export function scopeResponsibleIds(scope: JobScope): string[] {
  return [...new Set([scope.userId ?? '', ...scope.coverages.map((c) => c.fromUserId)])].filter(Boolean);
}
