import { Link, useLocation } from 'react-router-dom';
import { useCurrentCompany } from '../hooks/useCurrentCompany';
import { useCompanyNavContext } from '../hooks/useCompanyNavContext';
import { getCompanyNav, getWorkerNav, isNavActive, toBottomNav } from '../lib/navigation';

interface BottomNavProps {
    type?: 'worker' | 'company';
}

/**
 * Barra inferior do celular. Altura fixa de 4rem + borda + safe-area (`--worki-nav-h`, index.css):
 * quem fica acima dela (ActionBar, avisos PWA, botão do copiloto) lê essa variável.
 * Item ativo: pílula suave atrás do ícone + rótulo em negrito; nada muda de tamanho ao trocar.
 */
export default function BottomNav({ type = 'worker' }: BottomNavProps) {
    const isCompany = type === 'company';
    const { pathname } = useLocation();
    const currentCompany = useCurrentCompany(isCompany);
    const companyNav = useCompanyNavContext(currentCompany);
    const navItems = toBottomNav(isCompany ? getCompanyNav(companyNav) : getWorkerNav());

    return (
        <nav data-bottom-nav aria-label="Menu de navegação" className="md:hidden fixed bottom-0 left-0 z-50 w-full border-t border-gray-200 bg-white pb-safe">
            <div className="flex h-16 items-stretch">
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
                 group flex min-h-11 min-w-11 flex-1 basis-0 flex-col items-center justify-center gap-1 px-px
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black
                 ${isActive
                                    ? (isCompany ? 'text-blue-700' : 'text-primary-ink')
                                    : 'text-gray-600 hover:text-black'}
               `}
                        >
                            {/* Pílula do item ativo: aparece com fade (sem mudar largura nem altura). */}
                            <span
                                aria-hidden="true"
                                className={`flex h-7 w-14 items-center justify-center rounded-pill transition-colors duration-fast ease-standard motion-reduce:transition-none group-active:bg-gray-200 ${isActive ? (isCompany ? 'bg-blue-100' : 'bg-primary-light') : 'bg-transparent'}`}
                            >
                                <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                            </span>
                            {/* Células iguais (flex-1 basis-0): 64px a 320. Abaixo de 360px o item com
                                `tinyLabel` troca o rótulo visível; `truncate` fica só como rede. */}
                            <span className={`max-w-full truncate whitespace-nowrap text-xs leading-none tracking-tighter ${isActive ? 'font-bold' : 'font-semibold'}`}>
                                {item.tinyLabel ? (
                                    <>
                                        <span aria-hidden="true" className="min-[360px]:hidden">{item.tinyLabel}</span>
                                        <span className="hidden min-[360px]:inline">{label}</span>
                                    </>
                                ) : label}
                            </span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
