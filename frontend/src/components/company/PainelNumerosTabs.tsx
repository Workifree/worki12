import { Link, useLocation } from 'react-router-dom';
import { FileText, BarChart3 } from 'lucide-react';

/**
 * Pagamentos e Operação são as duas metades da mesma pergunta ("como estão meus números?"),
 * mas viviam como páginas irmãs sem parentesco visível — o usuário tinha que ADIVINHAR qual
 * respondia o quê (achado da caminhada cognitiva de 01/09; mitigado antes com links cruzados
 * em texto). Abas adjacentes resolvem na raiz: uma casa mental, duas visões, troca de um
 * toque — o padrão clássico de tabs-como-navegação para conteúdo irmão (NN/g, "Tabs, Used
 * Right": mesmas categoria e altura de hierarquia, alternância frequente).
 */
export function PainelNumerosTabs() {
    const { pathname } = useLocation();
    const abas = [
        { rotulo: 'Pagamentos', para: '/company/relatorio', Icone: FileText },
        { rotulo: 'Operação', para: '/company/operacao', Icone: BarChart3 },
    ];
    return (
        <div className="flex gap-2 mb-6 border-b-2 border-gray-200">
            {abas.map(({ rotulo, para, Icone }) => {
                const ativa = pathname === para;
                return (
                    <Link
                        key={para}
                        to={para}
                        aria-current={ativa ? 'page' : undefined}
                        className={`min-h-11 px-5 py-2 rounded-t-xl font-black uppercase text-sm inline-flex items-center gap-2 transition-all ${
                            ativa
                                ? 'bg-black text-white translate-y-[2px]'
                                : 'text-gray-400 hover:text-black hover:bg-gray-100'
                        }`}
                    >
                        <Icone size={16} /> {rotulo}
                    </Link>
                );
            })}
        </div>
    );
}
