import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import BottomNav from '../components/BottomNav';
import NotificationBell from '../components/NotificationBell';
import InviteTakeover from '../components/InviteTakeover';
import ProfileAvatarLink from '../components/ProfileAvatarLink';
import SkipLink, { MAIN_CONTENT_ID } from '../components/SkipLink';
import { GuideRoleFreela } from '../components/guide/GuideRole';
import HelpButton from './HelpButton';
import { useNoticeWiring } from './useNoticeWiring';
import { useLayoutAlerts } from './useLayoutAlerts';

export default function MainLayout() {
    const { pathname } = useLocation();
    useNoticeWiring();
    useLayoutAlerts();

    // A checagem de sessao/papel/onboarding que vivia aqui era REDUNDANTE: este layout so e
    // montado dentro de <ProtectedRoute>, que ja faz as tres (Article 12) — inclusive o caso do
    // gerente via get_my_companies. O custo da duplicata era de EXPERIENCIA: um fetch de workers
    // e um spinner a mais em serie a cada navegacao, depois do gate que ja tinha passado.
    // Auditoria de rede de 01/09: toda tela do freela pagava 2x a mesma consulta de onboarding.

    return (
        <div className="worki-layout min-h-screen flex flex-col md:flex-row max-w-7xl mx-auto">
            <SkipLink />
            <GuideRoleFreela />
            {/* Aviso em tela cheia de convite de turno (worker only) */}
            <InviteTakeover />

            {/* Desktop Sidebar */}
            <Sidebar />

            {/* Mobile Header (Optional, for Logo) */}
            <header className="md:hidden sticky top-0 z-40 flex h-[var(--worki-header-h,3.5rem)] items-center justify-between gap-2 border-b-2 border-black bg-white/95 pl-4 pr-2 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md">
                <div className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-black text-xs font-bold bg-primary-dark text-white">W.</span>
                    <p className="text-lg font-bold tracking-tight text-black">Worki</p>
                </div>
                <div className="flex shrink-0 items-center">
                    <HelpButton />
                    <NotificationBell />
                    <ProfileAvatarLink />
                </div>
            </header>

            {/* Main Content Area */}
            <main id={MAIN_CONTENT_ID} tabIndex={-1} className="focus:outline-none min-w-0 flex-1 p-4 sm:p-6 md:p-8 pb-[calc(var(--worki-nav-h,0px)+1.5rem)] md:pb-8">
                <div className="hidden md:flex md:empty:hidden justify-end mb-2">
                    <HelpButton variante="linha" />
                </div>
                {/* `key` por rota: a tela nova entra com um fade curto (`worki-page-enter`, index.css). */}
                <div key={pathname} className="worki-page-enter">
                    <Outlet />
                </div>
            </main>

            {/* Mobile Navigation */}
            <BottomNav type="worker" />
        </div>
    );
}
