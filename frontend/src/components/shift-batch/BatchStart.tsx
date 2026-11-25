import { useState } from 'react';
import { CalendarDays, ClipboardPaste, History, Plus } from 'lucide-react';
import { templateFromJob, type SourceJob } from '../../lib/shiftDrafts';
import { formatBRL } from '../../lib/currency';
import { Alert, Button, Field, ListRow, SkeletonList } from '../ui';

/** Três começos (modelo, copiar, texto) e o "do zero". */
export function BatchStart({
    models, modelsError, onRetryModels, onModel, onCopy, copying, onText, textIssues, onBlank, resumeLabel, onResume,
}: {
    /** null = carregando */
    models: SourceJob[] | null;
    modelsError: boolean;
    onRetryModels: () => void;
    onModel: (job: SourceJob) => void;
    onCopy: (range: 'weekend' | 'week') => void;
    copying: 'weekend' | 'week' | null;
    onText: (text: string) => void;
    textIssues: string[];
    onBlank: () => void;
    resumeLabel: string | null;
    onResume: () => void;
}) {
    const [text, setText] = useState('');
    return (
        <div className="flex flex-col gap-6">
            {resumeLabel && (
                <Alert tone="info" title="Você tem um rascunho" action={<Button variant="secondary" onClick={onResume}>Continuar rascunho</Button>}>
                    {resumeLabel}
                </Alert>
            )}
            <section aria-labelledby="lote-modelos">
                <h2 id="lote-modelos" className="text-lg font-bold">Comece de um modelo</h2>
                {modelsError && (
                    <Alert tone="warning" className="mt-2" action={<Button variant="secondary" onClick={onRetryModels}>Tentar de novo</Button>}>
                        Não conseguimos carregar seus turnos anteriores.
                    </Alert>
                )}
                {!modelsError && models === null && <SkeletonList count={2} itemClassName="h-14" className="mt-2" />}
                {models?.length === 0 && <p className="mt-1 text-sm text-gray-600">Seus turnos publicados viram modelos aqui.</p>}
                {models && models.length > 0 && (
                    <ul className="mt-1 divide-y divide-gray-200" data-copilot="empresa.turno-lote.usar-modelo">
                        {models.map((job) => {
                            const { template, defaults } = templateFromJob(job);
                            return (
                                <li key={job.id}>
                                    <ListRow
                                        title={template.title}
                                        meta={[defaults.start_time && `${defaults.start_time}–${defaults.end_time}`, defaults.budget > 0 && formatBRL(defaults.budget)].filter(Boolean).join(' · ')}
                                        onActivate={() => onModel(job)}
                                    />
                                </li>
                            );
                        })}
                    </ul>
                )}
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button variant="secondary" loading={copying === 'weekend'} disabled={copying !== null} iconLeft={<History size={16} />} onClick={() => onCopy('weekend')} data-copilot="empresa.turno-lote.copiar-fim-de-semana">
                        Repetir o fim de semana passado
                    </Button>
                    <Button variant="secondary" loading={copying === 'week'} disabled={copying !== null} iconLeft={<CalendarDays size={16} />} onClick={() => onCopy('week')} data-copilot="empresa.turno-lote.copiar-semana">
                        Repetir a semana passada
                    </Button>
                </div>
            </section>

            <section aria-label="Turnos a partir de texto" className="flex flex-col gap-2">
                <Field label="Colar ou digitar" hint="Ex.: sex e sáb 18-23h 3 garçons 150. Uma linha para cada horário.">
                    <textarea className="resize-y" rows={2} value={text} onChange={(e) => setText(e.target.value)} data-copilot="empresa.turno-lote.texto" />
                </Field>
                {textIssues.length > 0 && (
                    <Alert tone="warning" role="alert">
                        <ul>{textIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
                    </Alert>
                )}
                <Button variant="secondary" disabled={!text.trim()} iconLeft={<ClipboardPaste size={16} />} onClick={() => onText(text)} data-copilot="empresa.turno-lote.ler-texto">
                    Montar turnos do texto
                </Button>
            </section>

            <Button variant="dark" size="lg" fullWidth iconLeft={<Plus size={18} />} onClick={onBlank} data-copilot="empresa.turno-lote.do-zero">
                Criar do zero
            </Button>
        </div>
    );
}
