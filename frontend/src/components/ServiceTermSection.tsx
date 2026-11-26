import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { FileText, CheckCircle2, CheckCircle, ChevronDown, ChevronUp, AlertTriangle, RefreshCw, MessageCircle } from 'lucide-react';
import { ServiceTermService } from '../services/serviceTermService';
import { PaymentRecordService } from '../services/paymentRecordService';
import { logError } from '../lib/logger';
import { useToast } from '../contexts/ToastContext';
import { Alert, Button } from './ui';
import type { ServiceTerm, ServiceTermAcceptOutcome } from '../types';

/**
 * Só EXIBIÇÃO: pontua um CPF cru (11 dígitos) que venha depois de "CPF:". O `term_text` gravado
 * continua intacto (é o documento congelado no aceite).
 */
function formatCpfForDisplay(text: string): string {
    return text.replace(/(CPF:?\s*)(\d{3})(\d{3})(\d{3})(\d{2})(?!\d)/g, '$1$2.$3.$4-$5');
}

interface ServiceTermSectionProps {
    /** `shift_payments.id` — o termo é chaveado no pagamento, nunca no turno. */
    shiftPaymentId: string;
    isWorkerViewer: boolean;
    isCompanyViewer: boolean;
    /** `shift_payments.worker_confirmed_at` — confirmação bilateral do recebimento (modo A). */
    workerConfirmedAt: string | null;
    /** Chamado depois de um `confirmReceiptByWorker` bem-sucedido, para o pai re-buscar o recibo. */
    onConfirmed: () => void;
    /** Pagamento sem valor: confirmar fica bloqueado (confirmação não se desfaz). */
    amountMissing?: boolean;
    /** "Não recebi / valor errado": abre a conversa com a empresa do turno. */
    onDispute?: () => void;
    disputing?: boolean;
    /** `true` enquanto a pessoa lê, marca ou envia: a tela segura a recarga ao vivo. */
    onBusyChange?: (busy: boolean) => void;
    /** Muda a cada recarga ao vivo do recibo: relê o termo sem esqueleto. */
    refreshKey?: number;
}

/**
 * Bloco do termo de prestação de serviço (F6, modo A) + confirmação de recebimento, dentro
 * do recibo bilateral.
 *
 * R8/A2/A3 do spec (NÃO reescritos pelo gate — só R1/R3/R4/R6/A4/A6/A9 foram): "Confirmar
 * Recebimento" tem que EXIGIR o aceite do termo antes de gravar `worker_confirmed_at`. Por
 * isso a confirmação de recebimento mora AQUI, não em `ReceiptView` — antes, os dois blocos
 * eram irmãos na página (confirmação em cima, termo embaixo) e o clique único no botão de
 * cima confirmava sem nunca tocar no termo (achado BLOCKER do evaluator, 18/08/2026).
 *
 * `handleConfirmReceipt` agora: (1) se há termo PENDENTE, aceita primeiro — abortando em
 * `missing_cpf`/`payment_voided` SEM confirmar o recebimento; (2) só então confirma. O gate
 * de leitura (`showFullText`) é pré-condição do botão combinado: ninguém confirma sem ter
 * aberto o termo inteiro.
 *
 * O Worki NÃO é parte deste termo, não valida e não garante — a cláusula já está DENTRO
 * de `term_text` (congelado no aceite, ver ADR-20260818). Este componente só EXIBE e
 * dispara o aceite; nunca decide localmente se o CPF é válido, se o termo pode ser aceito
 * ou se está "verificado" — isso é autoridade da RPC `accept_service_term`.
 *
 * Busca própria (não entra no `Promise.allSettled` do pai): `ServiceTermService` já
 * nunca lança — `getByShiftPayment` devolve um resultado discriminado
 * `{ term, failed }` em qualquer situação, então o recibo nunca trava esperando o termo.
 *
 * C-TERM-FETCH-FAIL (achado ALTO, terceira iteração): `failed=true` (rede/RLS/erro —
 * distinto de "sem termo legítimo") BLOQUEIA a confirmação de recebimento. Antes, uma
 * falha de leitura virava `term=null` indistinguível de "pagamento legado sem termo",
 * habilitando o botão e reabrindo exatamente o cenário do BLOCKER fechado (confirmar
 * sem nunca ter verificado o termo pendente). Falha fecha, nunca abre.
 *
 * C-TERM-CONSENT (achado ALTO, terceira iteração): o gate de leitura (`showFullText`)
 * é necessário mas NÃO suficiente — ter aberto o texto não é o mesmo que ter declarado
 * concordância. Quando há termo pendente, o checkbox "Li e concordo com os termos
 * acima" (`agreedToTerm`) é uma SEGUNDA pré-condição, somada (não substituta) ao gate
 * de leitura.
 */
export default function ServiceTermSection({
    shiftPaymentId,
    isWorkerViewer,
    isCompanyViewer,
    workerConfirmedAt,
    onConfirmed,
    amountMissing = false,
    onDispute,
    disputing = false,
    onBusyChange,
    refreshKey = 0,
}: ServiceTermSectionProps) {
    const { addToast } = useToast();

    const [loading, setLoading] = useState(true);
    const [term, setTerm] = useState<ServiceTerm | null>(null);
    // C-TERM-FETCH-FAIL: true = a última leitura falhou (rede/RLS/erro). Distinto de
    // "sem termo" (term=null && !fetchFailed) — falha bloqueia, ausência legítima não.
    const [fetchFailed, setFetchFailed] = useState(false);
    const [accepting, setAccepting] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [lastOutcome, setLastOutcome] = useState<ServiceTermAcceptOutcome | null>(null);
    const [showFullText, setShowFullText] = useState(false);
    // C-TERM-CONSENT: checkbox "Li e concordo com os termos acima" — pré-condição
    // SOMADA ao gate de leitura, nunca substituta.
    const [agreedToTerm, setAgreedToTerm] = useState(false);
    // Caso legado SEM termo: a confirmacao bilateral e irreversivel e disparava em UM toque.
    // O checkbox e a mesma friccao deliberada do caminho com termo (N5) — nunca confirmar sem gesto explicito.
    const [confirmoRecebimento, setConfirmoRecebimento] = useState(false);

    const fetchTerm = async (): Promise<void> => {
        const result = await ServiceTermService.getByShiftPayment(shiftPaymentId);
        setTerm(result.term);
        setFetchFailed(result.failed);
    };

    useEffect(() => {
        let active = true;
        const load = async () => {
            setLoading(true);
            const result = await ServiceTermService.getByShiftPayment(shiftPaymentId);
            if (active) {
                setTerm(result.term);
                setFetchFailed(result.failed);
                setLoading(false);
            }
        };
        if (shiftPaymentId) {
            load();
        } else {
            setLoading(false);
        }
        return () => {
            active = false;
        };
    }, [shiftPaymentId]);

    const busy = isWorkerViewer && (
        accepting || confirming
        || (!!term && !term.accepted_at && (showFullText || agreedToTerm))
        || (!workerConfirmedAt && confirmoRecebimento)
    );
    useEffect(() => {
        if (!busy) return;
        onBusyChange?.(true);
        return () => onBusyChange?.(false);
    }, [busy, onBusyChange]);

    const busyRef = useRef(busy);
    useEffect(() => {
        busyRef.current = busy;
    });
    useEffect(() => {
        if (!refreshKey || !shiftPaymentId) return;
        let active = true;
        void ServiceTermService.getByShiftPayment(shiftPaymentId).then((result) => {
            if (!active || result.failed || busyRef.current) return;
            setTerm(result.term);
            setFetchFailed(false);
        });
        return () => { active = false; };
    }, [refreshKey, shiftPaymentId]);

    const handleRetryFetch = async () => {
        setLoading(true);
        await fetchTerm();
        setLoading(false);
    };

    const isAccepted = !!term?.accepted_at;
    // Gate de leitura (achado ALTO — 18/08/2026): sem termo, ou já aceito, nada a ler.
    // Com termo pendente, é pré-condição de QUALQUER ação de assinatura/confirmação.
    const mustReadTerm = !!term && !isAccepted;

    /** Aceite isolado — só usado no caminho de resgate (recebimento já confirmado, termo
     * ainda pendente: estado legado/anômalo que a confirmação combinada não alcança mais). */
    const handleAcceptOnly = async () => {
        if (!term) return;
        setAccepting(true);
        try {
            const result = await ServiceTermService.acceptServiceTerm(term.id);
            setLastOutcome(result.outcome);
            if (result.outcome === 'accepted' || result.outcome === 'already_accepted') {
                addToast('Termo aceito!', 'success');
                await fetchTerm();
            } else {
                addToast(result.error || 'Não foi possível registrar o aceite do termo.', 'error');
            }
        } catch (error) {
            logError('ServiceTermSection: handleAcceptOnly', error);
            addToast('Erro ao registrar o aceite do termo.', 'error');
        } finally {
            setAccepting(false);
        }
    };

    /** R8/A2/A3: confirmar recebimento SEM termo aceito não é permitido. Aceita primeiro
     * (idempotente — `already_accepted` é sucesso), aborta em `missing_cpf`/`payment_voided`
     * sem gravar `worker_confirmed_at`, e só então confirma. */
    const handleConfirmReceipt = async () => {
        if (!shiftPaymentId) return;
        setConfirming(true);
        try {
            if (term && !term.accepted_at) {
                const acceptResult = await ServiceTermService.acceptServiceTerm(term.id);
                setLastOutcome(acceptResult.outcome);

                if (acceptResult.outcome !== 'accepted' && acceptResult.outcome !== 'already_accepted') {
                    addToast(acceptResult.error || 'Não foi possível registrar o aceite do termo.', 'error');
                    return; // aborta: nunca confirma recebimento sem o termo aceito
                }

                // Pega o term_text CONGELADO (re-renderizado no aceite, com o CPF vigente) —
                // nunca monta isso no client.
                await fetchTerm();
            }

            const result = await PaymentRecordService.confirmReceiptByWorker(shiftPaymentId);
            if (!result.success) {
                addToast(result.error || 'Não foi possível confirmar o recebimento.', 'error');
                return;
            }
            addToast('Recebimento confirmado!', 'success');
            onConfirmed();
        } catch (error) {
            logError('ServiceTermSection: handleConfirmReceipt', error);
            addToast('Erro ao confirmar recebimento.', 'error');
        } finally {
            setConfirming(false);
        }
    };

    if (loading) {
        return (
            <div className="border-t border-gray-200 pt-4 mb-4 print:hidden animate-pulse space-y-3" role="status"><span className="sr-only">Carregando</span>
                <div className="h-4 w-40 bg-gray-200 rounded-xl" />
                <div className="h-24 bg-gray-200 rounded-xl" />
            </div>
        );
    }

    return (
        <>
            {/* Termo — se não existe (pagamento ainda não gerou um, ou RLS não devolveu nada),
                este bloco não renderiza. A9/A8: nada a exibir, sem quebrar o recibo. */}
            {term && (
                <div className="border-t border-gray-200 pt-4 mb-4 print:border-t-2 print:border-black">
                    <span className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-2">
                        <FileText size={16} aria-hidden="true" /> Termo de Prestação de Serviço
                    </span>

                    {/* Documento — tipografia legível, não um parágrafo espremido.
                        RECORTE (achado ALTO do frontend-reviewer, 18/08/2026): max-h-40 (160px)
                        cortava o texto ANTES da cláusula 2 (recolhimento tributário — a razão de
                        a feature existir). max-h-72 (288px) cobre preâmbulo + PRESTADOR/CONTRATANTE/
                        SERVIÇO + cláusulas 1 e 2 na maioria das larguras; a cláusula 4 (fronteira
                        jurídica) segue reforçada FORA do recorte, no aviso amarelo do rodapé
                        (sempre visível). O recorte maior é só UX — a garantia real é o gate abaixo.
                        `print:max-h-none` (N7, achado do evaluator): a impressão nunca trunca —
                        documento impresso tem que sair inteiro, aberto ou não na tela. */}
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 md:p-5 mb-3">
                        {/* Aberto, o termo rola dentro da própria caixa: o aceite e o botão ficam logo abaixo. */}
                        <p
                            tabIndex={showFullText && !isAccepted ? 0 : undefined}
                            data-copilot-private
                            className={`whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-relaxed text-gray-800 print:max-h-none print:overflow-visible ${
                                isAccepted ? '' : showFullText ? 'max-h-[45vh] overflow-y-auto' : 'max-h-24 overflow-hidden'
                            }`}
                        >
                            {formatCpfForDisplay(term.term_text)}
                        </p>
                        {!isAccepted && (
                            <Button
                                variant="ghost"
                                onClick={() => setShowFullText((v) => !v)}
                                className="print:hidden mt-2 -ml-3"
                            >
                                {showFullText ? (
                                    <>Recolher <ChevronUp size={14} /></>
                                ) : (
                                    <>Ler o termo inteiro <ChevronDown size={14} /></>
                                )}
                            </Button>
                        )}
                    </div>

                    {isAccepted ? (
                        <div className="flex items-center gap-2 bg-primary-light text-primary-ink font-semibold text-sm px-4 py-3 rounded-xl w-fit">
                            <CheckCircle2 size={18} aria-hidden="true" />
                            Termo aceito em{' '}
                            {format(new Date(term.accepted_at as string), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                        </div>
                    ) : isWorkerViewer ? (
                        <div className="print:hidden space-y-3">
                            {/* C-TERM-CONSENT (achado ALTO, terceira iteração): checkbox de
                                consentimento AFIRMATIVO — soma-se ao gate de leitura
                                (`showFullText`), nunca o substitui. Ler o termo e concordar com
                                ele são coisas diferentes; R7/R8 do spec pedem os dois. */}
                            <label className="flex items-start gap-3 min-h-11 py-1 font-semibold text-sm cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={agreedToTerm}
                                    onChange={(e) => setAgreedToTerm(e.target.checked)}
                                    disabled={!showFullText}
                                    aria-label="Li e concordo com os termos acima"
                                    className="mt-0.5 w-5 h-5 rounded accent-primary-dark flex-shrink-0"
                                />
                                Li e concordo com os termos acima
                            </label>

                            {/* Caminho de resgate: só aparece se o recebimento JÁ foi confirmado
                                (estado legado/anômalo — o fluxo normal aceita dentro de
                                "Confirmar Recebimento", abaixo) e o termo segue pendente. */}
                            {workerConfirmedAt && (
                                <>
                                    <Button
                                        size="lg"
                                        onClick={handleAcceptOnly}
                                        loading={accepting}
                                        disabled={!showFullText || !agreedToTerm}
                                        aria-label="Aceitar o termo de prestação de serviço"
                                        className="w-full sm:w-auto"
                                    >
                                        {accepting ? 'Registrando aceite...' : 'Aceitar termo'}
                                    </Button>
                                    {!showFullText ? (
                                        <p className="text-xs text-gray-600">
                                            Abra "Ler o termo inteiro" acima para poder aceitar.
                                        </p>
                                    ) : !agreedToTerm ? (
                                        <p className="text-xs text-gray-600">
                                            Marque "Li e concordo com os termos acima" para poder aceitar.
                                        </p>
                                    ) : null}
                                </>
                            )}

                            {/* Aviso PROATIVO (Nielsen #5): o rascunho do termo ja diz "CPF: nao
                                informado" — avisar so no toast, depois do clique, era deixar a pessoa
                                ler tudo, marcar o checkbox e falhar. O botao NAO e desabilitado no
                                client: a autoridade sobre "pode assinar?" segue sendo a RPC (o CPF
                                pode ter acabado de ser cadastrado em outra aba). */}
                            {(lastOutcome === 'missing_cpf' || (!term.accepted_at && lastOutcome === null && term.term_text.includes('CPF: não informado'))) && (
                                <div className="bg-status-warning-bg border border-status-warning-line rounded-xl p-4 flex items-start gap-3">
                                    <AlertTriangle size={18} className="text-yellow-700 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-bold text-yellow-800 text-sm">
                                            Seu cadastro está sem um CPF válido — por isso não é possível assinar
                                            este termo agora.
                                        </p>
                                        <p className="text-yellow-800 text-xs font-medium mt-1">
                                            Cadastre o seu em{' '}
                                            <Link to="/profile?editar=cpf" className="underline font-bold">
                                                Perfil
                                            </Link>{' '}
                                            e volte aqui para assinar.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : isCompanyViewer ? (
                        <p className="text-sm font-semibold text-gray-600 bg-gray-100 px-4 py-3 rounded-xl w-fit">
                            Aguardando aceite do termo pelo freela
                        </p>
                    ) : (
                        // N5 (achado MÉDIO do evaluator): não replicar a ancoragem SIMPLES de
                        // `isCompanyViewer` como condição de exclusão. A RLS de `service_terms` já
                        // usa `is_company_owner` (ancoragem DUPLA) para decidir quem vê a linha —
                        // se o termo chegou até aqui e o viewer não é o freela, é porque a RLS já
                        // autorizou alguém do lado da empresa (ainda que `isCompanyViewer`, ancorada
                        // só em `companies.owner_id`, não reconheça essa pessoa). Mostrar a mesma
                        // mensagem, sem depender da checagem simples.
                        <p className="text-sm font-semibold text-gray-600 bg-gray-100 px-4 py-3 rounded-xl w-fit">
                            Aguardando aceite do termo pelo freela
                        </p>
                    )}

                    {/* Indícios best-effort do aceite — NUNCA "verificado"/"comprovado" (falsificáveis, ver ADR). */}
                    {isAccepted && (term.accepted_ip || term.accepted_user_agent) && (
                        <details className="mt-2 print:hidden">
                            <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-semibold text-gray-600">
                                Detalhes técnicos do aceite
                            </summary>
                            <p data-copilot-private className="text-xs text-gray-600 [overflow-wrap:anywhere]">
                                Indícios do aceite (não são prova): {term.accepted_ip ? `IP ${term.accepted_ip}` : ''}
                                {term.accepted_ip && term.accepted_user_agent ? ' · ' : ''}
                                {term.accepted_user_agent ? `Dispositivo: ${term.accepted_user_agent}` : ''}
                            </p>
                        </details>
                    )}

                </div>
            )}

            {/* C-TERM-FETCH-FAIL (achado ALTO, terceira iteração): a leitura do termo falhou
                (rede/RLS/erro) — não sabemos se há um termo pendente. Falhar fechado: bloqueia
                a confirmação de recebimento até o freela tentar de novo com sucesso, em vez de
                degradar silenciosamente para "sem termo" (que reabriria o BLOCKER fechado). */}
            {fetchFailed && (
                <div className="border-t border-gray-200 pt-4 mb-4 print:hidden">
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                        <AlertTriangle size={18} className="text-red-700 flex-shrink-0 mt-0.5" />
                        <div className="space-y-2">
                            <p className="font-bold text-red-800 text-sm">
                                Não foi possível verificar o termo de prestação de serviço deste pagamento.
                                Por segurança, a confirmação de recebimento fica bloqueada até
                                conseguirmos checar.
                            </p>
                            <Button
                                variant="secondary"
                                onClick={handleRetryFetch}
                                iconLeft={<RefreshCw size={14} />}
                            >
                                Tentar de novo
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirmação bilateral do freela — R8/A2/A3: se há termo pendente, o clique
                aceita o termo ANTES de confirmar (gate de leitura é pré-condição). Movida
                para dentro deste componente (era irmã, embaixo do termo, na página — ordem
                que deixava o botão de confirmar disponível e desacoplado do termo). */}
            <div className="border-t border-gray-200 pt-4 mb-4">
                <span className="block text-sm font-semibold text-gray-900 mb-2">Confirmação de recebimento</span>
                {workerConfirmedAt ? (
                    <div className="flex items-center gap-2 bg-primary-light text-primary-ink font-semibold text-sm px-4 py-3 rounded-xl w-fit">
                        <CheckCircle size={18} aria-hidden="true" />
                        Recebimento confirmado em {format(new Date(workerConfirmedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    </div>
                ) : isWorkerViewer ? (
                    <div className="print:hidden space-y-2">
                        {!mustReadTerm && (
                            <label className="flex items-start gap-2 min-h-11 py-1 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={confirmoRecebimento}
                                    onChange={(e) => setConfirmoRecebimento(e.target.checked)}
                                    className="mt-0.5 h-5 w-5 accent-primary-dark"
                                />
                                <span className="text-sm font-semibold text-gray-700">
                                    Confirmo que recebi este valor. Esta confirmação não pode ser desfeita.
                                </span>
                            </label>
                        )}
                        {amountMissing && (
                            <Alert tone="warning" title="Valor não informado">
                                Não dá para confirmar um recebimento sem valor. Fale com a empresa pelo botão abaixo.
                            </Alert>
                        )}
                        {mustReadTerm && !amountMissing && (
                            <p className="text-xs text-gray-600">Esta confirmação não pode ser desfeita.</p>
                        )}
                        <Button
                            size="lg"
                            data-copilot="freela.recibo.confirmar"
                            data-copilot-risk="D"
                            onClick={handleConfirmReceipt}
                            loading={confirming}
                            disabled={
                                amountMissing ||
                                fetchFailed ||
                                (mustReadTerm && (!showFullText || !agreedToTerm)) ||
                                (!mustReadTerm && !confirmoRecebimento)
                            }
                            className="w-full sm:w-auto"
                        >
                            {confirming
                                ? 'Confirmando...'
                                : mustReadTerm
                                    ? 'Aceitar termo e confirmar recebimento'
                                    : 'Confirmar recebimento'}
                        </Button>
                        {amountMissing ? null : mustReadTerm && !showFullText ? (
                            <p className="text-xs text-gray-600">
                                Abra "Ler o termo inteiro" acima antes de confirmar o recebimento.
                            </p>
                        ) : mustReadTerm && !agreedToTerm ? (
                            <p className="text-xs text-gray-600">
                                Marque "Li e concordo com os termos acima" antes de confirmar o recebimento.
                            </p>
                        ) : null}
                        {onDispute && (
                            <Button
                                variant="secondary"
                                size="lg"
                                data-copilot="freela.recibo.nao-recebi"
                                onClick={onDispute}
                                loading={disputing}
                                iconLeft={<MessageCircle size={18} />}
                                className="w-full sm:w-auto sm:ml-3"
                            >
                                Não recebi / valor errado
                            </Button>
                        )}
                    </div>
                ) : isCompanyViewer ? (
                    <p className="text-sm font-semibold text-gray-600 bg-gray-100 px-4 py-3 rounded-xl w-fit">
                        Aguardando confirmação do freela
                    </p>
                ) : null}
            </div>
            {term && (
                <>
                    {/* Fronteira jurídica — a cláusula equivalente já está DENTRO de term_text (item 4),
                        mas o aviso na UI é reforço, não substituto (A6). Não usar palavras como
                        "validado"/"verificado pela Worki"/"documento oficial". */}
                    <div className="mb-4 rounded-xl bg-gray-100 px-3 py-2">
                        <p className="text-xs font-semibold text-gray-700">
                            O Worki apenas registra o aceite entre as partes — não é parte deste termo, não valida
                            e não garante sua validade jurídica.
                        </p>
                    </div>
                </>
            )}
        </>
    );
}
