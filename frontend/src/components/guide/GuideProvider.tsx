import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DialogHeader } from '../ui';
import { Dialog } from '../ui/Dialog';
import { useAuth } from '../../contexts/AuthContext';
import { GuiaContext, type GuiaContextValue } from '../../hooks/useGuide';
import {
    SEM_GUIA, alvoValido, papelAlcanca, prepararDestaque, publicarEstado, registrarControlador, rotasPermitidas,
    type Resultado,
} from '../../lib/guide/api';
import { resolverEscolha } from '../../lib/guide/escolha';
import { registrarConclusao, registrarInicio, type OrigemGuia } from '../../lib/guide/metricas';
import { PROGRESSO_VAZIO, gravarProgresso, lerProgresso, type ProgressoGuia } from '../../lib/guide/progresso';
import { ROTAS, estaNaRota, guiaPermitidoEm, type RotaId } from '../../lib/guide/rotas';
import type { PapelGuia, PassoAtivo } from '../../lib/guide/tipos';
import { ConteudoComoFaco } from './ConteudoComoFaco';
import { GuideSpotlight } from './GuideSpotlight';
import { GuideWelcome } from './GuideWelcome';

interface Sessao {
    /** `userId:papel`: troca de conta ou de papel descarta o que estava aberto. */
    dono: string;
    chave: number;
    roteiroId: string | null;
    passos: readonly PassoAtivo[];
    indice: number;
    focar: boolean;
    /** Tela em que o passo começou: só uma CHEGADA depois disso avança sozinha. */
    entrouEm: string;
}

const OK: Resultado = { ok: true };
const recusa = (motivo: Extract<Resultado, { ok: false }>['motivo']): Resultado => ({ ok: false, motivo });

/**
 * Fica DENTRO do Router e do AuthProvider, envolvendo as rotas (o recibo fica fora dos layouts, e o
 * guia precisa sobreviver à ida até ele). Os layouts informam o papel com `<GuideRole>`.
 */
export function GuideProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const userId = user?.id ?? null;
    const [papelInformado, setPapel] = useState<PapelGuia | null>(null);
    const permitido = !!userId && guiaPermitidoEm(pathname);
    const papel = permitido ? papelInformado : null;
    const dono = userId && papel ? `${userId}:${papel}` : null;

    const [sessaoGuardada, setSessao] = useState<Sessao | null>(null);
    const sessao = sessaoGuardada && sessaoGuardada.dono === dono ? sessaoGuardada : null;
    const [ajudaDe, setAjudaDe] = useState<string | null>(null);
    const ajudaAberta = !!dono && ajudaDe === dono;
    const [alvoVisivel, setAlvoVisivel] = useState<boolean | null>(null);
    const sequencia = useRef(0);
    const tituloAjuda = useId();

    const [gravados, setGravados] = useState<Record<string, ProgressoGuia>>({});
    const progresso = useMemo(
        () => (userId && papel ? gravados[`${userId}:${papel}`] ?? lerProgresso(userId, papel) : PROGRESSO_VAZIO),
        [gravados, userId, papel],
    );
    const salvar = useCallback((mudanca: Partial<ProgressoGuia>) => {
        if (!userId || !papel) return;
        setGravados((atual) => {
            const chave = `${userId}:${papel}`;
            const novo = { ...(atual[chave] ?? lerProgresso(userId, papel)), ...mudanca };
            gravarProgresso(userId, papel, novo);
            return { ...atual, [chave]: novo };
        });
    }, [userId, papel]);

    /** Única porta de navegação: só destinos literais da lista fechada. */
    const irPara = useCallback((rota: RotaId) => {
        const destino = ROTAS[rota].destino;
        if (destino && !estaNaRota(pathname, rota)) navigate(destino);
    }, [navigate, pathname]);

    /** Mudança de passo pedida pela pessoa: pode abrir a tela do passo. */
    const abrirPasso = useCallback((passo: PassoAtivo) => {
        if (!passo.rota) return;
        if ([passo.rota, ...(passo.tambemEm ?? [])].some((r) => estaNaRota(pathname, r))) return;
        irPara(passo.rota);
    }, [pathname, irPara]);

    const comecar = useCallback((roteiroId: string | null, passos: readonly PassoAtivo[]) => {
        if (!dono) return;
        sequencia.current += 1;
        setAjudaDe(null);
        setAlvoVisivel(null);
        // Quem já está na tela de destino pula o "como chegar lá" (senão o guia a tiraria dali).
        let indice = 0;
        while (indice < passos.length - 1) {
            const destino = passos[indice].avancaAoChegar;
            if (!destino || !estaNaRota(pathname, destino)) break;
            indice += 1;
        }
        setSessao({
            dono, chave: sequencia.current, roteiroId, passos, indice, focar: true, entrouEm: pathname,
        });
        abrirPasso(passos[indice]);
    }, [dono, pathname, abrirPasso]);

    const iniciarComOrigem = useCallback((id: unknown, origem: OrigemGuia): Resultado => {
        if (!papel) return recusa('guia-indisponivel');
        const roteiro = resolverEscolha(papel, id);
        if (!roteiro) return recusa('roteiro-desconhecido');
        registrarInicio(papel, roteiro.id, origem);
        comecar(roteiro.id, roteiro.passos);
        return OK;
    }, [papel, comecar]);

    const sair = useCallback(() => setSessao(null), []);

    const mudarIndice = useCallback((indice: number, porPedido: boolean) => {
        if (!sessao) return;
        setAlvoVisivel(null);
        setSessao({ ...sessao, indice, focar: porPedido, entrouEm: pathname });
        if (porPedido) abrirPasso(sessao.passos[indice]);
    }, [sessao, pathname, abrirPasso]);

    const concluir = useCallback(() => {
        if (!sessao || !papel) return;
        if (sessao.roteiroId) {
            registrarConclusao(papel, sessao.roteiroId);
            if (!progresso.concluidos.includes(sessao.roteiroId)) {
                salvar({ concluidos: [...progresso.concluidos, sessao.roteiroId] });
            }
        }
        setSessao(null);
    }, [sessao, papel, progresso, salvar]);

    const avancar = useCallback((porPedido: boolean) => {
        if (!sessao) return;
        if (sessao.indice >= sessao.passos.length - 1) concluir();
        else mudarIndice(sessao.indice + 1, porPedido);
    }, [sessao, concluir, mudarIndice]);

    // A PESSOA chegou à tela que o passo esperava (ex.: abriu a presença do turno escolhido).
    const passo = sessao?.passos[sessao.indice];
    const chegou = !!passo?.avancaAoChegar && pathname !== sessao?.entrouEm
        && estaNaRota(pathname, passo.avancaAoChegar);
    useEffect(() => {
        if (!chegou) return;
        const t = window.setTimeout(() => avancar(false), 0);
        return () => window.clearTimeout(t);
    }, [chegou, avancar]);

    const aoToque = useCallback((avanca: boolean) => {
        if (avanca) avancar(false);
        else concluir();
    }, [avancar, concluir]);

    const abrirAjuda = useCallback(() => {
        setSessao(null);
        setAjudaDe(dono);
    }, [dono]);

    useEffect(() => registrarControlador({
        destacar(alvo, pedido) {
            if (!papel) return recusa('guia-indisponivel');
            if (!alvoValido(alvo, papel)) return recusa('alvo-invalido');
            const texto = prepararDestaque(pedido);
            comecar(null, [{ alvos: [alvo], ...texto, aoTocar: '' }]);
            return OK;
        },
        iniciarRoteiro: (id) => iniciarComOrigem(id, 'copiloto'),
        irPara(rota) {
            if (!papel) return recusa('guia-indisponivel');
            const achada = rotasPermitidas(papel).find((r) => r.id === rota && r.navegavel);
            if (!achada || !papelAlcanca(papel, achada.id)) return recusa('rota-nao-permitida');
            irPara(achada.id);
            return OK;
        },
        abrirAjuda() {
            if (!papel) return recusa('guia-indisponivel');
            abrirAjuda();
            return OK;
        },
        sair() {
            setAjudaDe(null);
            sair();
        },
    }), [papel, comecar, iniciarComOrigem, irPara, abrirAjuda, sair]);

    useEffect(() => () => publicarEstado(SEM_GUIA), []);

    useEffect(() => {
        publicarEstado({
            disponivel: !!papel,
            papel,
            ativo: sessao
                ? { roteiroId: sessao.roteiroId, passo: sessao.indice + 1, total: sessao.passos.length, alvoVisivel }
                : null,
        });
    });

    const valor = useMemo<GuiaContextValue>(() => ({
        papel,
        progresso,
        definirPapel: setPapel,
        iniciar: (id, origem) => { iniciarComOrigem(id, origem); },
        abrirAjuda,
        ocultarChecklist: () => salvar({ checklistOculto: true }),
    }), [papel, progresso, iniciarComOrigem, abrirAjuda, salvar]);

    return (
        <GuiaContext.Provider value={valor}>
            {children}
            {papel && !progresso.boasVindasVistas && !sessao && !ajudaAberta && (
                <GuideWelcome key={dono} papel={papel} onFechar={() => salvar({ boasVindasVistas: true })} />
            )}
            {ajudaAberta && (
                <Dialog labelledBy={tituloAjuda} onClose={() => setAjudaDe(null)}>
                    <DialogHeader
                        titleId={tituloAjuda}
                        title="Copiloto"
                        subtitle="Escolha um guia: o app mostra onde tocar."
                        onClose={() => setAjudaDe(null)}
                    />
                    <ConteudoComoFaco onEscolher={() => setAjudaDe(null)} />
                </Dialog>
            )}
            {sessao && passo && (
                <GuideSpotlight
                    key={`${sessao.chave}:${sessao.indice}`}
                    passo={passo}
                    indice={sessao.indice}
                    total={sessao.passos.length}
                    pathname={pathname}
                    focar={sessao.focar}
                    onProximo={() => avancar(true)}
                    onVoltar={() => mudarIndice(sessao.indice - 1, true)}
                    onSair={sair}
                    onIrPara={irPara}
                    onToqueNoAlvo={aoToque}
                    onAlvoVisivel={setAlvoVisivel}
                />
            )}
        </GuiaContext.Provider>
    );
}

export default GuideProvider;
