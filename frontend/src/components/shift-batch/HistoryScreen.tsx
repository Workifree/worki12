import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Search } from 'lucide-react';
import { shortDate, templateFromJob, type SourceJob } from '../../lib/shiftDrafts';
import { toBrazilDateOnly } from '../../lib/dateUtils';
import { formatBRL } from '../../lib/currency';
import { Alert, Button, Card, SkeletonList } from '../ui';

/** Mais de 5 itens: vale a pena procurar. */
const SEARCH_FROM = 5;

const norm = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** "12/11 · 18:00–23:00 · 3 vagas · R$ 150,00" (a data é a do turno antigo, só para reconhecer). */
function summaryLine(job: SourceJob): string {
    const { defaults } = templateFromJob(job);
    return [
        job.start_date && shortDate(toBrazilDateOnly(job.start_date)),
        defaults.start_time && defaults.end_time && `${defaults.start_time}–${defaults.end_time}`,
        defaults.slots > 1 && `${defaults.slots} vagas`,
        defaults.budget > 0 && formatBRL(defaults.budget),
    ].filter(Boolean).join(' · ');
}

/**
 * Repetir um turno anterior: o dono toca num turno do histórico e o editor abre com os dados dele.
 * Só a data (e, se quiser, o horário) fica por ajustar.
 */
export function HistoryScreen({ models, error, onRetry, onPick, onBack }: {
    /** null = carregando */
    models: SourceJob[] | null;
    error: boolean;
    onRetry: () => void;
    onPick: (job: SourceJob) => void;
    onBack: () => void;
}) {
    const [rawQuery, setQuery] = useState('');
    // Troca de tela: o leitor de tela anuncia onde está.
    useEffect(() => { document.getElementById('lote-historico')?.focus({ preventScroll: true }); }, []);
    // A busca some com 5 turnos ou menos: o filtro some junto (senão esconderia itens sem como limpar).
    const searchable = (models?.length ?? 0) > SEARCH_FROM;
    const query = searchable ? rawQuery : '';
    const visible = models && query.trim()
        ? models.filter((job) => norm(templateFromJob(job).template.title).includes(norm(query)))
        : models;

    return (
        <div className="flex flex-col gap-4">
            <div>
                <Button variant="ghost" onClick={onBack} iconLeft={<ArrowLeft size={16} />} className="-ml-3 mb-1">Voltar</Button>
                <h2 id="lote-historico" tabIndex={-1} className="text-xl font-bold focus:outline-none">Repetir um turno anterior</h2>
                <p className="mt-1 text-sm text-gray-600">Toque em um turno para repetir. Você ajusta só a data e o horário.</p>
            </div>

            {error && (
                <Alert tone="warning" action={<Button variant="secondary" onClick={onRetry}>Tentar de novo</Button>}>
                    Não conseguimos carregar seus turnos anteriores.
                </Alert>
            )}
            {!error && models === null && <SkeletonList count={3} itemClassName="h-20" />}
            {!error && models?.length === 0 && (
                <p className="rounded-xl border border-dashed border-gray-300 px-4 py-4 text-sm text-gray-600">
                    Os turnos que você publicar aparecem aqui para repetir.
                </p>
            )}

            {searchable && (
                <div className="relative">
                    <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                        type="search"
                        aria-label="Buscar nos turnos anteriores"
                        placeholder="Buscar turno"
                        value={rawQuery}
                        onChange={(e) => setQuery(e.target.value)}
                        className="min-h-11 w-full rounded-xl border border-gray-300 bg-white pl-9 pr-3 text-base"
                    />
                </div>
            )}

            {visible && visible.length > 0 && (
                <ul className="flex flex-col gap-3" data-copilot="empresa.turno-lote.repetir-recente">
                    {visible.map((job) => {
                        const { template } = templateFromJob(job);
                        return (
                            <li key={job.id}>
                                <Card as="div" padding="none" tone="default" className="shadow-brutal-sm">
                                    <button
                                        type="button"
                                        onClick={() => onPick(job)}
                                        className="group flex min-h-20 w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors duration-fast hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
                                    >
                                        <span className="min-w-0 flex-1">
                                            <span className="line-clamp-2 break-words text-base font-bold">{template.title}</span>
                                            <span className="mt-0.5 block text-xs text-gray-600">{summaryLine(job)}</span>
                                        </span>
                                        <span className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-xl border-2 border-black bg-[#2563EB] px-3 text-sm font-bold text-white">
                                            Repetir
                                            <ChevronRight size={16} aria-hidden="true" />
                                        </span>
                                    </button>
                                </Card>
                            </li>
                        );
                    })}
                </ul>
            )}
            {visible && visible.length === 0 && models && models.length > 0 && (
                <p className="text-sm text-gray-600">Nenhum turno com “{query}”.</p>
            )}
        </div>
    );
}
