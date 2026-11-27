import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, LogOut } from 'lucide-react';
import PageMeta from '../../components/PageMeta';
import { Button, PageHeader } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useCurrentCompanyState } from '../../hooks/useCurrentCompany';
import { useBonusTrailAccess } from '../../hooks/useBonusTrailAccess';
import { isGestor } from '../../services/companyScopeService';
import { getGestaoGroups } from '../../lib/navigation';
import { isPresencaEnabled } from '../../lib/features';
import { logError } from '../../lib/logger';

/** Hub "Gestão" (rota /company/gestao): tudo o que não é operação do dia. */
export default function CompanyGestao() {
    const { company, resolved, error } = useCurrentCompanyState();
    const hasTrail = useBonusTrailAccess();
    const { signOut } = useAuth();
    const { addToast } = useToast();
    const navigate = useNavigate();
    const [loggingOut, setLoggingOut] = useState(false);

    const handleLogout = async () => {
        setLoggingOut(true);
        try {
            await signOut();
            navigate('/login');
        } catch (err) {
            logError('CompanyGestao.handleLogout', err);
            addToast('Não foi possível sair. Tente novamente.', 'error');
            setLoggingOut(false);
        }
    };

    const gestorView = isGestor(company);
    const hubTitle = gestorView ? 'Gestão' : 'Mais';
    const hubSubtitle = gestorView ? 'Pessoas, dados da empresa e suporte.' : 'Relatórios e ajuda';

    const groups = getGestaoGroups({
        gestor: isGestor(company),
        teamInvited: company?.team_enabled === true,
        trail: hasTrail,
        sites: isPresencaEnabled(),
    });

    return (
        <div className="mx-auto max-w-4xl pb-6">
            <PageMeta title={hubTitle} description={hubSubtitle} />
            <PageHeader title={hubTitle} subtitle={hubSubtitle} />

            {error && (
                <p role="alert" className="mb-4 rounded-xl border-2 border-black bg-yellow-50 p-3 text-sm font-semibold">
                    Não foi possível carregar os dados da empresa. Recarregue a página para ver todas as opções.
                </p>
            )}

            {!resolved ? (
                <div className="space-y-4" role="status" aria-label="Carregando as opções">
                    <div className="h-24 animate-pulse rounded-xl bg-gray-200" role="status"><span className="sr-only">Carregando</span></div>
                    <div className="h-24 animate-pulse rounded-xl bg-gray-200" role="status"><span className="sr-only">Carregando</span></div>
                </div>
            ) : (
                <div className="space-y-8">
                    {groups.map((group) => (
                        <section
                            key={group.id}
                            aria-labelledby={`gestao-${group.id}`}
                            className={group.cards.every((c) => c.mobileOnly) ? 'md:hidden' : undefined}
                        >
                            <h2 id={`gestao-${group.id}`} className="mb-3 text-lg font-bold">{group.label}</h2>
                            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                {group.cards.map((card) => (
                                    <li key={card.id} className={card.mobileOnly ? 'md:hidden' : undefined}>
                                        <Link
                                            to={card.path}
                                            state={{ from: 'gestao' }}
                                            className="flex h-full min-h-24 items-center gap-4 rounded-2xl border-2 border-black bg-white p-5 transition-all duration-150 motion-reduce:transition-none motion-reduce:transform-none hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
                                        >
                                            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 border-black bg-gray-100">
                                                <card.icon size={22} aria-hidden="true" />
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block font-bold">{card.title}</span>
                                                <span className="block text-sm text-gray-600">{card.description}</span>
                                            </span>
                                            <ChevronRight size={18} aria-hidden="true" className="shrink-0" />
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </div>
            )}

            {/* No celular não há lateral: é por aqui que se sai (o encarregado não abre o perfil). */}
            <Button
                variant="ghost"
                fullWidth
                onClick={() => { void handleLogout(); }}
                loading={loggingOut}
                iconLeft={<LogOut size={16} aria-hidden="true" />}
                className="mt-8 text-red-600 enabled:hover:bg-red-50 md:hidden"
            >
                Sair
            </Button>
        </div>
    );
}
