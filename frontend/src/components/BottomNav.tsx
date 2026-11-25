import { Link, useLocation } from 'react-router-dom';
import { useCurrentCompany } from '../hooks/useCurrentCompany';
import { useCompanyNavContext } from '../hooks/useCompanyNavContext';
import { getCompanyNav, getWorkerNav, isNavActive, toBottomNav } from '../lib/navigation';

interface BottomNavProps {
    type?: 'worker' | 'company';
}

export default function BottomNav({ type = 'worker' }: BottomNavProps) {
    const isCompany = type === 'company';
    const { pathname } = useLocation();
    const currentCompany = useCurrentCompany(isCompany);
    const companyNav = useCompanyNavContext(currentCompany);
    const navItems = toBottomNav(isCompany ? getCompanyNav(companyNav) : getWorkerNav());

    return (
        <nav data-bottom-nav aria-label="Menu de navegação" className="md:hidden fixed bottom-0 left-0 w-full bg-white border-t-2 border-black pb-safe z-50">
            <div className="flex items-stretch h-16">
                {navItems.map((item) => {
                    const isActive = isNavActive(pathname, item);
                    const label = item.shortLabel ?? item.label;
                    return (
                        <Link
                            key={item.id}
                            to={item.path}
                            aria-label={label}
                            aria-current={isActive ? 'page' : undefined}
                            className={`
                 relative flex flex-col items-center justify-center flex-auto min-w-11 min-h-11 gap-1 py-2 px-px
                 transition-colors duration-fast active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black
                 ${isActive
                                    ? (isCompany ? 'text-blue-600' : 'text-primary')
                                    : 'text-gray-500 hover:text-black'}
               `}
                        >
                            {/* Indicador de rota ativa: barrinha na borda superior (sutil, sem
                                mudar a largura nem a altura do item). */}
                            <span
                                aria-hidden="true"
                                className={`absolute top-0 left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-b-full transition-opacity duration-150 ${isCompany ? 'bg-blue-600' : 'bg-primary'} ${isActive ? 'opacity-100' : 'opacity-0'}`}
                            />
                            <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} aria-hidden="true" />
                            {/* `truncate` é rede de segurança a 320px (iPhone SE). Rótulos sem uppercase
                                e semibold: "Recebimentos" precisa caber. */}
                            <span className="text-xs leading-none font-semibold tracking-tight truncate max-w-full">
                                {label}
                            </span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
