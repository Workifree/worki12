import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { logError } from '../lib/logger'

export interface Notification {
    id: string;
    type: 'status_change' | 'message' | 'payment' | 'system';
    title: string;
    message: string;
    link?: string;
    read_at: string | null;
    created_at: string;
}

interface NotificationContextType {
    notifications: Notification[];
    unreadCount: number;
    markAsRead: (id: string) => Promise<void>;
    markAllAsRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [dbAvailable, setDbAvailable] = useState(true);

    const unreadCount = notifications.filter(n => !n.read_at).length;

    useEffect(() => {
        if (!user) {
            return () => {
                setNotifications([]);
            };
        }

        let isActive = true;

        const createId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

        const loadNotifications = async () => {
            if (!dbAvailable) return;
            const { data, error } = await supabase
                .from('notifications')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(50);

            if (!isActive) return;

            if (error) {
                if (error.code === '42P01' || error.message?.toLowerCase().includes('does not exist')) {
                    setDbAvailable(false);
                }
                return;
            }

            if (data) setNotifications(data);
        };

        loadNotifications();

        const dbChannel = dbAvailable ? supabase
            .channel('notifications-changes')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${user.id}`
                },
                (payload) => {
                    if (payload.eventType === 'INSERT') {
                        setNotifications(prev => [payload.new as Notification, ...prev]);
                    } else if (payload.eventType === 'UPDATE') {
                        setNotifications(prev => prev.map(n => n.id === payload.new.id ? payload.new as Notification : n));
                    }
                }
            )
            .subscribe() : null;

        const broadcastChannel = supabase
            .channel(`user:${user.id}`)
            .on('broadcast', { event: 'new_notification' }, (payload) => {
                const data = payload.payload as Partial<Notification> & { message?: string; link?: string; title?: string; type?: Notification['type'] };
                const createdAt = new Date().toISOString();
                const notification: Notification = {
                    id: data.id ?? createId(),
                    type: data.type ?? 'system',
                    title: data.title ?? 'Notificação',
                    message: data.message ?? '',
                    link: data.link,
                    read_at: null,
                    created_at: data.created_at ?? createdAt
                };
                setNotifications(prev => [notification, ...prev]);
            })
            .subscribe();

        return () => {
            isActive = false;
            if (dbChannel) supabase.removeChannel(dbChannel);
            supabase.removeChannel(broadcastChannel);
        };
    }, [user, dbAvailable]);

    const markAsRead = async (id: string) => {
        // Optimistic update
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));

        if (!dbAvailable) return;

        // read_at é baixo risco de UX (sino não é gesto explícito com toast), mas merece
        // log — não é hipotético: `Message` já teve RLS ligada sem policy de UPDATE nesta
        // revisão. .select('id') detecta o 204-sem-erro (patterns.md).
        const { data, error } = await supabase
            .from('notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('id', id)
            .select('id');

        if (error) logError('Error marking notification as read:', error);
        else if (!data || data.length === 0) logError('Error marking notification as read: 0 linhas afetadas (RLS negou em silêncio)', { id });
    };

    const markAllAsRead = async () => {
        // Optimistic
        setNotifications(prev => prev.map(n => ({ ...n, read_at: new Date().toISOString() })));

        if (!dbAvailable) return;

        // Efeito em lote: 0 linhas pode ser legítimo (nada não-lido). .select('id') só para
        // log/observabilidade — não vira erro visível (mesmo raciocínio de patterns.md p/ lote).
        const { error } = await supabase
            .from('notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('user_id', user?.id)
            .is('read_at', null)
            .select('id');

        if (error) logError('Error marking all as read:', error);
    };

    return (
        <NotificationContext.Provider value={{ notifications, unreadCount, markAsRead, markAllAsRead }}>
            {children}
        </NotificationContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useNotifications = () => {
    const context = useContext(NotificationContext);
    if (context === undefined) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
};
