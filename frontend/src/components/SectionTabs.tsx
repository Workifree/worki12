import { NavLink } from 'react-router-dom';
import { SECTION_TABS, type NavRole, type SectionId } from '../lib/navigation';

interface SectionTabsProps {
    section: SectionId;
    /** Cor da aba ativa: empresa = preto, freela = verde. */
    role?: NavRole;
    className?: string;
}

const LABELS: Record<SectionId, string> = {
    inicio: 'Seções de Início',
    elenco: 'Seções de Elenco',
    relatorios: 'Seções de Relatórios',
    empresas: 'Seções de Empresas',
};

/**
 * Abas entre páginas irmãs (são links, não estado local): uma linha, divide a largura no celular
 * para caber a 320px sem rolagem, alvo de 44px. `NavLink` aplica `aria-current="page"`.
 */
export default function SectionTabs({ section, role = 'company', className = 'mb-6' }: SectionTabsProps) {
    const activeClass = role === 'company' ? 'bg-black text-white border-black' : 'bg-primary-dark text-white border-black';
    return (
        <nav aria-label={LABELS[section]} className={`flex gap-1 sm:gap-2 border-b-2 border-black print:hidden ${className}`}>
            {SECTION_TABS[section].map((tab) => (
                <NavLink
                    key={tab.path}
                    to={tab.path}
                    end
                    className={({ isActive }) =>
                        `min-h-11 min-w-0 flex-1 sm:flex-none inline-flex items-center justify-center whitespace-nowrap rounded-t-xl border-2 border-b-0 px-2 sm:px-5 text-[13px] sm:text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black ${
                            isActive ? activeClass : 'border-transparent text-gray-600 hover:bg-gray-100 hover:text-black'
                        }`
                    }
                >
                    {tab.label}
                </NavLink>
            ))}
        </nav>
    );
}
