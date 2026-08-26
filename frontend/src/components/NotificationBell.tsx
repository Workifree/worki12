import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, Info, MessageSquare, CreditCard, AlertCircle } from 'lucide-react';
import { useNotifications } from '../contexts/NotificationContext';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';

export default function NotificationBell({ className = "" }: { className?: string }) {
    const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
    const { user } = useAuth();
    const userType = user?.user_metadata?.user_type as string | undefined;
    const notificationsPath = userType === 'hire' ? '/company/notifications' : '/notifications';
    const [isOpen, setIsOpen] = useState(false);
    // O painel é renderizado num portal com posição `fixed` ancorada no sino —
    // assim ele escapa do `overflow-hidden` do menu lateral (Sidebar), que antes
    // o cortava em vez de deixá-lo abrir por cima do conteúdo.
    const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    // Calcula a posição do painel a partir do retângulo do botão (alinhado à direita).
    const updateCoords = useCallback(() => {
        const rect = buttonRef.current?.getBoundingClientRect();
        if (!rect) return;
        setCoords({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
    }, []);

    // Enquanto aberto: mantém o painel alinhado ao sino em resize/scroll.
    // (A posição inicial é calculada no clique de abertura, evitando setState no corpo do efeito.)
    useEffect(() => {
        if (!isOpen) return;
        window.addEventListener('resize', updateCoords);
        window.addEventListener('scroll', updateCoords, true);
        return () => {
            window.removeEventListener('resize', updateCoords);
            window.removeEventListener('scroll', updateCoords, true);
        };
    }, [isOpen, updateCoords]);

    const toggleOpen = () => {
        if (!isOpen) updateCoords(); // calcula a posição a partir do retângulo do sino antes de abrir
        setIsOpen((o) => !o);
    };

    // Fecha ao clicar fora (considera botão E painel, que vive no portal).
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as Node;
            if (
                buttonRef.current && !buttonRef.current.contains(target) &&
                panelRef.current && !panelRef.current.contains(target)
            ) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    const handleNotificationClick = async (id: string, link?: string) => {
        await markAsRead(id);
        setIsOpen(false);
        if (link) {
            navigate(link);
        }
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'message': return <MessageSquare size={16} className="text-blue-500" />;
            case 'payment': return <CreditCard size={16} className="text-green-500" />;
            case 'status_change': return <Info size={16} className="text-yellow-500" />; // Or check-circle
            case 'system': return <AlertCircle size={16} className="text-gray-500" />;
            default: return <Bell size={16} className="text-gray-500" />;
        }
    };

    return (
        <div className="relative">
            <button
                ref={buttonRef}
                onClick={toggleOpen}
                className={`relative min-h-11 min-w-11 inline-flex items-center justify-center rounded-full hover:bg-white/10 transition-colors ${className}`}
                aria-label="Notifications"
            >
                <Bell size={24} className={unreadCount > 0 ? "text-primary" : "currentColor"} />
                {unreadCount > 0 && (
                    <span className="absolute top-0 right-0 h-5 w-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center border-2 border-white">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {isOpen && coords && createPortal(
                <div
                    ref={panelRef}
                    style={{ position: 'fixed', top: coords.top, right: coords.right }}
                    className="w-80 md:w-96 max-w-[calc(100vw-16px)] bg-white rounded-xl shadow-2xl border-2 border-black z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-top-right"
                >
                    <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                        <h3 className="font-bold text-sm">Notificações</h3>
                        {unreadCount > 0 && (
                            <button
                                onClick={() => markAllAsRead()}
                                className="text-xs text-primary font-bold hover:underline flex items-center gap-1"
                            >
                                <Check size={12} />
                                Marcar todas como lidas
                            </button>
                        )}
                    </div>

                    <div className="max-h-[70vh] overflow-y-auto">
                        {notifications.length === 0 ? (
                            <div className="p-8 text-center text-gray-400">
                                <Bell size={32} className="mx-auto mb-2 opacity-20" />
                                <p className="text-sm">Nenhuma notificação.</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-100">
                                {notifications.map((notification) => (
                                    <div
                                        key={notification.id}
                                        onClick={() => handleNotificationClick(notification.id, notification.link)}
                                        className={`p-4 hover:bg-gray-50 transition-colors cursor-pointer flex gap-3 ${!notification.read_at ? 'bg-blue-50/50' : ''}`}
                                    >
                                        <div className={`mt-1 h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${!notification.read_at ? 'bg-white shadow-sm' : 'bg-gray-100'}`}>
                                            {getIcon(notification.type)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className={`text-sm ${!notification.read_at ? 'font-bold text-black' : 'font-medium text-gray-700'}`}>
                                                {notification.title}
                                            </p>
                                            <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                                {notification.message}
                                            </p>
                                            <p className="text-[10px] text-gray-400 mt-2">
                                                {format(new Date(notification.created_at), "d 'de' MMM, HH:mm", { locale: ptBR })}
                                            </p>
                                        </div>
                                        {!notification.read_at && (
                                            <div className="h-2 w-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="border-t border-gray-100 p-3 text-center">
                        <button
                            onClick={() => { setIsOpen(false); navigate(notificationsPath); }}
                            className="text-sm font-bold text-primary hover:underline"
                        >
                            Ver todas as notificações
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
