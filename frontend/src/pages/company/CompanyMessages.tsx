import { useEffect, useState, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { MessageSquare, Send, ArrowLeft, User, Loader2, Check, CheckCheck, Briefcase } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useToast } from '../../contexts/ToastContext';
import { getMyCompanies } from '../../services/companyScopeService';
import { logError } from '../../lib/logger'

interface ConversationItem {
    id: string;
    application_uuid: string;
    worker_name: string;
    worker_avatar?: string;
    job_title: string;
    last_message?: string;
    last_message_at?: string;
    unread_count: number;
    status: string;
}

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
    const { addToast } = useToast();

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const presenceChannel = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isOtherTyping, setIsOtherTyping] = useState(false);

    const [refreshTrigger, setRefreshTrigger] = useState(0);

    // Scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const loadData = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return navigate('/login');
        setCurrentUser(user.id);

        // Todas as unidades que a sessao OPERA — inclui gerente (company_members), que a
        // consulta por `owner_id` deixava de fora: ele nao via conversa nenhuma.
        const operadas = await getMyCompanies();
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
                    status,
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

        if (error) {
            logError('SUPABASE ERROR fetching conversations:', error);
            setLoading(false);
            return;
        }

        // Filter to only show conversations for jobs belonging to any of the user's companies
        interface ConversationData {
            id: string;
            application_uuid: string;
            createdat: string;
            islocked: boolean;
            application?: {
                id: string;
                status: string;
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

        const myConversations = ((convData || []) as unknown as ConversationData[]).filter((c) => {
            if (!c.application || !c.application.job) {
                return false; // Skip malformed data
            }

            const jobCorpId = c.application.job.company_id;
            return companyIds.has(jobCorpId);
        });

        // Fetch all unread messages for these conversations
        const conversationIds = myConversations.map((c) => c.id);
        let unreadCounts: Record<string, number> = {};

        if (conversationIds.length > 0) {
            const { data: unreadData } = await supabase
                .from('Message')
                .select('conversationid')
                .in('conversationid', conversationIds)
                .neq('senderid', user.id) // Messages sent by OTHERS (workers)
                .is('read_at', null);     // That are NOT read

            if (unreadData) {
                unreadCounts = unreadData.reduce((acc: Record<string, number>, curr) => {
                    acc[curr.conversationid] = (acc[curr.conversationid] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>);
            }
        }

        const convList: ConversationItem[] = myConversations.map((c) => ({
            id: c.id,
            application_uuid: c.application_uuid,
            worker_name: c.application?.worker?.full_name || 'Freela',
            worker_avatar: c.application?.worker?.avatar_url,
            job_title: c.application?.job?.title || 'Turno sem título',
            status: c.application?.status || 'pending',
            last_message: undefined,
            last_message_at: c.createdat,
            unread_count: unreadCounts[c.id] || 0
        }));

        setConversations(convList);

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

        const loadMessages = async () => {
            const { data, error } = await supabase
                .from('Message')
                .select('*')
                .eq('conversationid', selectedConversation.id)
                .order('createdat', { ascending: true });

            if (error) {
                logError('Error fetching messages:', error);
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

                setMessages(prev => [...prev, {
                    ...newMsg,
                    is_mine: isMine
                }]);

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
    }, [selectedConversation, currentUser]);

    const handleSendMessage = async () => {
        if (!newMessage.trim() || !selectedConversation || !currentUser) return;

        setSending(true);
        const messageContent = newMessage.trim();
        setNewMessage('');

        // Stop typing indicator before sending
        presenceChannel.current?.track({ typing: false, userId: currentUser });
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

        const { error } = await supabase
            .from('Message')
            .insert({
                id: crypto.randomUUID(),
                conversationid: selectedConversation.id,
                senderid: currentUser,
                content: messageContent,
                createdat: new Date().toISOString()
            });

        if (error) {
            logError('Error sending message:', error);
            setNewMessage(messageContent);
            addToast('Erro ao enviar mensagem. Tente novamente.', 'error');
        }

        setSending(false);
    };

    const handleSelectConversation = (conv: ConversationItem) => {
        setSelectedConversation(conv);
        navigate(`/company/messages?conversation=${conv.id}`, { replace: true });
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'hired':
            case 'in_progress':
                return 'bg-green-100 text-green-700';
            case 'declined':
            case 'rejected':
                return 'bg-red-100 text-red-700';
            case 'completed':
                return 'bg-blue-100 text-blue-700';
            default:
                return 'bg-yellow-100 text-yellow-700';
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'invited': return 'Convidado';
            case 'hired': return 'Contratado';
            case 'in_progress': return 'Em Andamento';
            case 'completed': return 'Concluído';
            case 'declined':
            case 'rejected': return 'Recusado';
            default: return status;
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col h-[calc(100vh-140px)] max-w-6xl mx-auto animate-pulse">
                <div className="h-10 bg-gray-200 rounded w-1/4 mb-4" />
                <div className="flex-1 grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4">
                    <div className="space-y-3">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="h-16 bg-gray-200 rounded-xl" />
                        ))}
                    </div>
                    <div className="bg-gray-200 rounded-xl" />
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] font-sans text-accent max-w-6xl mx-auto">

            <div className="mb-4">
                <h2 className="text-4xl font-black uppercase tracking-tighter">Mensagens</h2>
                <p className="text-gray-500 font-bold">Converse com os freelas dos seus turnos.</p>
            </div>

            <div className="flex-1 flex gap-6 min-h-0 bg-white border-2 border-black rounded-2xl overflow-hidden shadow-[6px_6px_0px_0px_rgba(0,0,0,0.1)]">

                <div className={`w-full md:w-80 border-r-2 border-black flex flex-col ${selectedConversation ? 'hidden md:flex' : 'flex'}`}>
                    <div className="p-4 border-b border-gray-200">
                        <h3 className="font-bold uppercase text-sm text-gray-500">Freelas ({conversations.length})</h3>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {conversations.length === 0 ? (
                            <div className="p-6 text-center text-gray-400">
                                <MessageSquare size={48} className="mx-auto mb-4 opacity-20" />
                                <p className="font-bold">Nenhuma conversa ainda.</p>
                                <p className="text-sm mt-2">Os freelas aparecem aqui quando você inicia uma conversa a partir de um turno.</p>
                            </div>
                        ) : (
                            conversations.map(conv => (
                                <button
                                    key={conv.id}
                                    onClick={() => handleSelectConversation(conv)}
                                    className={`w-full p-4 text-left border-b border-gray-100 hover:bg-gray-50 transition-colors ${selectedConversation?.id === conv.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}`}
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
                                            <div className="flex justify-between items-start gap-2">
                                                <h4 className="font-bold text-sm truncate">{conv.worker_name}</h4>
                                                {conv.unread_count > 0 ? (
                                                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-red-500 text-white animate-pulse">
                                                        {conv.unread_count}
                                                    </span>
                                                ) : (
                                                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${getStatusColor(conv.status)}`}>
                                                        {getStatusLabel(conv.status)}
                                                    </span>
                                                )}
                                            </div>
                                            <p className={`text-xs truncate mt-1 flex items-center gap-1 ${conv.unread_count > 0 ? 'font-bold text-black' : 'text-gray-500'}`}>
                                                <Briefcase size={10} />
                                                {conv.job_title}
                                            </p>
                                        </div>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                <div className={`flex-1 flex flex-col ${!selectedConversation ? 'hidden md:flex' : 'flex'}`}>
                    {selectedConversation ? (
                        <>
                            <div className="p-4 border-b-2 border-gray-100 flex items-center gap-4">
                                <button
                                    onClick={() => setSelectedConversation(null)}
                                    className="md:hidden p-2 hover:bg-gray-100 rounded-lg"
                                >
                                    <ArrowLeft size={20} />
                                </button>
                                <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
                                    {selectedConversation.worker_avatar ? (
                                        <img src={selectedConversation.worker_avatar} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <User size={20} className="text-gray-400" />
                                    )}
                                </div>
                                <div className="flex-1">
                                    <h4 className="font-bold">{selectedConversation.worker_name}</h4>
                                    <p className="text-xs text-gray-500 flex items-center gap-1">
                                        <Briefcase size={10} />
                                        {selectedConversation.job_title}
                                    </p>
                                </div>
                                <span className={`text-xs font-bold uppercase px-3 py-1 rounded-full ${getStatusColor(selectedConversation.status)}`}>
                                    {getStatusLabel(selectedConversation.status)}
                                </span>
                            </div>

                            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
                                {messages.length === 0 ? (
                                    <div className="text-center py-12 text-gray-400">
                                        <MessageSquare size={48} className="mx-auto mb-4 opacity-20" />
                                        <p className="font-bold">Nenhuma mensagem ainda.</p>
                                        <p className="text-sm mt-2">Inicie a conversa com o freela.</p>
                                    </div>
                                ) : (
                                    messages.map(msg => (
                                        <div key={msg.id} className={`flex ${msg.is_mine ? 'justify-end' : 'justify-start'} animate-slide-in`}>
                                            <div className={`max-w-[75%] p-4 rounded-2xl shadow-sm ${msg.is_mine ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white border border-gray-100 rounded-tl-none'}`}>
                                                <p className="text-sm font-medium whitespace-pre-wrap break-words">{msg.content}</p>
                                                <div className={`flex items-center justify-end gap-1 mt-1 text-[10px] uppercase font-bold tracking-wider ${msg.is_mine ? 'text-white/80' : 'text-gray-400'}`}>
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
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Typing Indicator */}
                            {isOtherTyping && (
                                <div className="px-4 py-2 text-xs text-gray-400 font-bold flex items-center gap-2">
                                    <span className="animate-bounce">•</span>
                                    <span className="animate-bounce" style={{ animationDelay: '0.1s' }}>•</span>
                                    <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>•</span>
                                    Digitando...
                                </div>
                            )}

                            <div className="p-4 border-t-2 border-gray-100 bg-white">
                                <div className="flex gap-3">
                                    <input
                                        type="text"
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
                                        onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                                        placeholder="Digite sua mensagem..."
                                        className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 focus:border-blue-500 focus:outline-none transition-colors font-medium"
                                        disabled={sending}
                                    />
                                    <button
                                        onClick={handleSendMessage}
                                        disabled={!newMessage.trim() || sending}
                                        className="bg-blue-500 text-white px-6 py-3 rounded-xl font-bold uppercase flex items-center gap-2 hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {sending ? (
                                            <Loader2 size={20} className="animate-spin" />
                                        ) : (
                                            <Send size={20} />
                                        )}
                                        <span className="hidden sm:inline">Enviar</span>
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-400">
                            <div className="text-center">
                                <MessageSquare size={64} className="mx-auto mb-4 opacity-20" />
                                <p className="font-bold text-lg">Selecione uma conversa</p>
                                <p className="text-sm mt-2">Escolha um freela à esquerda para ver as mensagens.</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
