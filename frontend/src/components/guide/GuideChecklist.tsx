import { useState } from 'react';
import { CheckCircle2, ChevronDown, Circle } from 'lucide-react';
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
const CHAVE_VISTO = 'worki:primeiros-passos:visto';
const CHAVE_ABERTO = 'worki:primeiros-passos:aberto';

/** 1ª visita: aberto (e marca como visto). Depois: o que a pessoa deixou, padrão recolhido. */
function lerAbertoInicial(): boolean {
    try {
        if (!localStorage.getItem(CHAVE_VISTO)) {
            localStorage.setItem(CHAVE_VISTO, '1');
            return true;
        }
        return localStorage.getItem(CHAVE_ABERTO) === '1';
    } catch {
        return false;
    }
}

export function GuideChecklist({ ocultavel = false, className }: GuideChecklistProps) {
    const contexto = useGuide();
    // Na ajuda (não ocultável) a lista fica sempre aberta.
    const [aberto, setAberto] = useState<boolean>(() => (ocultavel ? lerAbertoInicial() : true));
    if (!contexto?.papel) return null;
    const { papel, progresso, iniciar, ocultarChecklist } = contexto;
    if (ocultavel && progresso.checklistOculto) return null;

    const todos = roteirosDoPapel(papel);
    const itens = PRIMEIROS_PASSOS[papel].flatMap((id) => todos.filter((r) => r.id === id));
    const vistos = itens.filter((r) => progresso.concluidos.includes(r.id)).length;
    if (ocultavel && vistos === itens.length) return null;

    const proximo = itens.find((r) => !progresso.concluidos.includes(r.id));
    const alternar = () => {
        const novo = !aberto;
        setAberto(novo);
        try { localStorage.setItem(CHAVE_ABERTO, novo ? '1' : '0'); } catch { /* sem armazenamento: só nesta visita */ }
    };

    const lista = (
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
    );

    if (!ocultavel) {
        return (
            <Card as="section" padding="sm" aria-label="Primeiros passos" className={className}>
                <h3 className="text-base font-semibold">Primeiros passos</h3>
                <p className="mb-2 text-xs text-gray-600">{vistos} de {itens.length} guias vistos neste aparelho</p>
                <ProgressBar value={vistos} max={itens.length} label={`${vistos} de ${itens.length} guias vistos`} />
                {lista}
            </Card>
        );
    }

    // Recolhível: fechado ocupa uma linha (título, contagem e próximo passo).
    return (
        <Card as="section" padding="sm" aria-label="Primeiros passos" className={className}>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={alternar}
                    aria-expanded={aberto}
                    className="-my-1 flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                >
                    <span className="min-w-0 flex-1">
                        <span className="block text-base font-semibold">Primeiros passos</span>
                        <span className="block truncate text-xs text-gray-600">
                            {vistos} de {itens.length} vistos{!aberto && proximo ? ` · Próximo: ${proximo.titulo}` : ''}
                        </span>
                    </span>
                    <ChevronDown size={20} aria-hidden="true" className={`shrink-0 transition-transform motion-reduce:transition-none ${aberto ? 'rotate-180' : ''}`} />
                </button>
                <Button variant="ghost" size="sm" onClick={ocultarChecklist}>Esconder</Button>
            </div>
            {aberto && (
                <>
                    <ProgressBar className="mt-2" value={vistos} max={itens.length} label={`${vistos} de ${itens.length} guias vistos`} />
                    {lista}
                </>
            )}
        </Card>
    );
}

export default GuideChecklist;
