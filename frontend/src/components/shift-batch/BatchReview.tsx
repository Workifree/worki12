import {
    batchSummary, dayLabel, effectiveShift, mergeMessage, plural, rowCost,
    type DraftMerge, type ShiftDraftBatch, type ShiftDraftIssue, type ShiftDraftRow,
} from '../../lib/shiftDrafts';
import { formatBRL } from '../../lib/currency';
import { ActionBar, Alert, Button, ButtonLink, Card } from '../ui';
import type { ReactNode } from 'react';

/** Revisão antes de publicar. `batch.rows` já vem agrupado e ordenado. */
export function BatchReview({
    batch, merges, issues, notices, onSeparate, onEditRow, onBack, onPublish, publishing, errorMessage,
    rowErrors, seriesNote, canCall, inviteCount, onRowPeople, callSection, riskWarnings,
}: {
    batch: ShiftDraftBatch;
    merges: DraftMerge[];
    issues: ShiftDraftIssue[];
    /** O que o texto/cópia não conseguiu trazer. */
    notices: string[];
    onSeparate: (sourceKeys: string[]) => void;
    onEditRow: (key: string) => void;
    onBack: () => void;
    onPublish: () => void;
    publishing: boolean;
    errorMessage: string | null;
    /** Recusas do banco por linha (chave da linha → mensagem). */
    rowErrors: Record<string, string>;
    seriesNote: string | null;
    canCall: boolean;
    inviteCount: (row: ShiftDraftRow) => number;
    onRowPeople: (key: string) => void;
    callSection: ReactNode;
    riskWarnings: string[];
}) {
    const summary = batchSummary(batch.template, batch.rows);
    const batchIssues = issues.filter((i) => i.row_key === '');
    const blockingCount = issues.filter((i) => i.blocking).length;

    return (
        <div className="flex flex-col gap-5">
            <header>
                <h2 className="text-2xl font-bold tabular-nums">
                    {plural(summary.shifts, 'turno', 'turnos')} · {plural(summary.slots, 'vaga', 'vagas')}
                </h2>
                <p className="text-sm text-gray-600">{formatBRL(summary.cost)} previstos. Você paga direto aos freelas.</p>
                {seriesNote && <p className="mt-1 text-sm text-gray-600">{seriesNote}</p>}
            </header>

            {notices.length > 0 && (
                <Alert tone="warning" title="Confira o que ficou de fora">
                    <ul>{notices.map((n) => <li key={n}>{n}</li>)}</ul>
                </Alert>
            )}
            {merges.map((m) => (
                <Alert
                    key={m.key}
                    tone="info"
                    action={<Button variant="secondary" onClick={() => onSeparate(m.sourceKeys)} data-copilot={m.key === merges[0].key ? 'empresa.turno-lote.separar' : undefined}>Separar</Button>}
                >
                    {mergeMessage(m)}
                </Alert>
            ))}
            {batchIssues.map((i) => <Alert key={i.detail} tone="danger" role="alert">{i.detail}</Alert>)}

            <ul className="flex flex-col gap-2">
                {batch.rows.map((row) => {
                    const shift = effectiveShift(batch.template, row);
                    const own = issues.filter((i) => i.row_key === row.key);
                    const invited = inviteCount(row);
                    return (
                        <Card as="li" key={row.key} padding="sm" tone="nested">
                            <p className="text-sm font-bold tabular-nums">
                                {dayLabel(row.date)} {row.start_time || '--:--'}–{row.end_time || '--:--'}
                            </p>
                            <p className="break-words text-sm">{shift.title || 'Sem título'}</p>
                            <p className="text-xs text-gray-600">
                                {plural(row.slots || 0, 'vaga', 'vagas')} · {formatBRL(rowCost(batch.template, row))}
                                {canCall && invited > 0 ? ` · chamar ${plural(invited, 'pessoa', 'pessoas')}` : ''}
                            </p>
                            {rowErrors[row.key] && <p role="alert" className="mt-2 text-sm font-bold text-red-700">{rowErrors[row.key]}</p>}
                            {own.map((issue, i) => (
                                <Alert
                                    key={`${issue.kind}-${i}`}
                                    tone={issue.blocking ? 'danger' : 'warning'}
                                    className="mt-2"
                                    action={issue.job_id ? <ButtonLink variant="secondary" to={`/company/jobs/${issue.job_id}`} target="_blank" rel="noopener">Ver turno parecido</ButtonLink> : undefined}
                                >
                                    {issue.detail}
                                </Alert>
                            ))}
                            <div className="mt-2 flex flex-wrap gap-2">
                                <Button variant="ghost" onClick={() => onEditRow(row.key)} aria-label={`Editar ${dayLabel(row.date)} ${row.start_time}`}>Editar</Button>
                                {canCall && (
                                    <Button variant="ghost" onClick={() => onRowPeople(row.key)} aria-label={`Freelas deste turno: ${dayLabel(row.date)} ${row.start_time}`}>
                                        Freelas deste turno
                                    </Button>
                                )}
                            </div>
                        </Card>
                    );
                })}
            </ul>

            {callSection}
            {riskWarnings.length > 0 && (
                <Alert tone="warning" title="Frequência na semana">
                    <ul>{riskWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </Alert>
            )}
            {errorMessage && <Alert tone="danger" role="alert">{errorMessage}</Alert>}

            <ActionBar
                summary={blockingCount > 0 ? <p role="status">Corrija {plural(blockingCount, 'pendência', 'pendências')} para publicar.</p> : undefined}
                secondary={<Button variant="secondary" onClick={onBack} disabled={publishing}>Voltar</Button>}
                primary={
                    <Button variant="dark" size="lg" loading={publishing} disabled={blockingCount > 0 || batch.rows.length === 0} onClick={onPublish} data-copilot="empresa.turno-lote.publicar">
                        Publicar {batch.rows.length}
                    </Button>
                }
            />
        </div>
    );
}
