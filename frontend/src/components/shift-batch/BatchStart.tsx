import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronRight, FileStack, History, Plus, Trash2, Undo2 } from 'lucide-react';
import { Button, Card } from '../ui';

/** Cartão grande do hub: ícone em tile, título, uma frase e chevron. A tela só ESCOLHE; nada de lista aqui. */
function StartCard({ icon, tile, title, hint, meta, onClick, ...rest }: {
    icon: ReactNode;
    tile: string;
    title: string;
    hint: string;
    meta?: string | null;
    onClick: () => void;
    'data-copilot'?: string;
}) {
    return (
        <Card as="div" padding="none" tone="default" className="shadow-brutal-sm">
            <button
                type="button"
                onClick={onClick}
                className="group flex min-h-24 w-full items-center gap-4 rounded-2xl p-4 text-left transition-colors duration-fast hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
                {...rest}
            >
                <span aria-hidden="true" className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 border-black ${tile}`}>
                    {icon}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-lg font-bold">{title}</span>
                        {meta && <span className="text-xs font-semibold text-gray-600">{meta}</span>}
                    </span>
                    <span className="mt-1 block text-sm leading-snug text-gray-600">{hint}</span>
                </span>
                <ChevronRight size={22} aria-hidden="true" className="shrink-0 text-gray-500 transition-transform group-hover:translate-x-0.5" />
            </button>
        </Card>
    );
}

/**
 * O começo escolhe entre três ideias, cada uma com nome próprio:
 * 1. Criar turno (do zero) · 2. Usar um modelo (área de modelos) · 3. Repetir um turno anterior (histórico).
 * Acima, o rascunho: continuar de onde parou.
 */
export function BatchStart({
    onBlank, onModels, onHistory, templatesCount,
    resumeLabel, onResume, onDiscard, discarded, onUndoDiscard,
}: {
    onBlank: () => void;
    onModels: () => void;
    onHistory: () => void;
    /** Quantos modelos a empresa tem. null = ainda carregando (ou falhou): sem contagem. */
    templatesCount: number | null;
    resumeLabel: string | null;
    onResume: () => void;
    onDiscard: () => void;
    /** Acabou de descartar: mostra "Desfazer". */
    discarded: boolean;
    onUndoDiscard: () => void;
}) {
    // Depois de "Desfazer" o rascunho volta e o foco vai para o Continuar (o botão que tinha o foco saiu da tela).
    const wasDiscarded = useRef(false);
    useEffect(() => {
        if (wasDiscarded.current && !discarded && resumeLabel) document.getElementById('lote-continuar')?.focus();
        wasDiscarded.current = discarded;
    }, [discarded, resumeLabel]);

    return (
        <div className="flex flex-col gap-4">
            {resumeLabel && (
                <Card as="section" padding="sm" tone="highlight" aria-label="Rascunho" data-copilot="empresa.turno-lote.rascunho">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-600">Você parou aqui</p>
                    <p className="mt-0.5 break-words text-base font-bold">{resumeLabel}</p>
                    <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                        <Button id="lote-continuar" variant="dark" size="lg" onClick={onResume} data-copilot="empresa.turno-lote.continuar-rascunho">Continuar</Button>
                        <Button variant="secondary" size="lg" aria-label="Descartar rascunho" iconLeft={<Trash2 size={16} />} onClick={onDiscard} data-copilot="empresa.turno-lote.descartar-rascunho">Descartar</Button>
                    </div>
                </Card>
            )}
            <div role="status" aria-live="polite">
                {discarded && !resumeLabel && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
                        <span>Rascunho descartado.</span>
                        <Button variant="ghost" autoFocus aria-label="Desfazer descarte do rascunho" iconLeft={<Undo2 size={16} />} onClick={onUndoDiscard}>Desfazer</Button>
                    </div>
                )}
            </div>

            <StartCard
                icon={<Plus size={26} />}
                tile="bg-[#DCE8FF] text-[#1D4ED8]"
                title="Criar turno"
                hint="Do zero, sem modelo. Preencha e lance na hora."
                onClick={onBlank}
                data-copilot="empresa.turno-lote.do-zero"
            />
            <StartCard
                icon={<FileStack size={26} />}
                tile="bg-[#E8E0FF] text-[#5B21B6]"
                title="Usar um modelo"
                meta={templatesCount ? `${templatesCount} ${templatesCount === 1 ? 'modelo' : 'modelos'}` : null}
                hint="Escolha um turno salvo e ajuste só a data. Aqui você também cria e edita modelos."
                onClick={onModels}
                data-copilot="empresa.turno-lote.usar-modelo"
            />
            <StartCard
                icon={<History size={26} />}
                tile="bg-[#D7F5E4] text-[#0B6B3A]"
                title="Repetir um turno anterior"
                hint="Pegue um do histórico e ajuste só data e horário."
                onClick={onHistory}
                data-copilot="empresa.turno-lote.abrir-historico"
            />
        </div>
    );
}
