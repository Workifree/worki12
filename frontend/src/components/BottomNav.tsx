import { Home, User, MessageSquare, Wallet, PlusCircle, Users, Contact, Inbox } from 'lucide-react';
import { NavLink } from 'react-router-dom';

interface BottomNavProps {
    type?: 'worker' | 'company';
}

export default function BottomNav({ type = 'worker' }: BottomNavProps) {
    // Nav push-first (pivô empresa-primeiro, jun/2026): "Vagas" (busca pública)
    // sai do bottom nav — Fase 2, ver ADR-20260630-pagamento-opcional-piloto.
    const workerNavItems = [
        { icon: Home, label: 'Início', path: '/dashboard' },
        { icon: Inbox, label: 'Convites', path: '/my-jobs' },
        { icon: Contact, label: 'Clientes', path: '/carteira' },
        { icon: MessageSquare, label: 'Msgs', path: '/messages' }, // Shortened label
        { icon: User, label: 'Perfil', path: '/profile' },
    ];

    const companyNavItems = [
        { icon: Home, label: 'Início', path: '/company/dashboard' },
        { icon: Users, label: 'Elenco', path: '/company/team' },
        { icon: PlusCircle, label: 'Criar', path: '/company/create' },
        { icon: Wallet, label: 'Carteira', path: '/company/wallet' },
        { icon: User, label: 'Perfil', path: '/company/profile' },
    ];

    const navItems = type === 'company' ? companyNavItems : workerNavItems;
    const isCompany = type === 'company';

    return (
        <nav aria-label="Menu de navegacao" className={`md:hidden fixed bottom-0 left-0 w-full bg-white border-t-2 border-black pb-safe z-50 ${isCompany ? 'border-b-4 border-b-blue-600' : 'border-b-4 border-b-primary'}`}>
            <div className="flex justify-around items-center h-16 px-1">
                {navItems.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        aria-label={item.label}
                        className={({ isActive }) => `
                 flex flex-col items-center justify-center w-full h-full gap-1 p-2
                 ${isActive
                                ? (isCompany ? 'text-blue-600' : 'text-primary')
                                : 'text-gray-400 hover:text-black'}
               `}
                    >
                        {({ isActive }) => (
                            <>
                                <item.icon size={22} strokeWidth={isActive ? 3 : 2} />
                                <span className={`text-[10px] font-black uppercase ${isActive ? (isCompany ? 'text-blue-600' : 'text-primary') : 'text-gray-400'}`}>
                                    {item.label}
                                </span>
                            </>
                        )}
                    </NavLink>
                ))}
            </div>
        </nav>
    );
}
