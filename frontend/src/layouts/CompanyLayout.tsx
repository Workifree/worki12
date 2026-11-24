import { Link, Outlet } from 'react-router-dom';
import { UserCog } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import BottomNav from '../components/BottomNav';
import NotificationBell from '../components/NotificationBell';
import { useCurrentCompany } from '../hooks/useCurrentCompany';
import { showTeamNav } from '../services/companyScopeService';

export default function CompanyLayout() {
    // Acesso evidente a "Equipe" no celular só depois da primeira pessoa convidada (R23); antes disso
    // o dono único não é incomodado e chega por Perfil Empresa → Atalhos.
    const currentCompany = useCurrentCompany();
    const mostrarEquipe = showTeamNav(currentCompany);

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
                <div className="flex items-center gap-1">
                    {mostrarEquipe && (
                        <Link
                            to="/company/configuracoes/equipe"
                            aria-label="Equipe"
                            className="min-h-11 min-w-11 flex items-center justify-center rounded-xl border-2 border-transparent hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                        >
                            <UserCog size={22} aria-hidden="true" />
                        </Link>
                    )}
                    <NotificationBell />
                </div>
            </header>

            {/* Main Content Area */}
            <main className="flex-1 p-4 sm:p-6 md:p-8 pb-24 md:pb-8 overflow-y-auto">
                <Outlet />
            </main>

            <BottomNav type="company" />
        </div>
    );
}
