import { CheckCircle2, Circle } from 'lucide-react';
import { Button, Card, ListRow, ProgressBar } from '../ui';
import { useGuide } from '../../hooks/useGuide';
import { PRIMEIROS_PASSOS, roteirosDoPapel } from '../../lib/guide/roteiros';

export interface GuideChecklistProps {
    /** Mostra o botão de esconder (uso no Início). Na ajuda a lista fica sempre disponível. */
    ocultavel?: boolean;
    className?: string;
}

/**
 * Primeiros passos. A marca significa "já vi o guia", não que a tarefa foi feita: o guia não lê o
 * banco, e o texto diz isso.
 */
export function GuideChecklist({ ocultavel = false, className }: GuideChecklistProps) {
    const contexto = useGuide();
    if (!contexto?.papel) return null;
    const { papel, progresso, iniciar, ocultarChecklist } = contexto;
    if (ocultavel && progresso.checklistOculto) return null;

    const todos = roteirosDoPapel(papel);
    const itens = PRIMEIROS_PASSOS[papel].flatMap((id) => todos.filter((r) => r.id === id));
    const vistos = itens.filter((r) => progresso.concluidos.includes(r.id)).length;
    if (ocultavel && vistos === itens.length) return null;

    return (
        <Card as="section" padding="sm" aria-label="Primeiros passos" className={className}>
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-bold">Primeiros passos</h3>
                {ocultavel && <Button variant="ghost" size="sm" onClick={ocultarChecklist}>Esconder</Button>}
            </div>
            <p className="mb-2 text-xs text-gray-600">{vistos} de {itens.length} guias vistos neste aparelho</p>
            <ProgressBar value={vistos} max={itens.length} label={`${vistos} de ${itens.length} guias vistos`} />
            <ul className="mt-2 divide-y divide-gray-200">
                {itens.map((roteiro) => {
                    const visto = progresso.concluidos.includes(roteiro.id);
                    const Icone = visto ? CheckCircle2 : Circle;
                    return (
                        <li key={roteiro.id}>
                            <ListRow
                                leading={<Icone size={20} aria-hidden="true" className="shrink-0" />}
                                title={roteiro.titulo}
                                meta={visto ? 'Guia visto' : 'Me mostre'}
                                onActivate={() => iniciar(roteiro.id, 'checklist')}
                            />
                        </li>
                    );
                })}
            </ul>
        </Card>
    );
}

export default GuideChecklist;
