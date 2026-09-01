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
            <header className="md:hidden flex items-center justify-between px-4 h-14 sticky top-0 bg-white/90 backdrop-blur-md z-40 border-b border-gray-200">
                <h1 className="text-xl font-black text-black tracking-tighter">Worki. <span className="text-xs text-blue-600 bg-blue-100 px-1 rounded ml-1">Business</span></h1>
                <NotificationBell />
            </header>

            {/* Main Content Area */}
            <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8 overflow-y-auto">
                <Outlet />
            </main>

            <BottomNav type="company" />
        </div>
    );
}
