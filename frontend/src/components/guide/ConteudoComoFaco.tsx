import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ButtonLink, FIELD_CONTROL_CLASS, ListRow } from '../ui';
import { useGuide } from '../../hooks/useGuide';
import { buscarRoteiros, sugestoesDaTela, termos } from '../../lib/guide/busca';
import { registrarBuscaSemResultado, type OrigemGuia } from '../../lib/guide/metricas';
import { rotaAtual } from '../../lib/guide/rotas';
import { roteirosDoPapel } from '../../lib/guide/roteiros';
import type { RoteiroGuia } from '../../lib/guide/tipos';
import { GuideChecklist } from './GuideChecklist';

const PAUSA_DE_DIGITACAO_MS = 1500;

export interface ConteudoComoFacoProps {
    /** Chamado depois que um roteiro começa (para o painel que hospeda se fechar). */
    onEscolher?: () => void;
}

/**
 * Corpo da ajuda "Como faço…?", sem casca: o painel do guia usa dentro de um Dialog e o copiloto
 * pode compor como o modo "Me mostre" do próprio painel.
 */
export function ConteudoComoFaco({ onEscolher }: ConteudoComoFacoProps) {
    const contexto = useGuide();
    const { pathname } = useLocation();
    const [consulta, setConsulta] = useState('');
    const campo = useId();
    const papel = contexto?.papel ?? null;

    const quantos = termos(consulta).length;
    const resultados = useMemo(() => (papel ? buscarRoteiros(papel, consulta) : []), [papel, consulta]);
    const sugestoes = useMemo(() => (papel ? sugestoesDaTela(papel, pathname) : []), [papel, pathname]);
    const semResultado = quantos > 0 && resultados.length === 0;

    // Uma métrica por abertura, só depois de a pessoa parar de digitar. O texto nunca sai daqui.
    const registrada = useRef(false);
    useEffect(() => {
        if (!papel || !semResultado || registrada.current) return;
        const t = window.setTimeout(() => {
            registrada.current = true;
            registrarBuscaSemResultado(papel, quantos, rotaAtual(pathname));
        }, PAUSA_DE_DIGITACAO_MS);
        return () => window.clearTimeout(t);
    }, [papel, semResultado, quantos, pathname, consulta]);

    if (!contexto || !papel) return null;

    const lista = (titulo: string, itens: readonly RoteiroGuia[], origem: OrigemGuia) => (
        <section aria-label={titulo}>
            <h3 className="text-base font-bold">{titulo}</h3>
            <ul className="divide-y divide-gray-200">
                {itens.map((roteiro) => (
                    <li key={roteiro.id}>
                        <ListRow
                            title={roteiro.titulo}
                            meta={roteiro.descricao}
                            onActivate={() => {
                                onEscolher?.();
                                contexto.iniciar(roteiro.id, origem);
                            }}
                        />
                    </li>
                ))}
            </ul>
        </section>
    );

    return (
        <div className="space-y-4">
            <div>
                <label htmlFor={campo} className="mb-1 block text-sm font-bold">O que você quer fazer?</label>
                <input
                    id={campo}
                    type="search"
                    value={consulta}
                    onChange={(e) => setConsulta(e.target.value)}
                    placeholder="Ex.: pagar freela"
                    autoComplete="off"
                    data-autofocus
                    className={`${FIELD_CONTROL_CLASS} w-full`}
                />
            </div>
            <p className="sr-only" role="status">
                {quantos === 0 ? '' : resultados.length === 0 ? 'Nenhum guia encontrado' : `${resultados.length} guias encontrados`}
            </p>
            {quantos > 0 ? (
                resultados.length > 0 ? lista('Resultados', resultados, 'ajuda') : (
                    <p className="text-sm text-gray-700">
                        Não achei um guia para isso. Tente outras palavras ou veja a lista completa abaixo.
                    </p>
                )
            ) : (
                <>
                    {sugestoes.length > 0 && lista('Nesta tela', sugestoes, 'sugestao')}
                    <GuideChecklist />
                </>
            )}
            <details open={semResultado || undefined}>
                <summary className="min-h-11 cursor-pointer py-3 text-sm font-bold">Ver todos os guias</summary>
                {lista('Todos os guias', roteirosDoPapel(papel), 'ajuda')}
            </details>
            <ButtonLink variant="ghost" to="/ajuda" onClick={onEscolher}>Perguntas frequentes</ButtonLink>
        </div>
    );
}

export default ConteudoComoFaco;
