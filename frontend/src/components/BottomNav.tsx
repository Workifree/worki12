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
        { icon: Contact, label: 'Clientes', path: '/carteira' },
        { icon: Receipt, label: 'Receb.', path: '/recebimentos' }, // Shortened label ("Meus Recebimentos")
        { icon: MessageSquare, label: 'Msgs', path: '/messages' }, // Shortened label
        { icon: User, label: 'Perfil', path: '/profile' },
    ];

    const companyNavItems = [
        { icon: Home, label: 'Início', path: '/company/dashboard' },
        { icon: Users, label: 'Elenco', path: '/company/team' },
        { icon: PlusCircle, label: 'Criar', path: '/company/create' },
        { icon: Briefcase, label: 'Turnos', path: '/company/jobs' },
        { icon: MessageSquare, label: 'Msgs', path: '/company/messages' }, // Shortened label (mesmo padrão do worker)
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
                 flex flex-col items-center justify-center w-full h-full gap-1 py-2 px-1
                 ${isActive
                                ? (isCompany ? 'text-blue-600' : 'text-primary')
                                : 'text-gray-400 hover:text-black'}
               `}
                    >
                        {({ isActive }) => (
                            <>
                                <item.icon size={22} strokeWidth={isActive ? 3 : 2} />
                                {/* px-1 (em vez de p-2) libera ~4px/item — medido com Playwright: fecha o
                                    overflow horizontal do nav do worker a 320px (iPhone SE 1ª geração,
                                    o pior caso; "Convites"/8 chars era o item que estourava) sem reduzir
                                    a fonte de 10px em nenhum item, nos dois papéis.
                                    `truncate` (SEM `min-w-0` no link pai) é só rede de segurança: cai o
                                    texto com reticências se algum rótulo futuro/escala de fonte do SO
                                    não couber, mas não some com o "floor" de conteúdo do flex item, então
                                    não altera a distribuição/legibilidade no caso normal — confirmado por
                                    medição que em 320/360/375px nenhum rótulo hoje é cortado. Sem isso,
                                    o pior cenário seria a barra ganhar scroll horizontal, pior ainda numa
                                    barra fixa. */}
                                <span className={`text-[10px] font-black uppercase truncate max-w-full ${isActive ? (isCompany ? 'text-blue-600' : 'text-primary') : 'text-gray-400'}`}>
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
