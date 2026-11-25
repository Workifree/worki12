import { CheckCircle2 } from 'lucide-react';
import { batchSummary, dayLabel, plural, shortDate, type ShiftDraftRow, type ShiftDraftTemplate } from '../../lib/shiftDrafts';
import type { CallPlanItem, CallResult } from '../../services/shiftBatchService';
import { Alert, Button, ButtonLink, ListRow, Spinner } from '../ui';

export interface PublishedBatch {
    template: ShiftDraftTemplate;
    rows: ShiftDraftRow[];
    jobIds: string[];
    alreadyCreated: boolean;
    publishedOn: string;
    plan: CallPlanItem[];
}

/** Turnos já estão publicados. Os chamados são tentativas: cada falha tem seu "Tentar de novo". */
export function BatchDone({
    done, results, sending, onRetry, onMore,
}: {
    done: PublishedBatch;
    /** Por job_id. Sem entrada = ainda não tentado. */
    results: Record<string, CallResult>;
    sending: ReadonlySet<string>;
    onRetry: (item: CallPlanItem) => void;
    onMore: () => void;
}) {
    const summary = batchSummary(done.template, done.rows);
    const all = Object.values(results);
    const sent = all.filter((r) => r.status === 'sent').length;
    const failed = all.filter((r) => r.status === 'failed').length;
    const pending = done.plan.length - sent - failed;
    const one = done.jobIds.length === 1;

    return (
        <div className="flex flex-col gap-5">
            <header className="flex items-start gap-3">
                <CheckCircle2 size={28} aria-hidden="true" className="mt-1 shrink-0 text-primary" />
                <div>
                    <h2 className="text-2xl font-bold" role="status">
                        {plural(done.jobIds.length, 'turno publicado', 'turnos publicados')}
                    </h2>
                    <p className="text-sm text-gray-600">
                        {done.alreadyCreated
                            ? 'Estes turnos já tinham sido criados. Nada foi duplicado.'
                            : `${plural(summary.slots, 'vaga', 'vagas')} · lote ${shortDate(done.publishedOn)}`}
                    </p>
                    {done.plan.length > 0 && (
                        <p className="mt-1 text-sm font-bold" aria-live="polite">
                            Chamados: {plural(sent, 'enviado', 'enviados')}
                            {failed > 0 ? ` · ${failed} ${failed === 1 ? 'falhou' : 'falharam'}` : ''}
                            {pending > 0 ? ` · enviando ${pending}` : ''}
                        </p>
                    )}
                </div>
            </header>

            {failed > 0 && (
                <Alert tone="warning">Os turnos continuam publicados. Só o aviso aos freelas falhou.</Alert>
            )}

            <ul className="divide-y divide-gray-200">
                {done.rows.map((row, i) => {
                    const jobId = done.jobIds[i];
                    if (!jobId) return null;
                    const item = done.plan.find((p) => p.job_id === jobId);
                    const result = results[jobId];
                    return (
                        <li key={jobId} className="py-1">
                            <ListRow
                                title={`${dayLabel(row.date)} ${row.start_time}–${row.end_time}`}
                                meta={`0/${row.slots} · ${item ? (sending.has(jobId) ? 'Enviando chamado' : result?.status === 'sent' ? 'Chamado enviado' : result ? 'Chamado falhou' : 'Chamado na fila') : 'Sem chamado'}`}
                                trailing={
                                    <>
                                        {sending.has(jobId) && <Spinner label="Enviando chamado" />}
                                        <ButtonLink variant="ghost" to={`/company/jobs/${jobId}/candidates${item ? '' : '?chamar=1'}`}>
                                            {item ? 'Ver' : 'Chamar'}
                                        </ButtonLink>
                                    </>
                                }
                            />
                            {item && result?.status === 'failed' && !sending.has(jobId) && (
                                <Alert tone="danger" role="alert" action={<Button variant="secondary" onClick={() => onRetry(item)} aria-label={`Tentar de novo: ${dayLabel(row.date)} ${row.start_time}`}>Tentar de novo</Button>}>
                                    {result.error}
                                </Alert>
                            )}
                        </li>
                    );
                })}
            </ul>

            <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
                <Button variant="secondary" disabled={sending.size > 0} onClick={onMore} data-copilot="empresa.turno-lote.criar-mais">Criar mais</Button>
                <ButtonLink variant="dark" to="/company/jobs">{one ? 'Ver meus turnos' : 'Ver os turnos'}</ButtonLink>
            </div>
        </div>
    );
}
