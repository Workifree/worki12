import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { clearServiceWorkerCaches } from '../lib/pwa';
import { clearJobDrafts } from '../lib/jobDraft';
import { setMonitoringUser } from '../lib/logger';
import { leaveDevice } from '../lib/leaveDevice';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check active sessions and sets the user
        const getSession = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setUser(session?.user ?? null);
            if (session?.user) {
                setMonitoringUser({ id: session.user.id });
            } else {
                setMonitoringUser(null);
            }
            setLoading(false);
        };

        getSession();

        // Listen for changes on auth state (logged in, signed out, etc.)
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            // Rede de segurança para saídas que não passam por `signOut()` (outras telas, sessão
            // expirada). Fora do callback: chamar o cliente aqui dentro trava o lock do auth.
            if (event === 'SIGNED_OUT') setTimeout(() => { void leaveDevice(); }, 0);
            setUser(session?.user ?? null);
            if (session?.user) {
                setMonitoringUser({ id: session.user.id });
            } else {
                setMonitoringUser(null);
            }
            setLoading(false);
        });

        return () => subscription.unsubscribe();
    }, []);

    const signOut = async () => {
        // R4: propaga o erro pro chamador (Sidebar/Profile/CompanyProfile) tratar com
        // toast + estado de loading — nunca falha em silêncio.
        // Com sessão ainda válida (a inscrição de push só sai do banco assim). Nunca lança.
        await leaveDevice();
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        // PWA: esvazia os caches do service worker no logout (defesa em profundidade; ele ja nao guarda dado de usuario).
        clearServiceWorkerCaches();
        clearJobDrafts();
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, loading, signOut }}>
            {children}
        </AuthContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
