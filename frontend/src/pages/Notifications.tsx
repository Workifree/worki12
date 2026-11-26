import { useState, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, Bell, MessageSquare, CreditCard, Info, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useNotifications } from '../contexts/NotificationContext';
import type { Notification } from '../contexts/NotificationContext';
import { useAuth } from '../contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button, EmptyState, ErrorState, FilterChip, PageHeader } from '../components/ui';
import { safeInternalPath } from '../lib/safeRedirect';

type FilterType = 'all' | 'message' | 'payment' | 'status_change' | 'system';

const FILTERS: { id: FilterType; label: string }[] = [
    { id: 'all', label: 'Todas' },
    { id: 'message', label: 'Mensagens' },
    { id: 'payment', label: 'Pagamentos' },
    { id: 'status_change', label: 'Status' },
    { id: 'system', label: 'Sistema' },
];

const PAGE_SIZE = 20;

function getIcon(type: string, title: string) {
    // O tipo "status_change" cobre aceite e cancelamento: o título decide o ícone.
    if (/cancel|estorn|recus|dispens/i.test(title)) return <XCircle size={20} aria-hidden="true" className="text-red-600" />;
    if (/preenchida|aceit|confirm/i.test(title) && type !== 'payment') return <CheckCircle2 size={20} aria-hidden="true" className="text-green-700" />;
    switch (type) {
        case 'message': return <MessageSquare size={20} aria-hidden="true" className="text-blue-500" />;
        case 'payment': return <CreditCard size={20} aria-hidden="true" className="text-green-500" />;
        case 'status_change': return <Info size={20} aria-hidden="true" className="text-yellow-500" />;
        case 'system': return <AlertCircle size={20} aria-hidden="true" className="text-gray-500" />;
        default: return <Bell size={20} aria-hidden="true" className="text-gray-500" />;
    }
}

/** O turno só é conhecido quando o próprio link do aviso aponta para ele. */
const JOB_LINK_RE = /\/(?:jobs|recibo)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

const jobIdFromLink = (link?: string): string | null => link?.match(JOB_LINK_RE)?.[1] ?? null;

interface NotificationGroup {
    key: string;
    latest: Notification;
    items: Notification[];
}

/** Junta avisos idênticos (mesmo tipo, texto e destino). A lista já vem do mais novo ao mais antigo. */
function groupNotifications(list: Notification[]): NotificationGroup[] {
    const groups = new Map<string, NotificationGroup>();
    for (const n of list) {
        const key = JSON.stringify([n.type, n.title, n.message, n.link ?? '']);
        const group = groups.get(key);
        if (group) group.items.push(n);
        else groups.set(key, { key, latest: n, items: [n] });
    }
    return [...groups.values()];
}

function shiftLabel(title: string, startDate: string | null): string {
    const m = startDate?.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${title} · ${m[3]}/${m[2]}` : title;
}

/** Nome e data dos turnos citados nos links. Falhou: os avisos continuam, só sem essa linha. */
function useShiftLabels(notifications: Notification[]): Record<string, string> {
    const [labels, setLabels] = useState<Record<string, string>>({});
    const ids = [...new Set(notifications.map((n) => jobIdFromLink(n.link)).filter((id): id is string => !!id))]
        .sort()
        .join(',');

    useEffect(() => {
        if (!ids) return;
        let active = true;
        void (async () => {
            const { data, error } = await supabase.from('jobs').select('id, title, start_date').in('id', ids.split(','));
            if (error) {
                logError('Notifications.shiftLabels', error);
                return;
            }
            if (!active) return;
            const rows = (data ?? []) as Array<{ id: string; title: string; start_date: string | null }>;
            setLabels(Object.fromEntries(rows.map((j) => [j.id, shiftLabel(j.title, j.start_date)])));
        })();
        return () => { active = false; };
    }, [ids]);

    return labels;
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

    const groups = useMemo(() => groupNotifications(filteredNotifications), [filteredNotifications]);
    const shiftLabels = useShiftLabels(notifications);

    const totalPages = Math.ceil(groups.length / PAGE_SIZE);

    const paginatedGroups = useMemo(
        () => groups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        [groups, page]
    );

    const handleFilterChange = (type: FilterType) => {
        setFilterType(type);
        setPage(1);
    };

    const handleGroupClick = async (group: NotificationGroup) => {
        const link = group.latest.link;
        const unread = group.items.filter((n) => !n.read_at);
        await Promise.all((unread.length ? unread : [group.latest]).map((n) => markAsRead(n.id)));
        // O link vem do banco: só navega para caminho interno.
        const destino = safeInternalPath(link);
        if (destino) {
            navigate(destino);
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
        <div className="max-w-2xl mx-auto pb-4">
            <PageHeader
                title="Notificações"
                action={unreadCount > 0 ? (
                    <Button variant="ghost" onClick={() => markAllAsRead()} data-copilot={userType === 'hire' ? 'empresa.notificacoes.marcar-todas' : 'freela.notificacoes.marcar-todas'}>
                        Marcar todas como lidas
                    </Button>
                ) : undefined}
            />

            {/* Filtros em quantas linhas precisar: nenhum fica cortado. */}
            <div role="group" aria-label="Filtrar notificações" className="flex flex-wrap gap-2 mb-6">
                {FILTERS.map((f) => (
                    <FilterChip key={f.id} pressed={filterType === f.id} onClick={() => handleFilterChange(f.id)}>
                        {f.label}
                    </FilterChip>
                ))}
            </div>

            {/* Content */}
            {carregando && notifications.length === 0 ? (
                <div className="space-y-3 py-4" role="status" aria-label="Carregando">
                    {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}
                </div>
            ) : erroCarga && notifications.length === 0 ? (
                <ErrorState onRetry={() => window.location.reload()} />
            ) : filteredNotifications.length === 0 ? (
                <EmptyState
                    icon={Bell}
                    size="page"
                    title="Nenhuma notificação por aqui ainda."
                    description={filterType !== 'all'
                        ? 'Tente selecionar outro filtro ou voltar para "Todas".'
                        : 'Suas notificações aparecerão aqui assim que chegarem.'}
                    action={
                        <Button variant={userType === 'hire' ? 'dark' : 'primary'} onClick={handleGoToDashboard}>
                            Ir para o Início
                        </Button>
                    }
                />
            ) : (
                <>
                    <ul className="divide-y divide-gray-200 overflow-hidden rounded-2xl border-2 border-black bg-white">
                        {paginatedGroups.map((group) => {
                            const n = group.latest;
                            const unread = group.items.some((item) => !item.read_at);
                            const jobId = jobIdFromLink(n.link);
                            const shift = jobId ? shiftLabels[jobId] : undefined;
                            return (
                                <li key={group.key}>
                                    <button
                                        type="button"
                                        onClick={() => void handleGroupClick(group)}
                                        className={`flex w-full gap-3 p-3 text-left transition-colors duration-fast hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black ${unread ? 'bg-blue-50' : 'bg-white'}`}
                                    >
                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100">
                                            {getIcon(n.type, n.title)}
                                        </span>
                                        <span className="min-w-0 flex-1 break-words">
                                            <span className={`block text-sm ${unread ? 'font-bold text-black' : 'font-semibold text-gray-700'}`}>
                                                {n.title}
                                            </span>
                                            {shift && <span className="mt-0.5 block text-xs font-bold text-black">Turno: {shift}</span>}
                                            <span className="mt-0.5 block text-sm text-gray-600">{n.message}</span>
                                            <span className="mt-1 block text-xs text-gray-600">
                                                {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: ptBR })}
                                                {group.items.length > 1 ? ` · ${group.items.length} avisos iguais` : ''}
                                            </span>
                                        </span>
                                        {unread && (
                                            <span
                                                role="img"
                                                aria-label="Não lida"
                                                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${userType === 'hire' ? 'bg-blue-600' : 'bg-primary'}`}
                                            />
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>

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
