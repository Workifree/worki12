import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { logError } from '../../../lib/logger';
import type { BonusAdminAdapter, EnrollmentItem, EnrollmentStatus, NewEnrollment } from './types';
import { blockReasonText, formatDate, PIX_MATCH_PROCEDURE } from './format';
import { useLoad } from './useLoad';
import { ErrorState } from '../../ui';

interface Props {
    adapter: BonusAdminAdapter;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INPUT = 'w-full border-2 border-black rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary';
const PRIMARY = 'min-h-[44px] px-6 py-3 rounded-xl font-black uppercase bg-black text-white hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed';
const SECONDARY = 'min-h-[44px] px-6 py-3 rounded-xl font-black uppercase border-2 border-black bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed';

const STATUS_LABELS: Record<EnrollmentStatus, string> = {
    invited: 'Convidado', active: 'Ativa', ended: 'Encerrada', cancelled: 'Cancelada',
};

function PixMatchProcedure() {
    return (
        <div className="text-sm">
            <p className="font-black uppercase">Como desfazer o bloqueio de PIX</p>
            <ol className="list-decimal pl-5 space-y-1">
                {PIX_MATCH_PROCEDURE.map((step) => <li key={step}>{step}</li>)}
            </ol>
        </div>
    );
}

function Alerts({ adapter }: Props) {
    const fetcher = useCallback(() => adapter.getAlerts(), [adapter]);
    const { data, loading, error, reload } = useLoad(fetcher, 'bonus: alertas');
    if (loading) return <div className="h-16 bg-gray-200 rounded-xl animate-pulse" role="status"><span className="sr-only">Carregando</span></div>;
    if (error || !data) return <ErrorState title="Não foi possível carregar os alertas." message="Não pague nada antes de conferir." onRetry={() => void reload()} />;
    const pixBlocked = data.items.some((a) => a.blockReason === 'pix_match');
    return (
        <section aria-labelledby="bonus-alertas" className="bg-white border-2 border-black rounded-2xl p-4 sm:p-6 space-y-3">
            <h3 id="bonus-alertas" className="text-lg font-black uppercase">Alertas</h3>
            {data.evaluationFailed.length > 0 && (
                <p role="alert" className="rounded-xl border-2 border-black bg-red-100 text-red-800 px-4 py-3 font-black">
                    NÃO PAGUE: a avaliação falhou para {data.evaluationFailed.join(', ')}.
                </p>
            )}
            {data.items.length === 0 && <p className="text-sm font-bold">Nenhum alerta registrado.</p>}
            <ul className="space-y-2">
                {data.items.map((a) => (
                    <li key={a.id} className="text-sm border-b border-gray-200 pb-2 break-words">
                        <strong>{formatDate(a.at)} · {a.operatorName || 'operador não identificado'}: </strong>
                        {a.kind === 'voided_late'
                            ? 'recibo estornado depois da janela de validação. O bônus já contado não é desfeito sozinho; confira o caso.'
                            : a.blockReason ? `pagamento bloqueado: ${blockReasonText(a.blockReason)}` : 'bloqueio de pagamento removido.'}
                    </li>
                ))}
            </ul>
            {pixBlocked && <PixMatchProcedure />}
        </section>
    );
}

type Run = (action: () => Promise<void>, success: string) => Promise<boolean>;

function EnrollmentCard({ item, adapter, run, busy }: { item: EnrollmentItem; adapter: BonusAdminAdapter; run: Run; busy: boolean }) {
    const [byLabel, setByLabel] = useState('');
    const [note, setNote] = useState('');
    const [confirmCancel, setConfirmCancel] = useState(false);
    const open = item.status === 'invited' || item.status === 'active';

    const ack = (e: FormEvent) => {
        e.preventDefault();
        void run(() => adapter.registerCompanyAck(item.enrollmentId, byLabel.trim(), note.trim()), 'Ciência do patrão registrada.');
    };

    return (
        <article className="bg-white border-2 border-black rounded-2xl p-4 sm:p-6 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <h3 className="text-lg font-black break-words">{item.displayName}</h3>
                    <p className="text-sm text-gray-700">{item.companyName} · trilha {item.trackKey}{item.endsAt ? ` · até ${formatDate(item.endsAt)}` : ''}</p>
                </div>
                <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-bold">{STATUS_LABELS[item.status]}</span>
            </div>
            <p className="text-sm font-bold">
                {item.companyAckAt ? `Patrão ciente: ${item.companyAckByLabel ?? '-'} em ${formatDate(item.companyAckAt)}` : 'Falta a ciência do patrão.'}
                {item.acceptedAt ? ` · Aceita em ${formatDate(item.acceptedAt)}` : ''}
            </p>
            {(item.payoutBlockReason || item.evaluationFailed) && (
                <div className="rounded-xl border-2 border-black bg-red-100 text-red-800 px-4 py-3 space-y-2">
                    {item.payoutBlockReason && <p className="font-black">Pagamento bloqueado: {blockReasonText(item.payoutBlockReason)}</p>}
                    {item.evaluationFailed && <p className="font-black">Não pagável: {blockReasonText('evaluation_failed')}</p>}
                    {item.payoutBlockReason === 'pix_match' && <PixMatchProcedure />}
                </div>
            )}
            {!item.companyAckAt && item.status === 'invited' && (
                <form onSubmit={ack} className="space-y-3">
                    <div>
                        <label htmlFor={`ack-by-${item.enrollmentId}`} className="block text-sm font-bold mb-1">Quem deu a ciência (nome do patrão)</label>
                        <input id={`ack-by-${item.enrollmentId}`} className={INPUT} maxLength={80} value={byLabel} onChange={(e) => setByLabel(e.target.value)} />
                    </div>
                    <div>
                        <label htmlFor={`ack-note-${item.enrollmentId}`} className="block text-sm font-bold mb-1">Como foi registrada</label>
                        <input id={`ack-note-${item.enrollmentId}`} className={INPUT} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
                        <p className="text-xs text-gray-600 mt-1">Não escreva dado pessoal (CPF, telefone, endereço) na nota.</p>
                    </div>
                    <button type="submit" disabled={busy || !byLabel.trim() || !note.trim()} className={SECONDARY}>Registrar ciência</button>
                </form>
            )}
            {open && (
                <div className="flex flex-wrap gap-3">
                    {item.status === 'invited' && (
                        <p className="w-full text-sm text-gray-700">A inscrição fica ativa quando o operador aceitar o convite no app.</p>
                    )}
                    {confirmCancel ? (
                        <>
                            <button type="button" disabled={busy} className={PRIMARY}
                                onClick={() => void run(() => adapter.cancelEnrollment(item.enrollmentId), 'Inscrição cancelada.')}>
                                Confirmar cancelamento
                            </button>
                            <button type="button" className={SECONDARY} onClick={() => setConfirmCancel(false)}>Voltar</button>
                        </>
                    ) : (
                        <button type="button" disabled={busy} className={SECONDARY} onClick={() => setConfirmCancel(true)}>Cancelar inscrição</button>
                    )}
                </div>
            )}
        </article>
    );
}

const EMPTY: NewEnrollment = { trackKey: 'eventos', operatorUserId: '', companyId: '', displayName: '' };

export default function EnrollmentsPanel({ adapter }: Props) {
    const listFetcher = useCallback(() => adapter.getEnrollments(), [adapter]);
    const enabledFetcher = useCallback(() => adapter.getProgramEnabled(), [adapter]);
    const list = useLoad(listFetcher, 'bonus: inscrições');
    const program = useLoad(enabledFetcher, 'bonus: interruptor');
    const [form, setForm] = useState<NewEnrollment>(EMPTY);
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);

    const run: Run = async (action, success) => {
        setBusy(true);
        setMessage('');
        let ok = true;
        try {
            await action();
            setMessage(success);
            await Promise.all([list.reload(), program.reload()]);
        } catch (err) {
            ok = false;
            logError('bonus: inscrições', err);
            setMessage(err instanceof Error ? err.message : 'Não foi possível concluir.');
        }
        setBusy(false);
        return ok;
    };

    const create = async (e: FormEvent) => {
        e.preventDefault();
        const input = { ...form, operatorUserId: form.operatorUserId.trim(), companyId: form.companyId.trim(), displayName: form.displayName.trim() };
        if (!input.displayName) { setMessage('Informe o nome do operador.'); return; }
        if (!UUID_RE.test(input.operatorUserId) || !UUID_RE.test(input.companyId)) { setMessage('Informe os IDs do operador e da empresa (formato UUID).'); return; }
        if (await run(() => adapter.createEnrollment(input), 'Inscrição criada.')) setForm(EMPTY);
    };

    return (
        <section aria-labelledby="bonus-inscricoes" className="space-y-4">
            <h2 id="bonus-inscricoes" className="text-xl font-black uppercase">Inscrições</h2>

            <div className="bg-white border-2 border-black rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                <p className="font-bold">
                    Programa de bônus: {program.data === null ? 'carregando ou indisponível' : program.data ? 'ligado' : 'desligado'}
                </p>
                <button type="button" role="switch" aria-checked={program.data === true} aria-label="Programa de bônus ligado"
                    disabled={busy || program.data === null} className={program.data ? SECONDARY : PRIMARY}
                    onClick={() => void run(() => adapter.setProgramEnabled(!program.data), program.data ? 'Programa desligado.' : 'Programa ligado.')}>
                    {program.data ? 'Desligar' : 'Ligar'}
                </button>
                <p className="w-full text-xs text-gray-600">Vale para o programa inteiro. Cada trilha tem seu próprio status.</p>
            </div>

            <Alerts adapter={adapter} />

            {message && <p role="status" className="text-sm font-bold bg-gray-100 border-2 border-black rounded-xl px-4 py-2">{message}</p>}

            <form onSubmit={create} noValidate className="bg-white border-2 border-black rounded-2xl p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <h3 className="sm:col-span-2 text-lg font-black uppercase">Nova inscrição</h3>
                <div>
                    <label htmlFor="enr-track" className="block text-sm font-bold mb-1">Trilha</label>
                    <select id="enr-track" className={INPUT} value={form.trackKey}
                        onChange={(e) => setForm((f) => ({ ...f, trackKey: e.target.value === 'lojas' ? 'lojas' : 'eventos' }))}>
                        <option value="eventos">Eventos</option>
                        <option value="lojas">Lojas</option>
                    </select>
                </div>
                <div>
                    <label htmlFor="enr-name" className="block text-sm font-bold mb-1">Nome do operador</label>
                    <input id="enr-name" className={INPUT} maxLength={80} value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
                </div>
                <div>
                    <label htmlFor="enr-user" className="block text-sm font-bold mb-1">ID do usuário do operador</label>
                    <input id="enr-user" className={INPUT} value={form.operatorUserId} onChange={(e) => setForm((f) => ({ ...f, operatorUserId: e.target.value }))} />
                </div>
                <div>
                    <label htmlFor="enr-company" className="block text-sm font-bold mb-1">ID da empresa</label>
                    <input id="enr-company" className={INPUT} value={form.companyId} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))} />
                </div>
                <div className="sm:col-span-2">
                    <button type="submit" disabled={busy} className={PRIMARY}>Criar inscrição</button>
                </div>
            </form>

            {list.loading && <div className="h-24 bg-gray-200 rounded-xl animate-pulse" role="status"><span className="sr-only">Carregando</span></div>}
            {list.error && <ErrorState title={list.error} onRetry={() => void list.reload()} />}
            {list.data && list.data.length === 0 && <p className="font-bold">Nenhuma inscrição.</p>}
            {(list.data ?? []).map((item) => (
                <EnrollmentCard key={item.enrollmentId} item={item} adapter={adapter} run={run} busy={busy} />
            ))}
        </section>
    );
}
