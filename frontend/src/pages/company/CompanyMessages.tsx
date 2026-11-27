import { useEffect, useMemo, useState, useRef } from 'react';
import ChatComposerField from '../../components/ChatComposerField';
import { supabase } from '../../lib/supabase';
import { MessageSquare, Send, ArrowLeft, User, Check, CheckCheck, Briefcase } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useToast } from '../../contexts/ToastContext';
import { useCurrentCompanyState } from '../../hooks/useCurrentCompany';
import { groupByWorker, isHiddenEmptyConversation } from '../../lib/messageGroups';
import { logError } from '../../lib/logger'
import { fillMissingWorkers } from '../../services/workerCardsService';
import { Button, PageHeader } from '../../components/ui'
import ErroDeCarga from '../../components/ErroDeCarga'
import { checkSession } from '../../lib/authSession'
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { useLatestResponse } from '../../hooks/useLatestResponse';
import { conversationListSources } from '../../lib/realtime/liveSources';
import { mergeMessages } from '../../lib/mergeMessages';
import { activeShiftLabel, type ShiftAttendanceLike } from '../../lib/shiftProgress'
import { TONE_CLASS, getStatus, statusLabel } from '../../lib/statusLabels';

interface ConversationItem {
    id: string;
    application_uuid: string;
    /** Freela da conversa: as não lidas e o "lida" valem só para as mensagens dele. */
    worker_id: string | null;
    worker_name: string;
    worker_avatar?: string;
    job_title: string;
    job_status?: string;
    last_message?: string;
    last_message_at?: string;
    /** Prévia confiável ausente: a conversa não tem mensagem alguma. */
    no_messages?: boolean;
    unread_count: number;
    status: string;
    attendance?: ShiftAttendanceLike;
}

/** Teto da consulta de prévias: acima disso, ausência de prévia não prova conversa vazia. */
const PREVIEW_LIMIT = 500;

/** Não lidas primeiro; depois a atividade mais recente. */
const sortConversations = (list: ConversationItem[]): ConversationItem[] =>
    [...list].sort((a, b) =>
        Number(b.unread_count > 0) - Number(a.unread_count > 0)
        || new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime());

/** Quem falou, na prévia: eu, um colega do lado da empresa, ou o freela (sem prefixo). */
const previewPrefix = (senderid: string, workerId: string | null, me: string | null): string => {
    if (senderid === me) return 'Você: ';
    if (workerId && senderid !== workerId) return 'Equipe: ';
    return '';
};

const formatWhen =(iso: string): string => {
    const date = new Date(iso);
    return format(date, date.toDateString() === new Date().toDateString() ? 'HH:mm' : 'dd/MM');
};

interface Message {
    id: string;
    content: string;
    senderid: string;
    createdat: string;
    is_mine: boolean;
    /** Preenchido quando a contraparte abriu a conversa. Vira o duplo-check. */
    read_at: string | null;
}

export default function CompanyMessages() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const selectedConversationId = searchParams.get('conversation');

    const [loading, setLoading] = useState(true);
    const [conversations, setConversations] = useState<ConversationItem[]>([]);
    const [messages, setMessages] = useState<Message[]>([]);
    // De qual conversa o histórico já chegou: antes disso é "carregando", não "vazio".
    const [messagesFor, setMessagesFor] = useState<string | null>(null);
    const [currentUser, setCurrentUser] = useState<string | null>(null);
    const [selectedConversation, setSelectedConversation] = useState<ConversationItem | null>(null);
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);
    // Trava do envio por ref: o campo NÃO é desabilitado (desabilitar fecha o teclado no celular).
    const sendingRef = useRef(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const { addToast } = useToast();
    // Empresa corrente pelo seam (Gestor e Encarregado); a RLS já escopa pelo turno, o filtro é só a unidade.
    const { company, resolved: companyResolved, error: companyError } = useCurrentCompanyState();
    const companyId = company?.company_id ?? null;

    const logRef = useRef<HTMLDivElement>(null);
    // Conversa aberta agora: o envio é assíncrono e o eco não pode cair em outra conversa.
    const openConversationRef = useRef<string | null>(null);
    openConversationRef.current = selectedConversation?.id ?? null;
    const openWorkerRef = useRef<string | null>(null);
    openWorkerRef.current = selectedConversation?.worker_id ?? null;
    const presenceChannel = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isOtherTyping, setIsOtherTyping] = useState(false);

    const [refreshTrigger, setRefreshTrigger] = useState(0);
    // Falha de carga ≠ "nenhuma conversa".
    const [erroCarga, setErroCarga] = useState(false);
    // Falha ao abrir a conversa ≠ "nenhuma mensagem".
    const [erroMensagens, setErroMensagens] = useState(false);
    const [messagesAttempt, setMessagesAttempt] = useState(0);

    const updatePreview = (conversationId: string, content: string, at: string, senderid: string) => {
        setConversations(prev => sortConversations(prev.map(c => c.id === conversationId
            ? { ...c, last_message: `${previewPrefix(senderid, c.worker_id, currentUser)}${content}`, last_message_at: at, no_messages: false }
            : c)));
    };

    // Quem subiu para ler o histórico não é puxado para o fim quando chega algo.
    const stickToEndRef = useRef(true);
    // Scroll to bottom when messages change
    useEffect(() => {
        const log = logRef.current;
        if (log && (stickToEndRef.current || messages[messages.length - 1]?.is_mine)) log.scrollTop = log.scrollHeight;
    }, [messages]);

    const openId = selectedConversation?.id ?? null;
    useEffect(() => {
        stickToEndRef.current = true;
    }, [openId]);

    const beginList = useLatestResponse();

    const falharCarga = (contexto: string, causa: unknown) => {
        logError(contexto, causa);
        setErroCarga(true);
        setLoading(false);
    };

    // `silent` = recarga ao vivo: falha mantém a tela e a conversa não é reescolhida pela URL.
    const loadData = async (silent = false) => {
        try {
            await loadDataUnsafe(silent);
        } catch (err) {
            // Exceção fora dos ramos tratados: o spinner nunca fica preso.
            if (silent) logError('CompanyMessages.loadData', err);
            else falharCarga('CompanyMessages.loadData', err);
        }
    };

    const loadDataUnsafe = async (silent: boolean) => {
        const claim = beginList();
        const falhar = (contexto: string, causa: unknown) =>
            silent ? logError(contexto, causa) : falharCarga(contexto, causa);
        const session = await checkSession();
        if (session.status === 'signed_out') return silent ? undefined : navigate('/login');
        if (session.status === 'unavailable') return falhar('CompanyMessages.session', session.error);
        const user = session.user;
        setCurrentUser(user.id);

        // Falha ao resolver a empresa corrente não é "nenhuma conversa".
        if (companyError) return falhar('CompanyMessages.companies', new Error('company_scope'));

        // Fetch conversations using EXPLICIT Foreign Key names to avoid ambiguity
        const { data: convData, error } = await supabase
            .from('Conversation')
            .select(`
                id,
                application_uuid,
                createdat,
                islocked,
                application:applications!fk_conversation_application_uuid (
                    id,
                    worker_id,
                    status,
                    worker_checkin_at,
                    company_checkin_confirmed_at,
                    company_checkout_confirmed_at,
                    worker:workers (
                        id,
                        full_name,
                        avatar_url
                    ),
                    job:jobs!applications_job_id_fkey (
                        id,
                        title,
                        status,
                        company_id
                    )
                )
            `)
            .order('createdat', { ascending: false });

        if (error) return falhar('SUPABASE ERROR fetching conversations:', error);
        if (!silent) setErroCarga(false);

        // A RLS decide o que cada pessoa lê (Gestor: tudo; Encarregado: só os turnos que opera);
        // aqui só se restringe à unidade corrente.
        interface ConversationData {
            id: string;
            application_uuid: string;
            createdat: string;
            islocked: boolean;
            application?: {
                id: string;
                worker_id?: string;
                status: string;
                worker_checkin_at?: string | null;
                company_checkin_confirmed_at?: string | null;
                company_checkout_confirmed_at?: string | null;
                worker?: {
                    id: string;
                    full_name: string;
                    avatar_url?: string;
                };
                job?: {
                    id: string;
                    title: string;
                    status?: string;
                    company_id: string;
                };
            };
        }

        const ownConversations = ((convData || []) as unknown as ConversationData[]).filter((c) => {
            if (!c.application || !c.application.job) {
                return false; // Skip malformed data
            }

            return c.application.job.company_id === companyId;
        });

        // Encarregado: o embed `workers` volta `null`; os cartões das RPCs dão o nome.
        const filledApps = await fillMissingWorkers(ownConversations.map((c) => c.application!));
        const myConversations = ownConversations.map((c, i) => ({ ...c, application: filledApps[i] }));

        // Fetch all unread messages for these conversations
        const conversationIds = myConversations.map((c) => c.id);
        const unreadCounts: Record<string, number> = {};

        if (conversationIds.length > 0) {
            const { data: unreadData, error: unreadError } = await supabase
                .from('Message')
                .select('conversationid, senderid')
                .in('conversationid', conversationIds)
                .is('read_at', null);

            if (unreadError) return falhar('CompanyMessages.unread', unreadError);

            // Só conta o que o FREELA escreveu: mensagem de colega da empresa não é "não lida" para ninguém.
            const workerOf = new Map(myConversations.map((c) => [c.id, c.application?.worker_id ?? c.application?.worker?.id ?? null]));
            for (const row of (unreadData ?? []) as Array<{ conversationid: string; senderid: string }>) {
                const workerId = workerOf.get(row.conversationid);
                if (workerId && row.senderid === workerId) unreadCounts[row.conversationid] = (unreadCounts[row.conversationid] || 0) + 1;
            }
        }

        // Prévia: as mensagens mais recentes destas conversas (só leitura, mesma tabela).
        const latest = new Map<string, { content: string; senderid: string; createdat: string }>();
        let previewsComplete = false;
        if (conversationIds.length > 0) {
            const { data: previewData, error: previewError } = await supabase
                .from('Message')
                .select('conversationid, content, senderid, createdat')
                .in('conversationid', conversationIds)
                .order('createdat', { ascending: false })
                .limit(PREVIEW_LIMIT);
            if (previewError) return falhar('CompanyMessages.preview', previewError);
            const rows = (previewData ?? []) as Array<{ conversationid: string; content: string; senderid: string; createdat: string }>;
            previewsComplete = rows.length < PREVIEW_LIMIT;
            for (const row of rows) {
                if (!latest.has(row.conversationid)) latest.set(row.conversationid, row);
            }
        }

        const openNow = openConversationRef.current;
        const convList: ConversationItem[] = myConversations.map((c) => {
            const workerId = c.application?.worker_id ?? c.application?.worker?.id ?? null;
            const last = latest.get(c.id);
            return {
                id: c.id,
                application_uuid: c.application_uuid,
                worker_id: workerId,
                worker_name: c.application?.worker?.full_name || 'Freela',
                worker_avatar: c.application?.worker?.avatar_url,
                job_title: c.application?.job?.title || 'Turno sem título',
                job_status: c.application?.job?.status,
                status: c.application?.status || 'pending',
                attendance: c.application,
                last_message: last ? `${previewPrefix(last.senderid, workerId, user.id)}${last.content}` : undefined,
                last_message_at: last?.createdat ?? c.createdat,
                no_messages: previewsComplete && !last,
                unread_count: unreadCounts[c.id] || 0,
            };
        }).filter((c) =>
            // Cancelada/apagada sem mensagem é ruído; a que está aberta ou foi pedida pela URL nunca some.
            c.id === selectedConversationId || c.id === openNow || !isHiddenEmptyConversation({
                applicationStatus: c.status,
                jobStatus: c.job_status,
                hasMessages: !c.no_messages,
                previewsComplete,
            }));

        if (!claim()) return;

        if (silent) {
            const open = openConversationRef.current;
            setErroCarga(false);
            setConversations(sortConversations(convList.map(c => (c.id === open ? { ...c, unread_count: 0 } : c))));
            setSelectedConversation(prev => (prev ? convList.find(c => c.id === prev.id) ?? prev : prev));
            return;
        }

        setConversations(sortConversations(convList));

        if (selectedConversationId) {
            const conv = convList.find(c => c.id === selectedConversationId);
            if (conv) {
                setSelectedConversation(conv);
                markAsRead(conv.id, conv.worker_id);
            }
        }

        setLoading(false);
    };

    // Marca como lida só a mensagem DO FREELA: o que um colega da empresa escreveu não é "lido" por quem abre.
    const markAsRead = async (conversationId: string, workerId: string | null) => {
        // Optimistic update
        setConversations(prev => prev.map(c =>
            c.id === conversationId ? { ...c, unread_count: 0 } : c
        ));
        if (!workerId) return;

        // read_at é baixo risco de UX (sem toast), mas merece log — não é hipotético:
        // `Message` já teve RLS ligada sem policy de UPDATE nesta revisão (patterns.md).
        const { error } = await supabase
            .from('Message')
            .update({ read_at: new Date().toISOString() })
            .eq('conversationid', conversationId)
            .eq('senderid', workerId)
            .is('read_at', null)
            .select('id');
        if (error) {
            logError('CompanyMessages.markAsRead', error);
        }
    };

    // Load data on mount and refresh
    useEffect(() => {
        if (!companyResolved) return;
        void loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- loadData usa state setters estaveis, deps cobrem triggers de refresh
    }, [navigate, selectedConversationId, refreshTrigger, companyResolved, companyId, companyError]);

    // Recupera o que o canal da conversa aberta possa ter perdido, mesclando por id.
    const recoverMessages = async () => {
        if (!openId || !currentUser || messagesFor !== openId) return;
        const { data, error } = await supabase
            .from('Message')
            .select('*')
            .eq('conversationid', openId)
            .order('createdat', { ascending: true });
        if (error) {
            logError('CompanyMessages.recover', error);
            return;
        }
        if (openConversationRef.current !== openId) return;
        const rows = ((data || []) as Omit<Message, 'is_mine'>[]).map(m => ({ ...m, is_mine: m.senderid === currentUser }));
        setMessages(prev => mergeMessages(prev, rows));
        if (rows.some(m => m.senderid === openWorkerRef.current && !m.read_at)) void markAsRead(openId, openWorkerRef.current);
    };

    useLiveRefresh({
        sources: conversationListSources(),
        onRefresh: () => Promise.all([loadData(true), recoverMessages()]),
        paused: loading,
    });

    useEffect(() => {
        if (!openId) return;

        setErroMensagens(false);
        setMessages([]);
        setMessagesFor(null);

        const loadMessages = async () => {
            const { data, error } = await supabase
                .from('Message')
                .select('*')
                .eq('conversationid', openId)
                .order('createdat', { ascending: true });

            if (error) {
                logError('Error fetching messages:', error);
                setErroMensagens(true);
                return;
            }

            setMessages((data || []).map(m => ({
                ...m,
                is_mine: m.senderid === currentUser
            })));
            setMessagesFor(openId);

            // Mark as read when opening
            markAsRead(openId, openWorkerRef.current);
        };

        loadMessages();

        const channel = supabase
            .channel(`company-messages:${openId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'Message',
                filter: `conversationid=eq.${openId}`
            }, (payload) => {
                const newMsg = payload.new as { id: string; content: string; senderid: string; createdat: string; read_at: string | null };
                const isMine = newMsg.senderid === currentUser;
                updatePreview(openId, newMsg.content, newMsg.createdat, newMsg.senderid);

                setMessages(prev => prev.some(m => m.id === newMsg.id)
                    ? prev
                    : [...prev, { ...newMsg, is_mine: isMine }]);

                // Se estou vendo e foi o freela quem escreveu, marca como lida na hora
                if (openWorkerRef.current && newMsg.senderid === openWorkerRef.current) {
                    markAsRead(openId, openWorkerRef.current);
                }
            })
            .subscribe();

        // Presence channel for typing indicator
        const pChannel = supabase.channel(`typing:${openId}`)
        pChannel
            .on('presence', { event: 'sync' }, () => {
                const state = pChannel.presenceState();
                setIsOtherTyping(
                    Object.values(state).some(presences =>
                        presences.some(p => {
                            const pTyped = p as { typing?: boolean; userId?: string };
                            return pTyped.typing === true && pTyped.userId !== currentUser;
                        })
                    )
                );
            })
            .subscribe();
        presenceChannel.current = pChannel;

        return () => {
            supabase.removeChannel(channel);
            pChannel.unsubscribe();
        };
        // Pelo id: reler a lista troca o objeto da conversa sem recarregar (nem piscar) o histórico.
    }, [openId, currentUser, messagesAttempt]);

    const handleSendMessage = async () => {
        if (sendingRef.current || !newMessage.trim() || !selectedConversation || !currentUser) return;

        sendingRef.current = true;
        setSending(true);
        const messageContent = newMessage.trim();
        setNewMessage('');

        // Stop typing indicator before sending
        presenceChannel.current?.track({ typing: false, userId: currentUser });
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

        const sent = {
            id: crypto.randomUUID(),
            conversationid: selectedConversation.id,
            senderid: currentUser,
            content: messageContent,
            createdat: new Date().toISOString()
        };
        const { error } = await supabase
            .from('Message')
            .insert(sent);

        // Eco imediato (como em Messages.tsx): com o Realtime fora, a mensagem não aparecia para
        // quem enviou. O id nasce no client, então o evento do Realtime não duplica.
        if (!error && openConversationRef.current === sent.conversationid) {
            setMessages(prev => prev.some(m => m.id === sent.id)
                ? prev
                : [...prev, { ...sent, read_at: null, is_mine: true }]);
        }

        if (!error) updatePreview(sent.conversationid, sent.content, sent.createdat, sent.senderid);

        if (error) {
            logError('Error sending message:', error);
            // Devolve o texto sem apagar o que foi digitado enquanto enviava.
            setNewMessage((atual) => (atual ? `${messageContent} ${atual}` : messageContent));
            addToast('Erro ao enviar mensagem. Tente novamente.', 'error');
        }

        sendingRef.current = false;
        setSending(false);
    };

    const handleSelectConversation = (conv: ConversationItem) => {
        setSelectedConversation(conv);
        navigate(`/company/messages?conversation=${conv.id}`, { replace: true });
    };

    // Uma linha por freela; o turno é escolhido dentro da conversa (ADR-20261127).
    const groups = useMemo(() => groupByWorker(conversations), [conversations]);
    const selectedGroup = selectedConversation
        ? groups.find(g => g.conversations.some(c => c.id === selectedConversation.id)) ?? null
        : null;

    const getStatusColor = (status: string) => TONE_CLASS[getStatus('application', status).tone];

    const getStatusLabel = (status: string, attendance?: ShiftAttendanceLike) =>
        (attendance ? activeShiftLabel(attendance) : null) ?? statusLabel('application', status);

    if (loading) {
        return (
            <div className="worki-chat flex flex-col max-w-6xl mx-auto animate-pulse" role="status"><span className="sr-only">Carregando</span>
                <div className="h-10 bg-gray-200 rounded-xl w-1/4 mb-4" />
                <div className="flex-1 min-h-0 overflow-hidden grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4">
                    <div className="space-y-3">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="h-16 bg-gray-200 rounded-xl" />
                        ))}
                    </div>
                    <div className="bg-gray-200 rounded-2xl" />
                </div>
            </div>
        );
    }

    return (
        <div className="worki-chat flex flex-col font-sans text-accent max-w-6xl mx-auto">
            <PageHeader
                title="Mensagens"
                subtitle="Converse com os freelas dos seus turnos."
                className={selectedConversation ? '!mb-4 max-md:sr-only' : '!mb-4'}
            />

            <div className="flex-1 flex min-h-0 bg-white border-2 border-black rounded-2xl overflow-hidden max-md:-mx-4 sm:max-md:-mx-6 max-md:rounded-none max-md:border-x-0 md:shadow-brutal">

                <div className={`w-full md:w-80 border-r-2 border-black flex flex-col ${selectedConversation ? 'hidden md:flex' : 'flex'}`}>
                    <div className="px-4 py-3 border-b-2 border-gray-100">
                        <h2 className="text-sm font-bold text-gray-700">{erroCarga ? 'Conversas' : `Conversas (${groups.length})`}</h2>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {erroCarga ? (
                            <div className="p-4">
                                <ErroDeCarga onRetry={() => {
                                    // A empresa corrente só se resolve de novo ao recarregar a sessão.
                                    if (companyError) { window.location.reload(); return; }
                                    setLoading(true);
                                    setRefreshTrigger(n => n + 1);
                                }} />
                            </div>
                        ) : conversations.length === 0 ? (
                            <div className="p-6 text-center text-gray-600">
                                <MessageSquare size={40} className="mx-auto mb-4 opacity-20" />
                                <p className="font-bold">Nenhuma conversa ainda.</p>
                                <p className="text-sm mt-2">Os freelas aparecem aqui quando você inicia uma conversa a partir de um turno.</p>
                            </div>
                        ) : (
                            groups.map(group => {
                                const conv = {
                                    ...group.latest,
                                    unread_count: group.unread_count,
                                    no_messages: group.no_messages,
                                };
                                return (
                                <button
                                    type="button"
                                    key={group.key}
                                    onClick={() => handleSelectConversation(group.latest)}
                                    className={`w-full min-h-16 p-4 text-left border-b border-gray-100 hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black ${selectedGroup?.key === group.key ? 'bg-gray-50 border-l-4 border-l-black' : ''}`}
                                >
                                    <div className="flex gap-3 items-start">
                                        <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
                                            {conv.worker_avatar ? (
                                                <img src={conv.worker_avatar} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <User size={20} className="text-gray-400" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-baseline gap-2">
                                                <h3 className="font-bold text-sm truncate">{conv.worker_name}</h3>
                                                {conv.last_message_at && !conv.no_messages && (
                                                    <span className="shrink-0 text-xs text-gray-600 tabular-nums">{formatWhen(conv.last_message_at)}</span>
                                                )}
                                            </div>
                                            <div className="flex items-center justify-between gap-2">
                                                <p data-copilot-private className={`min-w-0 truncate text-sm ${conv.unread_count > 0 ? 'font-bold text-black' : 'text-gray-600'}`}>
                                                    {conv.last_message ?? (conv.no_messages ? 'Sem mensagens ainda' : 'Abra para ver as mensagens')}
                                                </p>
                                                {conv.unread_count > 0 && (
                                                    <span className="shrink-0 text-xs font-bold px-2 py-0.5 rounded-full bg-red-600 text-white tabular-nums">
                                                        {conv.unread_count}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="mt-1 flex items-center justify-between gap-2">
                                                <p className="flex min-w-0 items-center gap-1 text-xs text-gray-600">
                                                    <Briefcase size={10} aria-hidden="true" className="shrink-0" />
                                                    <span className="truncate">
                                                        {group.conversations.length > 1 ? `${group.conversations.length} turnos` : conv.job_title}
                                                    </span>
                                                </p>
                                                {group.conversations.length === 1 && (
                                                    <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${getStatusColor(conv.status)}`}>
                                                        {getStatusLabel(conv.status, conv.attendance)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* min-w-0: a coluna precisa encolher a 320px, senão Enviar, bolha e selo saem do cartão. */}
                <div className={`flex-1 min-w-0 min-h-0 flex flex-col ${!selectedConversation ? 'hidden md:flex' : 'flex'}`}>
                    {selectedConversation ? (
                        <>
                            <div className="p-3 sm:p-4 border-b-2 border-black flex items-center gap-2 sm:gap-3">
                                <button aria-label="Voltar para a lista de conversas"
                                    onClick={() => setSelectedConversation(null)}
                                    className="md:hidden h-11 w-11 -ml-2 flex items-center justify-center shrink-0 hover:bg-gray-100 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                                >
                                    <ArrowLeft size={20} />
                                </button>
                                <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden shrink-0">
                                    {selectedConversation.worker_avatar ? (
                                        <img src={selectedConversation.worker_avatar} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <User size={20} className="text-gray-400" />
                                    )}
                                </div>
                                {/* Abaixo de `sm` o selo vai para baixo do nome: ao lado, um rótulo longo
                                    ("Saída confirmada") esmagava o nome e o título do turno. */}
                                <div className="flex-1 min-w-0 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                                    <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                                        <h4 className="font-bold truncate">{selectedConversation.worker_name}</h4>
                                        <p className="text-xs text-gray-600 flex items-center gap-1">
                                            <Briefcase size={10} className="shrink-0" />
                                            <span className="truncate">{selectedConversation.job_title}</span>
                                        </p>
                                    </div>
                                    <span className={`text-xs font-semibold px-3 py-1 rounded-full shrink-0 self-start sm:self-auto ${getStatusColor(selectedConversation.status)}`}>
                                        {getStatusLabel(selectedConversation.status, selectedConversation.attendance)}
                                    </span>
                                </div>
                            </div>

                            {selectedGroup && selectedGroup.conversations.length > 1 && (
                                <div className="px-3 sm:px-4 py-2 border-b border-gray-200 bg-white">
                                    <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                                        <span className="shrink-0">Turno</span>
                                        <select
                                            value={selectedConversation.id}
                                            onChange={(e) => {
                                                const next = selectedGroup.conversations.find(c => c.id === e.target.value);
                                                if (next) handleSelectConversation(next);
                                            }}
                                            className="min-h-11 min-w-0 flex-1 rounded-xl border-2 border-black bg-white px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                                        >
                                            {selectedGroup.conversations.map(c => (
                                                <option key={c.id} value={c.id}>
                                                    {`${c.job_title} · ${getStatusLabel(c.status, c.attendance)}${c.unread_count > 0 ? ` · ${c.unread_count === 1 ? '1 nova' : `${c.unread_count} novas`}` : ''}`}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>
                            )}

                            <div
                                ref={logRef}
                                onScroll={(e) => {
                                    const log = e.currentTarget;
                                    stickToEndRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
                                }}
                                data-copilot-private
                                role="log"
                                aria-label="Mensagens da conversa"
                                tabIndex={0}
                                className="flex-1 min-h-0 overflow-y-auto overscroll-contain motion-safe:scroll-smooth p-4 space-y-4 bg-gray-50"
                            >
                                {erroMensagens ? (
                                    <ErroDeCarga onRetry={() => setMessagesAttempt(n => n + 1)} />
                                ) : messagesFor !== selectedConversation.id ? (
                                    <p role="status" className="py-12 text-center text-sm font-semibold text-gray-600">Carregando mensagens...</p>
                                ) : messages.length === 0 ? (
                                    <div className="text-center py-12 text-gray-600">
                                        <MessageSquare size={40} className="mx-auto mb-4 opacity-20" />
                                        <p className="font-bold">Nenhuma mensagem ainda.</p>
                                        <p className="text-sm mt-2">Inicie a conversa com o freela.</p>
                                    </div>
                                ) : (
                                    messages.map(msg => {
                                        // Lado da empresa = eu OU um colega (Gestor/Encarregado); o freela fica à esquerda.
                                        const companySide = selectedConversation.worker_id ? msg.senderid !== selectedConversation.worker_id : msg.is_mine;
                                        return (
                                        <div key={msg.id} className={`flex ${companySide ? 'justify-end' : 'justify-start'} animate-slide-in`}>
                                            <div className={`max-w-[85%] sm:max-w-[75%] px-4 py-3 border-2 border-black rounded-2xl ${companySide ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white rounded-tl-none'}`}>
                                                <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                                                <div className={`flex items-center justify-end gap-1 mt-1 text-xs font-medium ${companySide ? 'text-white/90' : 'text-gray-600'}`}>
                                                    {/* O relógio saiu: ele era renderizado em TODA mensagem, para sempre. Ícone de
                                                        relógio ao lado de uma mensagem significa "pendente" em qualquer app de
                                                        conversa — aqui não significava nada, e nunca sumia.
                                                        O duplo-check também era incondicional: aparecia igual em mensagem lida e não
                                                        lida, então não comunicava leitura nenhuma. Agora segue a convenção que todo
                                                        mundo já conhece: um check = enviada, dois checks = lida. */}
                                                    {format(new Date(msg.createdat), 'HH:mm', { locale: ptBR })}
                                                    {companySide && (
                                                        msg.read_at ? (
                                                            <CheckCheck
                                                                size={12}
                                                                className="ml-1 text-sky-300"
                                                                aria-label="Lida"
                                                            />
                                                        ) : (
                                                            <Check size={12} className="ml-1 opacity-70" aria-label="Enviada" />
                                                        )
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        );
                                    })
                                )}
                            </div>

                            {/* Typing Indicator */}
                            {isOtherTyping && (
                                <div className="px-4 py-2 text-xs text-gray-600 font-semibold flex items-center gap-2">
                                    <span className="animate-bounce">•</span>
                                    <span className="animate-bounce" style={{ animationDelay: '0.1s' }}>•</span>
                                    <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>•</span>
                                    Digitando...
                                </div>
                            )}

                            <div className="shrink-0 p-2 sm:p-4 border-t-2 border-black bg-white">
                                <form
                                    className="flex items-end gap-2 sm:gap-3"
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        void handleSendMessage();
                                        inputRef.current?.focus();
                                    }}
                                >
                                    <ChatComposerField
                                        inputRef={inputRef}
                                        value={newMessage}
                                        onChange={(value) => {
                                            setNewMessage(value);
                                            if (selectedConversation && currentUser) {
                                                presenceChannel.current?.track({ typing: true, userId: currentUser });
                                                if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                                                typingTimeoutRef.current = setTimeout(() => {
                                                    presenceChannel.current?.track({ typing: false, userId: currentUser });
                                                }, 3000);
                                            }
                                        }}
                                    />
                                    <Button
                                        variant="dark"
                                        type="submit"
                                        disabled={!newMessage.trim()}
                                        loading={sending}
                                        aria-label="Enviar mensagem"
                                        data-copilot="empresa.mensagens.enviar"
                                        iconLeft={<Send size={18} />}
                                    >
                                        <span className="hidden sm:inline">Enviar</span>
                                    </Button>
                                </form>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-600">
                            <div className="text-center">
                                <MessageSquare size={48} className="mx-auto mb-4 opacity-30" />
                                <p className="font-bold text-lg text-black">Selecione uma conversa</p>
                                <p className="text-sm mt-2">Escolha um freela à esquerda para ver as mensagens.</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
