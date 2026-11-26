import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import BottomNav from '../components/BottomNav';
import SkipLink, { MAIN_CONTENT_ID } from '../components/SkipLink';
import NotificationBell from '../components/NotificationBell';
import CompanySwitcher from '../components/company/CompanySwitcher';
import FormerCompanyNotice from '../components/company/FormerCompanyNotice';
import GestorRouteGuard from '../components/company/GestorRouteGuard';
import { GuideRoleEmpresa } from '../components/guide/GuideRole';
import HelpButton from './HelpButton';
import { useNoticeWiring } from './useNoticeWiring';
import { useLayoutAlerts } from './useLayoutAlerts';

export default function CompanyLayout() {
    const { pathname } = useLocation();
    useNoticeWiring();
    useLayoutAlerts();
    // A checagem que vivia aqui era redundante com o <ProtectedRoute> (sessao + papel +
    // onboarding, gerente incluso) — e pior: refazia getUser + get_my_companies A CADA troca de
    // rota (`[location.pathname]`). Auditoria de rede de 01/09. O guard e um so, no seam.

    return (
        <div className="worki-layout min-h-screen flex flex-col md:flex-row max-w-screen-2xl mx-auto bg-canvas">
            <SkipLink />
            <GuideRoleEmpresa />
            {/* Desktop Sidebar - Company Mode */}
            <Sidebar type="company" />

            {/* Mobile Header */}
            <header className="md:hidden sticky top-0 z-40 flex h-[var(--worki-header-h,3.5rem)] items-center justify-between gap-2 border-b-2 border-black bg-white/95 pl-4 pr-2 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md">
                <div className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-black text-xs font-bold bg-black text-white">W.</span>
                    <p className="text-lg font-bold tracking-tight text-black">Worki</p>
                    <span className="hidden min-[430px]:inline rounded-pill bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800">Empresa</span>
                </div>
                <div className="flex shrink-0 items-center">
                    <HelpButton />
                    <NotificationBell />
                </div>
            </header>

            {/* Sem `overflow` aqui: quem rola é a página, e a ActionBar (sticky) depende disso. */}
            <main id={MAIN_CONTENT_ID} tabIndex={-1} className="focus:outline-none min-w-0 flex-1 p-4 sm:p-6 md:p-8 pb-[calc(var(--worki-nav-h,0px)+1.5rem)] md:pb-8">
                <div className="hidden md:flex md:empty:hidden justify-end mb-2">
                    <HelpButton variante="linha" />
                </div>
                <CompanySwitcher className="min-[1100px]:hidden mb-4" />
                <FormerCompanyNotice />
                {/* `key` por rota: a tela nova entra com um fade curto (`worki-page-enter`, index.css). */}
                <div key={pathname} className="worki-page-enter">
                    <GestorRouteGuard>
                        <Outlet />
                    </GestorRouteGuard>
                </div>
            </main>

            <BottomNav type="company" />
        </div>
    );
}
