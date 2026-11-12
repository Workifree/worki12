import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, MessageSquare, CreditCard, Info, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useNotifications } from '../contexts/NotificationContext';
import { useAuth } from '../contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button, PageHeader } from '../components/ui';

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
        <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8 pb-24">
            <PageHeader
                title="Notificações"
                action={unreadCount > 0 ? (
                    <Button variant="secondary" onClick={() => markAllAsRead()}>
                        Marcar todas como lidas
                    </Button>
                ) : undefined}
            />

            {/* Filter Tabs */}
            <div role="group" aria-label="Filtrar notificações" className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 mb-6">
                {FILTERS.map((f) => (
                    <button
                        key={f.id}
                        type="button"
                        aria-pressed={filterType === f.id}
                        onClick={() => handleFilterChange(f.id)}
                        className={`min-h-11 whitespace-nowrap px-4 rounded-full border-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                            filterType === f.id
                                ? 'bg-black text-white border-black'
                                : 'bg-white text-gray-700 border-transparent hover:border-black'
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
                <div role="alert" className="text-center py-16">
                    <Bell size={40} className="mx-auto mb-4 text-red-300" />
                    <p className="text-red-600 text-lg font-bold">Não foi possível carregar</p>
                    <p className="text-gray-600 text-sm mt-2">Verifique sua conexão e recarregue a página.</p>
                </div>
            ) : filteredNotifications.length === 0 ? (
                <div className="text-center py-16">
                    <Bell size={40} className="mx-auto mb-4 text-gray-300" />
                    <p className="text-gray-900 text-lg font-bold">Nenhuma notificação por aqui ainda.</p>
                    <p className="text-gray-600 text-sm mt-2 mb-6">
                        {filterType !== 'all'
                            ? 'Tente selecionar outro filtro ou voltar para "Todas".'
                            : 'Suas notificações aparecerão aqui assim que chegarem.'}
                    </p>
                    <Button
                        variant={userType === 'hire' ? 'dark' : 'primary'}
                        size="lg"
                        onClick={handleGoToDashboard}
                    >
                        Ir para o Dashboard
                    </Button>
                </div>
            ) : (
                <>
                    <div className="space-y-3">
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
                                className={`border-2 border-black rounded-2xl p-4 cursor-pointer flex gap-3 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 ${
                                    !n.read_at ? 'bg-blue-50' : 'bg-white'
                                }`}
                            >
                                {/* Icon */}
                                <div className={`h-9 w-9 rounded-full border-2 border-black flex items-center justify-center flex-shrink-0 ${!n.read_at ? 'bg-white' : 'bg-gray-100'}`}>
                                    {getIcon(n.type)}
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm ${!n.read_at ? 'font-bold text-black' : 'font-semibold text-gray-700'}`}>
                                        {n.title}
                                    </p>
                                    <p className="text-sm text-gray-600 mt-0.5">
                                        {n.message}
                                    </p>
                                    <p className="text-xs text-gray-600 mt-1">
                                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: ptBR })}
                                    </p>
                                </div>

                                {!n.read_at && (
                                    <span
                                        role="img"
                                        aria-label="Não lida"
                                        className="h-2.5 w-2.5 rounded-full bg-primary flex-shrink-0 mt-1.5"
                                    />
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between mt-6">
                            <Button
                                variant="secondary"
                                onClick={() => setPage(p => p - 1)}
                                disabled={page === 1}
                                iconLeft={<ChevronLeft size={16} />}
                            >
                                Página anterior
                            </Button>
                            <span className="text-sm font-bold text-gray-600 tabular-nums">
                                {page} / {totalPages}
                            </span>
                            <Button
                                variant="secondary"
                                onClick={() => setPage(p => p + 1)}
                                disabled={page >= totalPages}
                                iconRight={<ChevronRight size={16} />}
                            >
                                Próxima
                            </Button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
