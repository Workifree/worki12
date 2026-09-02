import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, MessageSquare, CreditCard, Info, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useNotifications } from '../contexts/NotificationContext';
import { useAuth } from '../contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type FilterType = 'all' | 'message' | 'payment' | 'status_change' | 'system';

const FILTERS: { id: FilterType; label: string }[] = [
    { id: 'all', label: 'Todas' },
    { id: 'message', label: 'Mensagens' },
    { id: 'payment', label: 'Pagamentos' },
    { id: 'status_change', label: 'Status' },
    { id: 'system', label: 'Sistema' },
];

const PAGE_SIZE = 20;

function getIcon(type: string) {
    switch (type) {
        case 'message': return <MessageSquare size={20} className="text-blue-500" />;
        case 'payment': return <CreditCard size={20} className="text-green-500" />;
        case 'status_change': return <Info size={20} className="text-yellow-500" />;
        case 'system': return <AlertCircle size={20} className="text-gray-500" />;
        default: return <Bell size={20} className="text-gray-500" />;
    }
}

export default function Notifications() {
    const navigate = useNavigate();
    const { notifications, unreadCount, carregando, erroCarga, markAsRead, markAllAsRead } = useNotifications();
    const { user } = useAuth();
    const [filterType, setFilterType] = useState<FilterType>('all');
    const [page, setPage] = useState(1);

    const userType = user?.user_metadata?.user_type as string | undefined;

    const filteredNotifications = useMemo(
        () => notifications.filter(n => filterType === 'all' || n.type === filterType),
        [notifications, filterType]
    );

    const totalPages = Math.ceil(filteredNotifications.length / PAGE_SIZE);

    const paginatedNotifications = useMemo(
        () => filteredNotifications.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        [filteredNotifications, page]
    );

    const handleFilterChange = (type: FilterType) => {
        setFilterType(type);
        setPage(1);
    };

    const handleNotificationClick = async (id: string, link?: string) => {
        await markAsRead(id);
        if (link) {
            navigate(link);
        }
    };

    const handleGoToDashboard = () => {
        if (userType === 'hire') {
            navigate('/company/dashboard');
        } else {
            navigate('/dashboard');
        }
    };

    return (
        <div className="max-w-2xl mx-auto px-4 py-8 pb-24">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-3xl font-black uppercase tracking-tight">Notificações</h1>
                {unreadCount > 0 && (
                    <button
                        onClick={() => markAllAsRead()}
                        className="text-sm font-bold text-primary hover:underline uppercase"
                    >
                        Marcar todas como lidas
                    </button>
                )}
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 mb-6">
                {FILTERS.map((f) => (
                    <button
                        key={f.id}
                        onClick={() => handleFilterChange(f.id)}
                        className={`min-h-11 whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold transition-all ${
                            filterType === f.id
                                ? 'bg-black text-white'
                                : 'text-gray-500 hover:text-black hover:bg-gray-100'
                        }`}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            {carregando && notifications.length === 0 ? (
                <div className="space-y-3 py-4">
                    {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}
                </div>
            ) : erroCarga && notifications.length === 0 ? (
                <div className="text-center py-16">
                    <Bell size={48} className="mx-auto mb-4 text-red-300" />
                    <p className="text-red-600 text-lg font-black uppercase">Não foi possível carregar</p>
                    <p className="text-gray-500 text-sm mt-2">Verifique sua conexão e recarregue a página.</p>
                </div>
            ) : filteredNotifications.length === 0 ? (
                <div className="text-center py-16">
                    <Bell size={48} className="mx-auto mb-4 text-gray-300" />
                    <p className="text-gray-500 text-lg font-bold">Nenhuma notificação por aqui ainda.</p>
                    <p className="text-gray-400 text-sm mt-2 mb-6">
                        {filterType !== 'all'
                            ? 'Tente selecionar outro filtro ou voltar para "Todas".'
                            : 'Suas notificações aparecerão aqui assim que chegarem.'}
                    </p>
                    <button
                        onClick={handleGoToDashboard}
                        className={`px-6 py-3 font-bold rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all uppercase ${
                            userType === 'hire'
                                ? 'bg-blue-600 text-white'
                                : 'bg-primary text-white'
                        }`}
                    >
                        Ir para o Dashboard
                    </button>
                </div>
            ) : (
                <>
                    <div className="space-y-2">
                        {paginatedNotifications.map((n) => (
                            <div
                                key={n.id}
                                onClick={() => handleNotificationClick(n.id, n.link)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        handleNotificationClick(n.id, n.link);
                                    }
                                }}
                                className={`border-2 border-gray-100 hover:border-black focus-visible:border-black focus-visible:outline-none rounded-xl p-4 transition-all cursor-pointer flex gap-3 ${
                                    !n.read_at ? 'bg-blue-50' : 'bg-white'
                                }`}
                            >
                                {/* Unread dot */}
                                <div className="flex items-start pt-1">
                                    {!n.read_at && (
                                        <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mr-2 mt-1" />
                                    )}
                                </div>

                                {/* Icon */}
                                <div className={`h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 ${!n.read_at ? 'bg-white shadow-sm' : 'bg-gray-100'}`}>
                                    {getIcon(n.type)}
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm ${!n.read_at ? 'font-bold text-black' : 'font-medium text-gray-700'}`}>
                                        {n.title}
                                    </p>
                                    <p className="text-sm text-gray-600 mt-0.5">
                                        {n.message}
                                    </p>
                                    <p className="text-xs text-gray-400 mt-1">
                                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: ptBR })}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between mt-6">
                            <button
                                onClick={() => setPage(p => p - 1)}
                                disabled={page === 1}
                                className="border-2 border-black px-4 py-2 font-bold uppercase text-sm flex items-center gap-1 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <ChevronLeft size={16} /> Página anterior
                            </button>
                            <span className="text-sm font-bold text-gray-500">
                                {page} / {totalPages}
                            </span>
                            <button
                                onClick={() => setPage(p => p + 1)}
                                disabled={page >= totalPages}
                                className="border-2 border-black px-4 py-2 font-bold uppercase text-sm flex items-center gap-1 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Próxima <ChevronRight size={16} />
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
