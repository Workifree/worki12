import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import BottomNav from '../components/BottomNav';
import NotificationBell from '../components/NotificationBell';
import InviteTakeover from '../components/InviteTakeover';

export default function MainLayout() {
    // A checagem de sessao/papel/onboarding que vivia aqui era REDUNDANTE: este layout so e
    // montado dentro de <ProtectedRoute>, que ja faz as tres (Article 12) — inclusive o caso do
    // gerente via get_my_companies. O custo da duplicata era de EXPERIENCIA: um fetch de workers
    // e um spinner a mais em serie a cada navegacao, depois do gate que ja tinha passado.
    // Auditoria de rede de 01/09: toda tela do freela pagava 2x a mesma consulta de onboarding.

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
