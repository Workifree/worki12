import { Fragment, type CSSProperties } from 'react';
import { ArrowRight, BadgeCheck, CalendarPlus, Check, ChevronRight, Send, Trophy, Users, type LucideIcon } from 'lucide-react';
import { Button, Card } from '../ui';
import { useGuide } from '../../hooks/useGuide';
import { PRIMEIROS_PASSOS, roteirosDoPapel } from '../../lib/guide/roteiros';
import './roadmap.css';

export interface GuideChecklistProps {
    /** Mostra o botão de esconder (uso no Início). Na ajuda a trilha fica sempre disponível. */
    ocultavel?: boolean;
    className?: string;
}

/** Ícones dos passos, em ordem; o último nó é sempre o troféu (a meta). */
const ICONES: readonly LucideIcon[] = [Users, CalendarPlus, Send, BadgeCheck];

/** Cores do Worki, chapadas (schapado): freela = verde da marca; empresa e encarregado = azul. */
const CORES = {
    freela: { a: '#008840', b: '#008840' },
    empresa: { a: '#2563EB', b: '#2563EB' },
} as const;

/**
 * Primeiros passos como trilha: nós ligados por curvas com seta; os guias já vistos ficam preenchidos,
 * o próximo tem um anel que respira e logo abaixo vem o botão "Me mostre". A marca significa "já vi o
 * guia", não que a tarefa foi feita: o guia não lê o banco, e o texto diz isso.
 */
export function GuideChecklist({ ocultavel = false, className }: GuideChecklistProps) {
    const contexto = useGuide();
    if (!contexto?.papel) return null;
    const { papel, progresso, iniciar, ocultarChecklist } = contexto;
    if (ocultavel && progresso.checklistOculto) return null;

    const todos = roteirosDoPapel(papel);
    const itens = PRIMEIROS_PASSOS[papel].flatMap((id) => todos.filter((r) => r.id === id));
    const visto = (id: string) => progresso.concluidos.includes(id);
    const vistos = itens.filter((r) => visto(r.id)).length;
    if (ocultavel && vistos === itens.length) return null;
    const atualIndice = itens.findIndex((r) => !visto(r.id));
    const atual = atualIndice >= 0 ? itens[atualIndice] : null;
    const paleta = papel === 'freela' ? CORES.freela : CORES.empresa;
    const total = itens.length;

    return (
        <Card
            as="section"
            padding="sm"
            aria-label="Primeiros passos"
            className={`wk-road ${className ?? ''}`}
            style={{ '--rm-a': paleta.a, '--rm-b': paleta.b } as CSSProperties}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <h3 className="text-base font-bold">Seus primeiros passos</h3>
                    <p className="text-xs text-gray-600">{vistos} de {total} guias vistos neste aparelho</p>
                </div>
                {ocultavel && <Button variant="ghost" size="sm" onClick={ocultarChecklist}>Esconder</Button>}
            </div>

            <ol className="mt-3 flex items-start" aria-label="Trilha dos guias">
                {itens.map((roteiro, i) => {
                    const feito = visto(roteiro.id);
                    const agora = i === atualIndice;
                    const estado = feito ? 'done' : agora ? 'now' : 'todo';
                    const Icone = i === total - 1 ? Trophy : ICONES[i % ICONES.length];
                    return (
                        <Fragment key={roteiro.id}>
                            <li className="wk-road__step flex w-11 shrink-0 flex-col items-center sm:w-24" data-state={estado}>
                                <button
                                    type="button"
                                    className="wk-road__node"
                                    data-state={estado}
                                    style={{ '--i': i } as CSSProperties}
                                    aria-label={`Passo ${i + 1} de ${total}: ${roteiro.titulo}. ${feito ? 'Guia visto.' : 'Toque para ver o guia.'}`}
                                    onClick={() => iniciar(roteiro.id, 'checklist')}
                                >
                                    {feito ? <Check size={20} strokeWidth={3} aria-hidden="true" /> : <Icone size={20} aria-hidden="true" />}
                                </button>
                                <span className="wk-road__label hidden sm:line-clamp-2" aria-hidden="true">{roteiro.titulo}</span>
                            </li>
                            {i < total - 1 && (
                                <li className="wk-road__link" data-done={feito ? 'true' : 'false'} aria-hidden="true" style={{ '--i': i } as CSSProperties}>
                                    <svg viewBox="0 0 100 24" preserveAspectRatio="none">
                                        <path className="base" d="M0 12 C 25 2, 75 22, 100 12" />
                                        {feito && <path className="fill" pathLength={100} d="M0 12 C 25 2, 75 22, 100 12" />}
                                    </svg>
                                    <span className="wk-road__arrow"><ChevronRight size={14} strokeWidth={3} /></span>
                                </li>
                            )}
                        </Fragment>
                    );
                })}
            </ol>

            {atual ? (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-[var(--rm-tint)] px-3 py-2">
                    <p className="min-w-0 text-sm">
                        <span className="block text-[11px] font-bold uppercase tracking-wide text-gray-600">Próximo passo</span>
                        <span className="block break-words font-semibold">{atual.titulo}</span>
                    </p>
                    <Button className="shrink-0 whitespace-nowrap" variant={papel === 'freela' ? 'primary' : 'dark'} size="sm" iconRight={<ArrowRight size={16} aria-hidden="true" />} onClick={() => iniciar(atual.id, 'checklist')}>
                        Me mostre
                    </Button>
                </div>
            ) : (
                <p className="mt-3 rounded-xl bg-[var(--rm-tint)] px-3 py-2 text-sm font-semibold">Você já viu todos os guias.</p>
            )}
        </Card>
    );
}

export default GuideChecklist;
