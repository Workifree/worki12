import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import BottomNav from '../components/BottomNav';
import NotificationBell from '../components/NotificationBell';

export default function CompanyLayout() {
    // A checagem que vivia aqui era redundante com o <ProtectedRoute> (sessao + papel +
    // onboarding, gerente incluso) — e pior: refazia getUser + get_my_companies A CADA troca de
    // rota (`[location.pathname]`). Auditoria de rede de 01/09. O guard e um so, no seam.

    return (
        <div className="min-h-screen flex flex-col md:flex-row max-w-7xl mx-auto bg-[#F4F4F0]">
            {/* Desktop Sidebar - Company Mode */}
            <Sidebar type="company" />

            {/* Mobile Header */}
            <header className="md:hidden flex items-center justify-between px-4 h-14 sticky top-0 bg-white/90 backdrop-blur-md z-40 border-b-2 border-black">
                <p className="text-xl font-bold text-black tracking-tight">Worki. <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-pill ml-1">Business</span></p>
                <NotificationBell />
            </header>

            {/* Main Content Area */}
            <main className="flex-1 p-4 sm:p-6 md:p-8 pb-24 md:pb-8 overflow-y-auto">
                <Outlet />
            </main>

            <BottomNav type="company" />
        </div>
    );
}
