import { Home, User, MessageSquare, PlusCircle, Users, Contact, Inbox, Briefcase, Receipt } from 'lucide-react';
import { NavLink } from 'react-router-dom';

interface BottomNavProps {
    type?: 'worker' | 'company';
}

export default function BottomNav({ type = 'worker' }: BottomNavProps) {
    // Nav push-first (pivô empresa-primeiro, jun/2026): "Vagas" (busca pública)
    // sai do bottom nav — Fase 2, ver ADR-20260630-pagamento-opcional-piloto.
    const workerNavItems = [
        { icon: Home, label: 'Início', path: '/dashboard' },
        { icon: Inbox, label: 'Turnos', path: '/my-jobs' },
        { icon: Contact, label: 'Empresas', path: '/carteira' },
        { icon: Receipt, label: 'Recebimentos', path: '/recebimentos' },
        { icon: MessageSquare, label: 'Mensagens', path: '/messages' },
        { icon: User, label: 'Perfil', path: '/profile' },
    ];

    const companyNavItems = [
        { icon: Home, label: 'Início', path: '/company/dashboard' },
        { icon: Users, label: 'Elenco', path: '/company/team' },
        { icon: PlusCircle, label: 'Criar', path: '/company/create' },
        { icon: Briefcase, label: 'Turnos', path: '/company/jobs' },
        { icon: MessageSquare, label: 'Mensagens', path: '/company/messages' },
        { icon: User, label: 'Perfil', path: '/company/profile' },
    ];

    const navItems = type === 'company' ? companyNavItems : workerNavItems;
    const isCompany = type === 'company';

    return (
        <nav aria-label="Menu de navegacao" className="md:hidden fixed bottom-0 left-0 w-full bg-white border-t-2 border-black pb-safe z-50">
            <div className="flex justify-around items-stretch h-16 px-1">
                {navItems.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        aria-label={item.label}
                        className={({ isActive }) => `
                 relative flex flex-col items-center justify-center w-full min-h-11 gap-1 py-2 px-1
                 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black
                 ${isActive
                                ? (isCompany ? 'text-blue-600' : 'text-primary')
                                : 'text-gray-500 hover:text-black'}
               `}
                    >
                        {({ isActive }) => (
                            <>
                                {/* Indicador de rota ativa: barrinha na borda superior (sutil, sem
                                    mudar a largura nem a altura do item). */}
                                <span
                                    aria-hidden="true"
                                    className={`absolute top-0 left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-b-full transition-opacity duration-150 ${isCompany ? 'bg-blue-600' : 'bg-primary'} ${isActive ? 'opacity-100' : 'opacity-0'}`}
                                />
                                <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} aria-hidden="true" />
                                {/* px-1 (em vez de p-2) libera ~4px/item — medido com Playwright: fecha o
                                    overflow horizontal do nav do worker a 320px (iPhone SE 1ª geração,
                                    o pior caso) sem reduzir a fonte de 10px em nenhum item, nos dois papéis.
                                    `truncate` (SEM `min-w-0` no link pai) é só rede de segurança: cai o
                                    texto com reticências se algum rótulo futuro/escala de fonte do SO
                                    não couber, sem alterar a distribuição no caso normal. Rótulos SEM
                                    uppercase e SEM font-black (semibold é mais estreito que bold/black):
                                    "Recebimentos" precisa caber a 390px. */}
                                <span className="text-[10px] leading-none font-semibold truncate max-w-full">
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
