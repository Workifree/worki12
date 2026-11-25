// Ações admin da Trilha de bônus (spec trilha-bonus-operador: AF6, R26, R27, R28, R30).
// Roda só dentro do admin-data, depois da checagem de admin. Article 10: service_role fica aqui.
// Article 8: nada aqui toca wallets. O service_role só tem SELECT nas tabelas de bônus:
// TODA escrita passa por RPC admin_bonus_* (migration 20261124000*), que também grava o rastro.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);

class BonusInputError extends Error {}
class BonusForbiddenError extends Error {}

export const isBonusAction = (action: unknown): boolean => typeof action === 'string' && action.startsWith('bonus_');
export const isBonusInputError = (e: unknown): e is Error => e instanceof BonusInputError;
export const isBonusForbiddenError = (e: unknown): e is Error => e instanceof BonusForbiddenError;

// Limites por parâmetro de trilha (todos inteiros). Chave fora do mapa é recusada.
// Espelha as 22 chaves exigidas por bonus_tracks_params_keys; max_per_worker_week ∈ [1,2] (regra da rede).
const PARAM_BOUNDS: Record<string, readonly [number, number]> = {
    validation_hours: [0, 168], review_hours: [1, 168], receipt_hours: [1, 168], receipt_grace_days: [0, 30],
    min_shift_minutes: [0, 1440], checkin_tolerance_min: [0, 720], checkout_tolerance_min: [0, 720],
    min_lead_minutes: [0, 10080], max_counted_per_day: [1, 50], max_counted_per_week: [1, 200],
    max_per_worker_week: [1, 2], burst_count: [2, 50], burst_window_hours: [1, 168],
    single_worker_pct: [1, 100], single_worker_min_shifts: [1, 100], stuck_minutes: [0, 240],
    pattern_count: [2, 50], max_gap_days: [1, 90], min_shifts_for_gap: [1, 100], briefing_min_chars: [0, 500],
    clock_tolerance_min: [1, 240], stuck_times_enabled: [0, 1],
};

const MUTATIONS = new Set([
    'bonus_decide', 'bonus_mark_paid', 'bonus_veto_add', 'bonus_veto_remove', 'bonus_track_params_update',
    'bonus_enrollment_create', 'bonus_enrollment_ack', 'bonus_enrollment_cancel',
    'bonus_set_enabled', 'bonus_track_status_update',
]);

const SP_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });

// Semana (segunda) pela data local de São Paulo, não pela UTC.
function mondayOf(iso: string): string {
    const d = new Date(`${SP_DATE.format(new Date(iso))}T00:00:00Z`);
    const day = (d.getUTCDay() + 6) % 7; // segunda = 0
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().slice(0, 10);
}

const mapBy = (rows: Row[] | null, key: string): Map<string, Row> =>
    new Map((rows ?? []).map((r) => [str(r[key]), r]));

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
    const { data, error } = await p;
    if (error) throw new Error(error.message); // genérico para o client: o index.ts só loga
    return data;
}

// As RPCs admin_bonus_* recusam parte dos casos devolvendo {outcome} sem EXCEPTION: sem esta
// checagem a recusa viraria "ok" falso. Repetições idempotentes contam como sucesso.
const OK_OUTCOMES = new Set(['ok', 'already_decided', 'already_paid', 'already_vetoed', 'not_vetoed', 'already_cancelled']);
const OUTCOME_MESSAGES: Record<string, string> = {
    invalid: 'Dados incompletos ou inválidos',
    track_not_open: 'A trilha ainda não está aberta para inscrições',
    identity_required: 'Este operador não pode ser inscrito (dono único, conta operada pelo Worki ou sócio)',
    already_enrolled: 'Este operador já tem uma inscrição',
    not_found: 'Registro não encontrado',
    not_invited: 'A inscrição não está mais aguardando aceite',
    already_ended: 'A inscrição já foi encerrada',
    dependencies_missing: 'Ainda não dá para ligar o programa. Falta',
    not_payable_yet: 'Este pedido ainda não pode ser pago (o operador pode cancelar até o corte de sexta)',
    blocked_review: 'NÃO PAGUE: o pedido está em conferência ou mudou. Atualize a lista',
};

async function mutate(db: SupabaseClient, rpc: string, args: Row): Promise<void> {
    const result = (await must(db.rpc(rpc, args))) as Row | null;
    const outcome = str(result?.outcome);
    if (OK_OUTCOMES.has(outcome)) return;
    const base = Object.hasOwn(OUTCOME_MESSAGES, outcome) ? OUTCOME_MESSAGES[outcome] : 'A operação foi recusada';
    const missing = Array.isArray(result?.missing) ? `: ${(result.missing as unknown[]).map(String).join('; ')}` : '';
    // as recusas de pagamento trazem a frase exata do banco
    throw new BonusInputError(str(result?.message) || `${base}${missing}`);
}

// Inscrições que o admin_bonus_refresh não conseguiu avaliar: o estado delas está velho, então
// NÃO podem ser pagas. Aceita `failed`/`failed_enrollments` como uuids, nomes ou objetos.
// A S4 devolve failed: [{enrollment_id, error}] e grava payout_block_reason='evaluation_failed'.
interface Failures { ids: Set<string>; names: Set<string> }

async function refresh(db: SupabaseClient): Promise<Failures> {
    const result = (await must(db.rpc('admin_bonus_refresh'))) as Row | null;
    const raw = result?.failed ?? result?.failed_enrollments;
    const out: Failures = { ids: new Set(), names: new Set() };
    for (const f of Array.isArray(raw) ? (raw as unknown[]) : []) {
        if (typeof f === 'string') {
            (UUID_RE.test(f) ? out.ids : out.names).add(f);
        } else if (f && typeof f === 'object') {
            const o = f as Row;
            const id = str(o.enrollment_id ?? o.id);
            const name = str(o.display_name ?? o.name);
            if (id) out.ids.add(id);
            else if (name) out.names.add(name);
        }
    }
    return out;
}

const hasFailed = (f: Failures, id: string, name: string): boolean => f.ids.has(id) || f.names.has(name);

export async function handleBonusAction(
    db: SupabaseClient,
    adminUserId: string | null,
    body: Row,
): Promise<Row> {
    const action = str(body.action);

    // Mutação exige ator humano identificado (o rastro grava quem fez); bearer service_role não tem ator.
    if (MUTATIONS.has(action) && !adminUserId) throw new BonusForbiddenError('sem ator');

    // C4: a avaliação precisa rodar antes de montar a fila e a lista de PIX.
    let failures: Failures = { ids: new Set(), names: new Set() };
    if (['bonus_review_queue', 'bonus_payouts', 'bonus_enrollments', 'bonus_alerts'].includes(action)) {
        failures = await refresh(db);
    }

    if (action === 'bonus_review_queue') {
        const ledger = (await must(db.from('bonus_shift_ledger')
            .select('id, enrollment_id, job_id, worker_id, flags, flagged_at, review_due_at')
            .eq('review', 'open').order('flagged_at', { ascending: true }))) as Row[];
        const enrollIds = [...new Set(ledger.map((l) => str(l.enrollment_id)))];
        const jobIds = [...new Set(ledger.map((l) => str(l.job_id)))];
        const workerIds = [...new Set(ledger.map((l) => str(l.worker_id)))];
        const [enr, jobs, workers] = await Promise.all([
            must(db.from('bonus_enrollments').select('id, display_name, company_id').in('id', enrollIds)),
            must(db.from('jobs').select('id, title').in('id', jobIds)),
            must(db.from('workers').select('id, full_name').in('id', workerIds)),
        ]);
        const enrMap = mapBy(enr as Row[], 'id');
        const companyIds = [...new Set((enr as Row[]).map((e) => str(e.company_id)))];
        const companies = mapBy(await must(db.from('companies').select('id, name').in('id', companyIds)) as Row[], 'id');
        const jobMap = mapBy(jobs as Row[], 'id');
        const workerMap = mapBy(workers as Row[], 'id');
        // Valor em jogo: awards ainda não pagos cuja evidência cita este turno.
        const stake = await Promise.all(ledger.map(async (l) => {
            const rows = (await must(db.from('bonus_awards').select('amount_cents')
                .in('state', ['earned', 'in_payout']).contains('evidence', { ledger_ids: [str(l.id)] }))) as Row[];
            return rows.reduce((s, r) => s + num(r.amount_cents), 0);
        }));
        const items = ledger.map((l, i) => {
            const e = enrMap.get(str(l.enrollment_id));
            return {
                ledgerId: str(l.id),
                operatorName: str(e?.display_name),
                companyName: str(companies.get(str(e?.company_id))?.name),
                jobTitle: str(jobMap.get(str(l.job_id))?.title),
                workerName: str(workerMap.get(str(l.worker_id))?.full_name),
                flags: Array.isArray(l.flags) ? (l.flags as unknown[]).map(String) : [],
                valueAtStakeCents: stake[i],
                flaggedAt: str(l.flagged_at),
                reviewDueAt: l.review_due_at ? str(l.review_due_at) : null,
            };
        });
        return { items };
    }

    if (action === 'bonus_decide') {
        const ledgerId = str(body.ledgerId);
        const decision = str(body.decision);
        if (!UUID_RE.test(ledgerId)) throw new BonusInputError('ledgerId inválido');
        if (decision !== 'approve' && decision !== 'not_count') throw new BonusInputError('decisão inválida');
        const note = str(body.note).slice(0, 300) || null;
        await mutate(db, 'admin_bonus_decide_shift', {
            p_ledger_id: ledgerId, p_decision: decision, p_decided_by: adminUserId, p_note: note,
        });
        return { ok: true };
    }

    if (action === 'bonus_payouts') {
        const payouts = (await must(db.from('bonus_payouts')
            .select('id, enrollment_id, amount_cents, status, scheduled_for, pix_key_snapshot')
            .eq('status', 'requested').order('scheduled_for', { ascending: true }))) as Row[];
        const ids = payouts.map((p) => str(p.id));
        const enrollIds = [...new Set(payouts.map((p) => str(p.enrollment_id)))];
        const [enr, awards] = await Promise.all([
            must(db.from('bonus_enrollments').select('id, display_name, company_id, payout_block_reason').in('id', enrollIds)),
            must(db.from('bonus_awards').select('payout_id, milestone_id, amount_cents, tier').in('payout_id', ids)),
        ]);
        const milestoneIds = [...new Set((awards as Row[]).map((a) => str(a.milestone_id)))];
        const [ms, companies] = await Promise.all([
            must(db.from('bonus_milestones').select('id, title').in('id', milestoneIds)),
            must(db.from('companies').select('id, name').in('id', [...new Set((enr as Row[]).map((e) => str(e.company_id)))])),
        ]);
        const enrMap = mapBy(enr as Row[], 'id');
        const msMap = mapBy(ms as Row[], 'id');
        const coMap = mapBy(companies as Row[], 'id');
        const items = payouts.map((p) => {
            const e = enrMap.get(str(p.enrollment_id));
            const evaluationFailed = hasFailed(failures, str(p.enrollment_id), str(e?.display_name));
            return {
                payoutId: str(p.id),
                operatorName: str(e?.display_name),
                companyName: str(coMap.get(str(e?.company_id))?.name),
                amountCents: num(p.amount_cents),
                pixKey: str(p.pix_key_snapshot),
                scheduledFor: str(p.scheduled_for),
                // M1/M2: bloqueado pela revalidação, ou ainda antes do corte (sábado 00:00 de São Paulo)
                blocked: evaluationFailed || e?.payout_block_reason != null,
                blockReason: evaluationFailed ? 'evaluation_failed'
                    : e?.payout_block_reason ? str(e.payout_block_reason) : null,
                payable: !evaluationFailed && e?.payout_block_reason == null
                    && Date.now() >= Date.parse(`${str(p.scheduled_for)}T00:00:00-03:00`) - 2 * 86_400_000,
                milestones: (awards as Row[]).filter((a) => str(a.payout_id) === str(p.id)).map((a) => ({
                    title: str(msMap.get(str(a.milestone_id))?.title),
                    amountCents: num(a.amount_cents),
                })),
            };
        });
        return { items };
    }

    if (action === 'bonus_mark_paid') {
        const payoutId = str(body.payoutId);
        if (!UUID_RE.test(payoutId)) throw new BonusInputError('payoutId inválido');
        const note = str(body.note).slice(0, 300) || null;
        await mutate(db, 'admin_bonus_mark_payout_paid', { p_payout_id: payoutId, p_paid_by: adminUserId, p_note: note });
        return { ok: true };
    }

    if (action === 'bonus_vetos') {
        const vetos = (await must(db.from('bonus_vetos')
            .select('person_id, reason, created_at').order('created_at', { ascending: false }))) as Row[];
        const workers = mapBy(await must(db.from('workers')
            .select('id, full_name').in('id', vetos.map((v) => str(v.person_id)))) as Row[], 'id');
        return {
            items: vetos.map((v) => ({
                personId: str(v.person_id),
                personName: str(workers.get(str(v.person_id))?.full_name),
                reason: str(v.reason),
                createdAt: str(v.created_at),
            })),
        };
    }

    if (action === 'bonus_veto_add') {
        const personId = str(body.personId);
        if (!UUID_RE.test(personId)) throw new BonusInputError('ID da pessoa inválido');
        const reason = str(body.reason).trim().slice(0, 200);
        if (!reason) throw new BonusInputError('Informe o motivo');
        await mutate(db, 'admin_bonus_veto_add', { p_person_id: personId, p_reason: reason, p_created_by: adminUserId });
        return { ok: true };
    }

    if (action === 'bonus_veto_remove') {
        const personId = str(body.personId);
        if (!UUID_RE.test(personId)) throw new BonusInputError('ID da pessoa inválido');
        await mutate(db, 'admin_bonus_veto_remove', { p_person_id: personId, p_removed_by: adminUserId });
        return { ok: true };
    }

    if (action === 'bonus_tracks') {
        const rows = (await must(db.from('bonus_tracks')
            .select('key, name, status, cap_cents, params').order('key'))) as Row[];
        return {
            items: rows.map((t) => ({
                trackKey: str(t.key), name: str(t.name), status: str(t.status),
                capCents: num(t.cap_cents), params: (t.params as Row) ?? {},
            })),
        };
    }

    if (action === 'bonus_track_params_update') {
        const trackKey = str(body.trackKey);
        if (trackKey !== 'eventos' && trackKey !== 'lojas') throw new BonusInputError('Trilha inválida');
        const incoming = body.params;
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new BonusInputError('params inválidos');
        const clean: Record<string, number> = {};
        for (const [k, v] of Object.entries(incoming as Row)) {
            if (!Object.hasOwn(PARAM_BOUNDS, k)) throw new BonusInputError(`Parâmetro desconhecido: ${k}`);
            const [min, max] = PARAM_BOUNDS[k];
            if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
                throw new BonusInputError(`Valor inválido em ${k} (inteiro entre ${min} e ${max})`);
            }
            clean[k] = v;
        }
        if (Object.keys(clean).length === 0) throw new BonusInputError('Nada para salvar');
        // Sem leitura-seguida-de-escrita aqui: a RPC faz o merge atomicamente (resolve a corrida).
        await mutate(db, 'admin_bonus_track_params_update', {
            p_track_key: trackKey, p_params: clean, p_updated_by: adminUserId,
        });
        return { ok: true };
    }

    if (action === 'bonus_track_status_update') {
        const trackKey = str(body.trackKey);
        const status = str(body.status);
        if (trackKey !== 'eventos' && trackKey !== 'lojas') throw new BonusInputError('Trilha inválida');
        if (status !== 'calibrating' && status !== 'open' && status !== 'closed') throw new BonusInputError('Status inválido');
        await mutate(db, 'admin_bonus_track_status_update', {
            p_track_key: trackKey, p_status: status, p_updated_by: adminUserId,
        });
        return { ok: true };
    }

    if (action === 'bonus_tracking') {
        const [enr, awards] = await Promise.all([
            must(db.from('bonus_enrollments').select('id, status, cap_cents')),
            must(db.from('bonus_awards').select('state, amount_cents, earned_at, available_at')),
        ]);
        const active = (enr as Row[]).filter((e) => str(e.status) === 'active');
        const now = Date.now();
        let earned = 0, available = 0, paid = 0;
        const byWeek = new Map<string, number>();
        for (const a of (awards as Row[])) {
            const cents = num(a.amount_cents);
            const state = str(a.state);
            if (state !== 'not_counted') earned += cents;
            if (state === 'in_payout' || (state === 'earned' && new Date(str(a.available_at)).getTime() <= now)) available += cents;
            if (state === 'paid') paid += cents;
            if (state !== 'not_counted' && a.earned_at) {
                const w = mondayOf(str(a.earned_at));
                byWeek.set(w, (byWeek.get(w) ?? 0) + 1);
            }
        }

        // Hábito derivado do histórico. Se a leitura falhar, o resto do painel continua.
        let habit: Row[] = [];
        let habitAvailable = true;
        const { data: habitRows, error: habitErr } = await db.rpc('admin_bonus_habit_overview');
        if (habitErr || !Array.isArray(habitRows)) {
            habitAvailable = false;
        } else {
            const opt = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));
            habit = (habitRows as Row[]).map((h) => ({
                operatorName: str(h.operator_name ?? h.display_name),
                baselineWeeklyAvg: opt(h.baseline_weekly_avg),
                avgWeeks1to12: opt(h.avg_weeks_1_12),
                avgWeeks13to16: opt(h.avg_weeks_13_16),
            }));
        }
        return {
            activeOperators: active.length,
            maxExposureCents: active.reduce((s, e) => s + num(e.cap_cents), 0),
            earnedCents: earned, availableCents: available, paidCents: paid,
            milestonesByWeek: [...byWeek.entries()]
                .sort(([a], [b]) => (a < b ? -1 : 1))
                .map(([weekStart, count]) => ({ weekStart, count })),
            habit, habitAvailable,
        };
    }

    if (action === 'bonus_params_history') {
        // O rastro é gravado pelas RPCs em bonus_admin_log.
        const rows = (await must(db.from('bonus_admin_log').select('id, at, actor, action, detail')
            .like('action', 'track_%').order('at', { ascending: false }).limit(30))) as Row[];
        return {
            items: rows.map((r) => ({
                id: String(r.id),
                at: str(r.at),
                actorLabel: `admin ${str(r.actor).slice(0, 8)}`,
                summary: `${str(r.action)}: ${JSON.stringify(r.detail ?? {}).slice(0, 300)}`,
            })),
        };
    }

    if (action === 'bonus_alerts') {
        const [logs, enr] = await Promise.all([
            must(db.from('bonus_admin_log').select('id, at, action, target_id, detail')
                .in('action', ['alert_payability', 'alert_voided_late']).order('at', { ascending: false }).limit(50)),
            must(db.from('bonus_enrollments').select('id, display_name')),
        ]);
        const enrMap = mapBy(enr as Row[], 'id');
        const items = (logs as Row[]).map((r) => {
            const detail = (r.detail ?? {}) as Row;
            const voided = str(r.action) === 'alert_voided_late';
            // alert_payability aponta para a inscrição; alert_voided_late para o turno (inscrição no detail).
            const enrollmentId = voided ? str(detail.enrollment_id) : str(r.target_id);
            return {
                id: String(r.id),
                at: str(r.at),
                kind: voided ? 'voided_late' : 'payability',
                operatorName: str(enrMap.get(enrollmentId)?.display_name),
                blockReason: !voided && detail.after ? str(detail.after) : null,
            };
        });
        const failed = new Set(failures.names);
        for (const id of failures.ids) failed.add(str(enrMap.get(id)?.display_name) || id);
        return { items, evaluationFailed: [...failed] };
    }

    if (action === 'bonus_enrollments') {
        const [rows, tracks] = await Promise.all([
            must(db.from('bonus_enrollments')
                .select('id, track_id, company_id, display_name, status, company_ack_at, company_ack_by_label, accepted_at, ends_at, payout_block_reason')
                .order('display_name')),
            must(db.from('bonus_tracks').select('id, key')),
        ]);
        const list = rows as Row[];
        const trackMap = mapBy(tracks as Row[], 'id');
        const companies = mapBy(await must(db.from('companies').select('id, name')
            .in('id', [...new Set(list.map((e) => str(e.company_id)))])) as Row[], 'id');
        return {
            items: list.map((e) => ({
                enrollmentId: str(e.id),
                trackKey: str(trackMap.get(str(e.track_id))?.key),
                displayName: str(e.display_name),
                companyName: str(companies.get(str(e.company_id))?.name),
                status: str(e.status),
                companyAckAt: e.company_ack_at ? str(e.company_ack_at) : null,
                companyAckByLabel: e.company_ack_by_label ? str(e.company_ack_by_label) : null,
                acceptedAt: e.accepted_at ? str(e.accepted_at) : null,
                endsAt: e.ends_at ? str(e.ends_at) : null,
                payoutBlockReason: e.payout_block_reason ? str(e.payout_block_reason) : null,
                evaluationFailed: hasFailed(failures, str(e.id), str(e.display_name)),
            })),
        };
    }

    // Não existe RPC de ativação: a inscrição vira 'active' quando o próprio operador aceita.
    if (action === 'bonus_enrollment_create') {
        const trackKey = str(body.trackKey);
        const operatorUserId = str(body.operatorUserId);
        const companyId = str(body.companyId);
        const displayName = str(body.displayName).trim();
        if (trackKey !== 'eventos' && trackKey !== 'lojas') throw new BonusInputError('Trilha inválida');
        if (!UUID_RE.test(operatorUserId) || !UUID_RE.test(companyId)) throw new BonusInputError('ID de operador ou empresa inválido');
        if (!displayName || displayName.length > 80) throw new BonusInputError('Nome deve ter de 1 a 80 caracteres');
        await mutate(db, 'admin_bonus_enrollment_create', {
            p_track_key: trackKey, p_operator_user_id: operatorUserId, p_company_id: companyId,
            p_display_name: displayName, p_created_by: adminUserId,
        });
        return { ok: true };
    }

    if (action === 'bonus_enrollment_ack' || action === 'bonus_enrollment_cancel') {
        const enrollmentId = str(body.enrollmentId);
        if (!UUID_RE.test(enrollmentId)) throw new BonusInputError('Inscrição inválida');
        if (action === 'bonus_enrollment_ack') {
            const byLabel = str(body.byLabel).trim().slice(0, 120);
            const note = str(body.note).trim().slice(0, 500);
            if (!byLabel || !note) throw new BonusInputError('Informe quem deu a ciência e como foi obtida');
            await mutate(db, 'admin_bonus_enrollment_ack', {
                p_enrollment_id: enrollmentId, p_ack_by_label: byLabel, p_ack_note: note, p_actor: adminUserId,
            });
        } else {
            await mutate(db, 'admin_bonus_enrollment_cancel', { p_enrollment_id: enrollmentId, p_actor: adminUserId });
        }
        return { ok: true };
    }

    if (action === 'bonus_settings') {
        const row = await must(db.from('bonus_program_settings').select('enabled').maybeSingle()) as Row | null;
        return { enabled: row?.enabled === true };
    }

    if (action === 'bonus_set_enabled') {
        if (typeof body.enabled !== 'boolean') throw new BonusInputError('Valor inválido');
        await mutate(db, 'admin_bonus_set_enabled', { p_enabled: body.enabled, p_updated_by: adminUserId });
        return { ok: true };
    }

    throw new BonusInputError('Ação de bônus inválida');
}
