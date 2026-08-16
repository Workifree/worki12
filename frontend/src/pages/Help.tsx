import { ArrowLeft, Mail, HelpCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const faqs = [
    {
        q: 'Como monto meu elenco e convido para um turno?',
        a: 'Em Meu Elenco você adiciona freelas de confiança à sua lista (por QR, Worki ID ou link de perfil). Depois de aceito, ele passa a fazer parte do elenco: ao criar um turno, você convida diretamente quem já está lá, sem precisar abrir vaga pública nem esperar candidaturas.',
    },
    {
        q: 'Como o freela aceita ou recusa um convite de turno?',
        a: 'O freela recebe o convite no app e escolhe aceitar ou recusar. Se aceitar, o turno é confirmado e ele aparece em "Meus Turnos". Se recusar, o convite simplesmente fica em aberto para você chamar outra pessoa do elenco — recusar não afeta a reputação nem a nota do freela.',
    },
    {
        q: 'Como funciona a chegada e a saída no turno?',
        a: 'No dia do turno, o freela faz check-in ao chegar e check-out ao sair, direto pelo app. A empresa confere a presença e confirma a conclusão do turno quando o trabalho termina.',
    },
    {
        q: 'Como funciona o pagamento?',
        a: 'Neste piloto, o pagamento é combinado e feito diretamente entre empresa e freela, por PIX ou dinheiro — o valor não passa pela plataforma e não há taxa do Worki. Depois de pagar, a empresa registra o pagamento no app, e o Worki emite um recibo para os dois lados como comprovante.',
    },
    {
        q: 'O que é o recibo e a confirmação de recebimento?',
        a: 'Ao registrar um pagamento, o Worki gera um recibo com os detalhes do turno e do valor pago. O freela é notificado e pode confirmar que recebeu o pagamento, o que fecha o ciclo do turno com um comprovante para ambos os lados.',
    },
    {
        q: 'Como saio do elenco de uma empresa, ou como a empresa remove alguém?',
        a: 'O freela pode sair do elenco de uma empresa a qualquer momento pela Carteira de Clientes, encerrando a conexão. A empresa também pode remover um freela do elenco pela tela Meu Elenco. Em ambos os casos, isso não afeta turnos já combinados nem o histórico de avaliações.',
    },
];

export default function Help() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-3xl mx-auto">
                <div className="flex items-center gap-4 mb-8">
                    <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-200 rounded-lg">
                        <ArrowLeft size={20} />
                    </button>
                    <HelpCircle size={28} className="text-black" />
                    <h1 className="text-3xl font-black uppercase">Ajuda</h1>
                </div>

                {/* FAQ */}
                <div className="bg-white border-2 border-black rounded-2xl p-6 mb-8">
                    <h2 className="text-xl font-black uppercase mb-6">Perguntas Frequentes</h2>
                    <div className="space-y-6">
                        {faqs.map((faq, i) => (
                            <div key={i}>
                                <h3 className="font-bold text-sm uppercase mb-1">{faq.q}</h3>
                                <p className="text-gray-600 text-sm">{faq.a}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Contact */}
                <div className="bg-white border-2 border-black rounded-2xl p-6">
                    <h2 className="text-xl font-black uppercase mb-4">Contato</h2>
                    <p className="text-gray-600 text-sm mb-4">
                        Não encontrou o que procurava? Entre em contato com nosso suporte.
                    </p>
                    <div className="space-y-3">
                        <a
                            href="mailto:suporte@worki.com.br"
                            className="flex items-center gap-3 p-3 rounded-xl border-2 border-gray-200 hover:border-black transition-colors"
                        >
                            <Mail size={20} className="text-gray-600" />
                            <div>
                                <p className="font-bold text-sm">Email</p>
                                <p className="text-gray-500 text-xs">suporte@worki.com.br</p>
                            </div>
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}
