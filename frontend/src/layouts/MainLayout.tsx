import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import Sidebar from '../components/Sidebar';
import BottomNav from '../components/BottomNav';
import NotificationBell from '../components/NotificationBell';
import InviteTakeover from '../components/InviteTakeover';

export default function MainLayout() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const checkUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();

            if (!user) {
                navigate('/login');
                return;
            }

            // Check if user is a worker and has completed onboarding
            // We optimize by checking if they are 'hire' type in metadata first to avoid unnecessary DB calls if they are company trying to access worker routes (which shouldn't happen but good to be safe)
            if (user.user_metadata?.user_type === 'hire') {
                // ideally redirect to company dashboard
                navigate('/company/dashboard');
                return;
            }

            // Check worker profile
            const { data: worker } = await supabase
                .from('workers')
                .select('onboarding_completed')
                .eq('id', user.id)
                .single();

            if (!worker || !worker.onboarding_completed) {
                navigate('/worker/onboarding');
            }

            setLoading(false);
        };

        checkUser();
    }, [navigate]);

    if (loading) {
        return (
            <div className="min-h-screen flex flex-col md:flex-row max-w-7xl mx-auto bg-[#F4F4F0]">
                <div className="hidden md:block w-64 p-6 space-y-4">
                    <div className="h-8 w-24 bg-gray-200 rounded-lg animate-pulse" />
                    <div className="space-y-3 mt-8">
                        {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-gray-200 rounded-xl animate-pulse" />)}
                    </div>
                </div>
                <main className="flex-1 p-4 md:p-8 space-y-6">
                    <div className="h-10 w-48 bg-gray-200 rounded-xl animate-pulse" />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {[...Array(3)].map((_, i) => <div key={i} className="h-28 bg-gray-200 rounded-xl animate-pulse" />)}
                    </div>
                    <div className="space-y-3">
                        {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl animate-pulse" />)}
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col md:flex-row max-w-7xl mx-auto">
            {/* Aviso em tela cheia de convite de turno (worker only) */}
            <InviteTakeover />

            {/* Desktop Sidebar */}
            <Sidebar />

            {/* Mobile Header (Optional, for Logo) */}
            <header className="md:hidden flex items-center justify-between px-4 h-14 sticky top-0 bg-glass-surface/90 backdrop-blur-md z-40 border-b border-glass-border">
                <h1 className="text-xl font-black text-primary tracking-tighter">Worki.</h1>
                <NotificationBell />
            </header>

            {/* Main Content Area */}
            <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8 overflow-y-auto">
                <Outlet />
            </main>

            {/* Mobile Navigation */}
            <BottomNav type="worker" />
        </div>
    );
}
