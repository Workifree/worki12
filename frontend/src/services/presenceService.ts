/**
 * PresenceService — presença verificada. A autorização e a validação moram no banco
 * (`supabase/migrations/20261127000100`–`000300`); aqui só se traduz o `outcome`.
 * Nada aqui toca saldo, e a coordenada do freela só segue como parâmetro da RPC.
 */
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import type {
    CompanySite, PresenceCheck, PresenceExceptionReason, PresenceKind,
} from '../lib/presence';
import type { DevicePosition } from '../lib/presenceGeo';

export interface PresenceOutcome {
    outcome: string;
    distance_m?: number | null;
    accuracy_m?: number | null;
    radius_m?: number | null;
}

export interface PresenceQr {
    outcome: string;
    token?: string;
    expires_in_s?: number;
    site_name?: string;
    address_text?: string | null;
}

async function call<T extends { outcome: string }>(fn: string, params: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.rpc(fn, params);
    if (error || !data) {
        // Só o código e a mensagem do banco: os parâmetros (coordenada, QR) nunca vão para o log.
        logError(`presenceService.${fn}`, error ? `${error.code ?? ''} ${error.message}` : 'sem resposta');
        return { outcome: 'error' } as T;
    }
    return data as T;
}

export const verifyPresence = (
    applicationId: string, kind: PresenceKind, qr: string, position: DevicePosition,
) => call<PresenceOutcome>('verify_presence', {
    p_application_id: applicationId,
    p_kind: kind,
    p_qr: qr,
    p_lat: position.lat,
    p_lng: position.lng,
    p_accuracy_m: position.accuracy,
});

export const requestPresenceException = (applicationId: string, kind: PresenceKind, reason: PresenceExceptionReason) =>
    call<PresenceOutcome>('request_presence_exception', {
        p_application_id: applicationId, p_kind: kind, p_reason: reason,
    });

export const recordPresenceException = (applicationId: string, kind: PresenceKind, reason: PresenceExceptionReason) =>
    call<PresenceOutcome>('record_presence_exception', {
        p_application_id: applicationId, p_kind: kind, p_reason: reason,
    });

export const registerDepartureUnverified = (applicationId: string) =>
    call<PresenceOutcome>('register_departure_unverified', { p_application_id: applicationId });

export const getPresenceQr = (jobId: string) => call<PresenceQr>('get_presence_qr', { p_job_id: jobId });
export const getSiteStaticQr = (siteId: string) => call<PresenceQr>('get_site_static_qr', { p_site_id: siteId });
export const rotateSiteSecret = (siteId: string) => call<PresenceOutcome>('rotate_site_secret', { p_site_id: siteId });

// ── Leituras ────────────────────────────────────────────────────────────────────────────────

const CHECK_COLUMNS =
    'id, application_id, job_id, worker_id, kind, result, distance_m, accuracy_m, reason, decided_by, created_at';

/** `null` = falha de leitura (diferente de lista vazia: não mostrar "não verificada" por queda de rede). */
export async function listPresenceChecks(
    filter: { jobId: string } | { applicationId: string },
): Promise<PresenceCheck[] | null> {
    const query = supabase.from('presence_checks').select(CHECK_COLUMNS);
    const { data, error } = await ('jobId' in filter
        ? query.eq('job_id', filter.jobId)
        : query.eq('application_id', filter.applicationId)
    ).order('created_at', { ascending: false });
    if (error) {
        logError('presenceService.listPresenceChecks', error);
        return null;
    }
    return (data ?? []) as PresenceCheck[];
}

const SITE_COLUMNS = 'id, company_id, name, address_text, lat, lng, radius_m, archived_at';

const toSite = (row: CompanySite): CompanySite => ({ ...row, lat: Number(row.lat), lng: Number(row.lng) });

export async function listSites(companyId: string): Promise<CompanySite[] | null> {
    const { data, error } = await supabase
        .from('company_sites').select(SITE_COLUMNS)
        .eq('company_id', companyId).is('archived_at', null).order('name');
    if (error) {
        logError('presenceService.listSites', error);
        return null;
    }
    return ((data ?? []) as CompanySite[]).map(toSite);
}

export interface SiteInput {
    name: string;
    address_text: string | null;
    lat: number;
    lng: number;
    radius_m: number;
}

/** RLS: só o Gestor grava. Zero linhas de volta = recusa silenciosa, tratada como erro. */
export async function saveSite(companyId: string, input: SiteInput, siteId?: string): Promise<CompanySite | null> {
    const row = { ...input, lat: Number(input.lat.toFixed(6)), lng: Number(input.lng.toFixed(6)) };
    const { data, error } = await (siteId
        ? supabase.from('company_sites').update(row).eq('id', siteId)
        : supabase.from('company_sites').insert({ ...row, company_id: companyId })
    ).select(SITE_COLUMNS);
    const saved = (data as CompanySite[] | null)?.[0];
    if (error || !saved) {
        // A mensagem do Postgres pode ecoar a linha: só o código vai para o log.
        logError('presenceService.saveSite', error?.code ?? 'sem linha');
        return null;
    }
    return toSite(saved);
}

export async function archiveSite(siteId: string): Promise<boolean> {
    const { data, error } = await supabase
        .from('company_sites').update({ archived_at: new Date().toISOString() }).eq('id', siteId).select('id');
    if (error || !data?.length) {
        logError('presenceService.archiveSite', error ?? 'sem linha');
        return false;
    }
    return true;
}
