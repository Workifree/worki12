import { Link, Outlet, useLocation } from 'react-router-dom';
import { PlusCircle } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import BottomNav from '../components/BottomNav';
import SkipLink, { MAIN_CONTENT_ID } from '../components/SkipLink';
import NotificationBell from '../components/NotificationBell';
import CompanySwitcher from '../components/company/CompanySwitcher';
import GestorRouteGuard from '../components/company/GestorRouteGuard';
import { COMPANY_CREATE_ACTION, COMPANY_FAB_PATHS } from '../lib/navigation';

export default function CompanyLayout() {
    const { pathname } = useLocation();
    const showCreateFab = COMPANY_FAB_PATHS.includes(pathname);

    // A checagem que vivia aqui era redundante com o <ProtectedRoute> (sessao + papel +
    // onboarding, gerente incluso) — e pior: refazia getUser + get_my_companies A CADA troca de
    // rota (`[location.pathname]`). Auditoria de rede de 01/09. O guard e um so, no seam.

    return (
        <div className="worki-layout min-h-screen flex flex-col md:flex-row max-w-7xl mx-auto bg-[#F4F4F0]">
            <SkipLink />
            {/* Desktop Sidebar - Company Mode */}
            <Sidebar type="company" />

            {/* Mobile Header */}
            <header className="md:hidden flex items-center justify-between px-4 h-14 sticky top-0 bg-white/90 backdrop-blur-md z-40 border-b-2 border-black">
                <p className="text-xl font-bold text-black tracking-tight">Worki. <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-pill ml-1">Business</span></p>
                <NotificationBell />
            </header>

            {/* Main Content Area — com o botão flutuante, folga extra para ele não cobrir o fim da lista */}
            <main id={MAIN_CONTENT_ID} tabIndex={-1} className={`focus:outline-none flex-1 p-4 sm:p-6 md:p-8 md:pb-8 overflow-y-auto ${showCreateFab ? 'pb-40' : 'pb-24'}`}>
                <CompanySwitcher className="md:hidden mb-4" />
                <GestorRouteGuard>
                    <Outlet />
                </GestorRouteGuard>
            </main>

            {/* z-30: a barra de seleção da tela Hoje (z-40) passa por cima dele. */}
            {showCreateFab && (
                <Link
                    to={COMPANY_CREATE_ACTION.path}
                    className="worki-fab md:hidden fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 inline-flex h-12 items-center gap-2 rounded-pill border-2 border-black bg-black px-5 text-sm font-bold text-white shadow-[3px_3px_0px_0px_rgba(0,166,81,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
                >
                    <PlusCircle size={20} aria-hidden="true" />
                    {COMPANY_CREATE_ACTION.label}
                </Link>
            )}

            <BottomNav type="company" />
        </div>
    );
}
