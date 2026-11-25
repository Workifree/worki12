import { useEffect, useState, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { MessageSquare, Send, ArrowLeft, User, Check, CheckCheck, Briefcase } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useToast } from '../../contexts/ToastContext';
import { getMyCompanies } from '../../services/companyScopeService';
import { logError } from '../../lib/logger'
import { fillMissingWorkers } from '../../services/workerCardsService';
import { Button, FIELD_CONTROL_CLASS, PageHeader } from '../../components/ui'
import ErroDeCarga from '../../components/ErroDeCarga'
import { checkSession } from '../../lib/authSession'
import { activeShiftLabel, type ShiftAttendanceLike } from '../../lib/shiftProgress'
import { TONE_CLASS, getStatus, statusLabel } from '../../lib/statusLabels';

interface ConversationItem {
    id: string;
    application_uuid: string;
    worker_name: string;
    worker_avatar?: string;
    job_title: string;
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

const formatWhen = (iso: string): string => {
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
    const [currentUser, setCurrentUser] = useState<string | null>(null);
    const [selectedConversation, setSelectedConversation] = useState<ConversationItem | null>(null);
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);
    // Trava do envio por ref: o campo NÃO é desabilitado (desabilitar fecha o teclado no celular).
    const sendingRef = useRef(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const { addToast } = useToast();

    const logRef = useRef<HTMLDivElement>(null);
    // Conversa aberta agora: o envio é assíncrono e o eco não pode cair em outra conversa.
    const openConversationRef = useRef<string | null>(null);
    openConversationRef.current = selectedConversation?.id ?? null;
    const presenceChannel = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isOtherTyping, setIsOtherTyping] = useState(false);

    const [refreshTrigger, setRefreshTrigger] = useState(0);
    // Falha de carga ≠ "nenhuma conversa".
    const [erroCarga, setErroCarga] = useState(false);
    // Falha ao abrir a conversa ≠ "nenhuma mensagem".
    const [erroMensagens, setErroMensagens] = useState(false);
    const [messagesAttempt, setMessagesAttempt] = useState(0);

    const updatePreview = (conversationId: string, content: string, at: string, mine: boolean) => {
        setConversations(prev => sortConversations(prev.map(c => c.id === conversationId
            ? { ...c, last_message: mine ? `Você: ${content}` : content, last_message_at: at, no_messages: false }
            : c)));
    };

    // Scroll to bottom when messages change
    useEffect(() => {
        const log = logRef.current;
        if (log) log.scrollTop = log.scrollHeight;
    }, [messages]);

    const falharCarga = (contexto: string, causa: unknown) => {
        logError(contexto, causa);
        setErroCarga(true);
        setLoading(false);
    };

    const loadData = async () => {
        const session = await checkSession();
        if (session.status === 'signed_out') return navigate('/login');
        if (session.status === 'unavailable') return falharCarga('CompanyMessages.session', session.error);
        const user = session.user;
        setCurrentUser(user.id);

        // Todas as unidades que a sessao OPERA — inclui gerente (company_members), que a
        // consulta por `owner_id` deixava de fora: ele nao via conversa nenhuma.
        let operadas: Awaited<ReturnType<typeof getMyCompanies>>;
        try {
            operadas = await getMyCompanies();
        } catch (causa) {
            return falharCarga('CompanyMessages.companies', causa);
        }
        const companyIds = new Set(operadas.map(c => c.company_id));
        companyIds.add(user.id); // dono cujo company_id E o proprio uid

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
                        company_id
                    )
                )
            `)
            .order('createdat', { ascending: false });

        if (error) return falharCarga('SUPABASE ERROR fetching conversations:', error);
        setErroCarga(false);

        // Filter to only show conversations for jobs belonging to any of the user's companies
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
                    company_id: string;
                };
            };
        }

        const ownConversations = ((convData || []) as unknown as ConversationData[]).filter((c) => {
            if (!c.application || !c.application.job) {
                return false; // Skip malformed data
            }

            const jobCorpId = c.application.job.company_id;
            return companyIds.has(jobCorpId);
        });

        // Encarregado: o embed `workers` volta `null`; os cartões das RPCs dão o nome.
        const filledApps = await fillMissingWorkers(ownConversations.map((c) => c.application!));
        const myConversations = ownConversations.map((c, i) => ({ ...c, application: filledApps[i] }));

        // Fetch all unread messages for these conversations
        const conversationIds = myConversations.map((c) => c.id);
        let unreadCounts: Record<string, number> = {};

        if (conversationIds.length > 0) {
            const { data: unreadData, error: unreadError } = await supabase
                .from('Message')
                .select('conversationid')
                .in('conversationid', conversationIds)
                .neq('senderid', user.id) // Messages sent by OTHERS (workers)
                .is('read_at', null);     // That are NOT read

            if (unreadError) return falharCarga('CompanyMessages.unread', unreadError);

            if (unreadData) {
                unreadCounts = unreadData.reduce((acc: Record<string, number>, curr) => {
                    acc[curr.conversationid] = (acc[curr.conversationid] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>);
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
            if (previewError) return falharCarga('CompanyMessages.preview', previewError);
            const rows = (previewData ?? []) as Array<{ conversationid: string; content: string; senderid: string; createdat: string }>;
            previewsComplete = rows.length < PREVIEW_LIMIT;
            for (const row of rows) {
                if (!latest.has(row.conversationid)) latest.set(row.conversationid, row);
            }
        }

        const convList: ConversationItem[] = myConversations.map((c) => ({
            id: c.id,
            application_uuid: c.application_uuid,
            worker_name: c.application?.worker?.full_name || 'Freela',
            worker_avatar: c.application?.worker?.avatar_url,
            job_title: c.application?.job?.title || 'Turno sem título',
            status: c.application?.status || 'pending',
            attendance: c.application,
            last_message: latest.has(c.id)
                ? `${latest.get(c.id)!.senderid === user.id ? 'Você: ' : ''}${latest.get(c.id)!.content}`
                : undefined,
            last_message_at: latest.get(c.id)?.createdat ?? c.createdat,
            no_messages: previewsComplete && !latest.has(c.id),
            unread_count: unreadCounts[c.id] || 0
        }));

        setConversations(sortConversations(convList));

        if (selectedConversationId) {
            const conv = convList.find(c => c.id === selectedConversationId);
            if (conv) {
                setSelectedConversation(conv);
                markAsRead(conv.id, user.id);
            }
        }

        setLoading(false);
    };

    const markAsRead = async (conversationId: string, userId: string) => {
        // Optimistic update
        setConversations(prev => prev.map(c =>
            c.id === conversationId ? { ...c, unread_count: 0 } : c
        ));

        // read_at é baixo risco de UX (sem toast), mas merece log — não é hipotético:
        // `Message` já teve RLS ligada sem policy de UPDATE nesta revisão (patterns.md).
        const { error } = await supabase
            .from('Message')
            .update({ read_at: new Date().toISOString() })
            .eq('conversationid', conversationId)
            .neq('senderid', userId)
            .is('read_at', null)
            .select('id');
        if (error) {
            logError('CompanyMessages.markAsRead', error);
        }
    };

    // Load data on mount and refresh
    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- loadData usa state setters estaveis, deps cobrem triggers de refresh
    }, [navigate, selectedConversationId, refreshTrigger]);

    // Realtime subscription for list updates
    useEffect(() => {
        const channel = supabase
            .channel('company_conversations_list')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'Conversation'
            }, () => {
                setRefreshTrigger(prev => prev + 1);
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    useEffect(() => {
        if (!selectedConversation) return;

        setErroMensagens(false);
        setMessages([]);

        const loadMessages = async () => {
            const { data, error } = await supabase
                .from('Message')
                .select('*')
                .eq('conversationid', selectedConversation.id)
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

            // Mark as read when opening
            if (currentUser) {
                markAsRead(selectedConversation.id, currentUser);
            }
        };

        loadMessages();

        const channel = supabase
            .channel(`company-messages:${selectedConversation.id}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'Message',
                filter: `conversationid=eq.${selectedConversation.id}`
            }, (payload) => {
                const newMsg = payload.new as { id: string; content: string; senderid: string; createdat: string; read_at: string | null };
                const isMine = newMsg.senderid === currentUser;
                updatePreview(selectedConversation.id, newMsg.content, newMsg.createdat, isMine);

                setMessages(prev => prev.some(m => m.id === newMsg.id)
                    ? prev
                    : [...prev, { ...newMsg, is_mine: isMine }]);

                // If I am viewing this and it's not mine, mark as read immediately
                if (!isMine && currentUser) {
                    markAsRead(selectedConversation.id, currentUser);
                }
            })
            .subscribe();

        // Presence channel for typing indicator
        const pChannel = supabase.channel(`typing:${selectedConversation.id}`)
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
    }, [selectedConversation, currentUser, messagesAttempt]);

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

        if (!error) updatePreview(sent.conversationid, sent.content, sent.createdat, true);

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
                        <h2 className="text-sm font-bold text-gray-700">{erroCarga ? 'Conversas' : `Conversas (${conversations.length})`}</h2>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {erroCarga ? (
                            <div className="p-4">
                                <ErroDeCarga onRetry={() => { setLoading(true); setRefreshTrigger(n => n + 1); }} />
                            </div>
                        ) : conversations.length === 0 ? (
                            <div className="p-6 text-center text-gray-600">
                                <MessageSquare size={40} className="mx-auto mb-4 opacity-20" />
                                <p className="font-bold">Nenhuma conversa ainda.</p>
                                <p className="text-sm mt-2">Os freelas aparecem aqui quando você inicia uma conversa a partir de um turno.</p>
                            </div>
                        ) : (
                            conversations.map(conv => (
                                <button
                                    key={conv.id}
                                    onClick={() => handleSelectConversation(conv)}
                                    className={`w-full min-h-16 p-4 text-left border-b border-gray-100 hover:bg-gray-50 transition-colors ${selectedConversation?.id === conv.id ? 'bg-gray-50 border-l-4 border-l-black' : ''}`}
                                >
                                    <div className="flex gap-3 items-start">
                                        <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
                                            {conv.worker_avatar ? (
                                                <img src={conv.worker_avatar} alt={conv.worker_name} className="w-full h-full object-cover" />
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
                                                <p className={`min-w-0 truncate text-sm ${conv.unread_count > 0 ? 'font-bold text-black' : 'text-gray-600'}`}>
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
                                                    <span className="truncate">{conv.job_title}</span>
                                                </p>
                                                <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${getStatusColor(conv.status)}`}>
                                                    {getStatusLabel(conv.status, conv.attendance)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            ))
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

                            <div
                                ref={logRef}
                                role="log"
                                aria-label="Mensagens da conversa"
                                tabIndex={0}
                                className="flex-1 min-h-0 overflow-y-auto overscroll-contain motion-safe:scroll-smooth p-4 space-y-4 bg-gray-50"
                            >
                                {erroMensagens ? (
                                    <ErroDeCarga onRetry={() => setMessagesAttempt(n => n + 1)} />
                                ) : messages.length === 0 ? (
                                    <div className="text-center py-12 text-gray-600">
                                        <MessageSquare size={40} className="mx-auto mb-4 opacity-20" />
                                        <p className="font-bold">Nenhuma mensagem ainda.</p>
                                        <p className="text-sm mt-2">Inicie a conversa com o freela.</p>
                                    </div>
                                ) : (
                                    messages.map(msg => (
                                        <div key={msg.id} className={`flex ${msg.is_mine ? 'justify-end' : 'justify-start'} animate-slide-in`}>
                                            <div className={`max-w-[85%] sm:max-w-[75%] px-4 py-3 border-2 border-black rounded-2xl ${msg.is_mine ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white rounded-tl-none'}`}>
                                                <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                                                <div className={`flex items-center justify-end gap-1 mt-1 text-xs font-medium ${msg.is_mine ? 'text-white/90' : 'text-gray-600'}`}>
                                                    {/* O relógio saiu: ele era renderizado em TODA mensagem, para sempre. Ícone de
                                                        relógio ao lado de uma mensagem significa "pendente" em qualquer app de
                                                        conversa — aqui não significava nada, e nunca sumia.
                                                        O duplo-check também era incondicional: aparecia igual em mensagem lida e não
                                                        lida, então não comunicava leitura nenhuma. Agora segue a convenção que todo
                                                        mundo já conhece: um check = enviada, dois checks = lida. */}
                                                    {format(new Date(msg.createdat), 'HH:mm', { locale: ptBR })}
                                                    {msg.is_mine && (
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
                                    ))
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
                                    className="flex gap-2 sm:gap-3"
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        void handleSendMessage();
                                        inputRef.current?.focus();
                                    }}
                                >
                                    <input
                                        type="text"
                                        aria-label="Mensagem"
                                        ref={inputRef}
                                        name="message"
                                        autoComplete="off"
                                        enterKeyHint="send"
                                        value={newMessage}
                                        onChange={(e) => {
                                            setNewMessage(e.target.value);
                                            if (selectedConversation && currentUser) {
                                                presenceChannel.current?.track({ typing: true, userId: currentUser });
                                                if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                                                typingTimeoutRef.current = setTimeout(() => {
                                                    presenceChannel.current?.track({ typing: false, userId: currentUser });
                                                }, 3000);
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            // Enter que confirma a composição (IME/teclado preditivo) não envia.
                                            if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
                                        }}
                                        placeholder="Digite sua mensagem..."
                                        className={`${FIELD_CONTROL_CLASS} flex-1 min-w-0`}
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
