import { ArrowLeft, Mail, HelpCircle } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Card, PageHeader } from '../components/ui';
import BackToGestao from '../components/company/BackToGestao';
import { getContactEmail } from '../lib/contact';

const faqs = [
    {
        q: 'Como monto meu elenco e convido para um turno?',
        a: 'Em Elenco > Meu Elenco você adiciona freelas de confiança à sua lista (por QR, código do freela ou link de perfil). Depois de aceito, ele passa a fazer parte do elenco: ao criar um turno, você convida diretamente quem já está lá, sem precisar abrir vaga pública nem esperar candidaturas.',
    },
    {
        q: 'Como o freela aceita ou recusa um convite de turno?',
        a: 'O freela recebe o convite no app e escolhe aceitar ou recusar. Se aceitar, o turno é confirmado e ele aparece em "Meus Turnos". Se recusar, o convite simplesmente fica em aberto para você chamar outra pessoa do elenco — recusar não afeta a reputação nem a nota do freela.',
    },
    {
        q: 'Como funciona a chegada e a saída no turno?',
        a: 'No dia do turno, o freela registra a chegada e a saída em "Meus Turnos". A empresa confere a presença e confirma a conclusão do turno quando o trabalho termina.',
    },
    {
        q: 'Como funciona o pagamento?',
        a: 'Neste piloto, o pagamento é combinado e feito diretamente entre empresa e freela, por PIX ou dinheiro — o valor não passa pela plataforma e não há taxa do Worki. Depois de pagar, a empresa registra o pagamento no app, e o Worki emite um recibo para os dois lados como comprovante.',
    },
    {
        q: 'Sou freela: o valor do recibo está errado ou não recebi. E agora?',
        a: 'Não confirme o recebimento. No recibo, toque em "Não recebi / valor errado": a conversa com a empresa abre com o texto pronto, e só é enviado quando você tocar em Enviar.',
    },
    {
        q: 'Sou freela: onde registro minha chegada e cadastro meu PIX?',
        a: 'A chegada fica no cartão do turno, em "Início" ou "Meus Turnos", e é liberada perto do horário de início. A chave PIX fica no seu Perfil; a empresa usa essa chave para pagar por fora.',
    },
    {
        q: 'O que é o recibo e a confirmação de recebimento?',
        a: 'Ao registrar um pagamento, o Worki gera um recibo com os detalhes do turno e do valor pago. O freela acompanha isso em "Recebimentos" e, ao abrir o recibo, pode confirmar que recebeu o pagamento — o que fecha o ciclo do turno com um comprovante para ambos os lados.',
    },
    {
        q: 'Como saio do elenco de uma empresa, ou como a empresa remove alguém?',
        a: 'O freela pode sair do elenco de uma empresa a qualquer momento em Empresas > Minhas empresas, encerrando a conexão. A empresa também pode remover um freela do elenco em Elenco > Meu Elenco. Em ambos os casos, isso não afeta turnos já combinados nem o histórico de avaliações.',
    },
];

export default function Help() {
    const navigate = useNavigate();
    // Quem veio do hub da empresa volta para ele; os demais usam o "Voltar" do histórico.
    const fromGestao = (useLocation().state as { from?: string } | null)?.from === 'gestao';
    const contactEmail = getContactEmail();

    return (
        <div className="min-h-screen bg-gray-50 px-4 py-6 sm:p-8">
            <div className="max-w-3xl mx-auto">
                {fromGestao ? <BackToGestao /> : (
                    <Button
                        variant="ghost"
                        size="md"
                        onClick={() => navigate(-1)}
                        aria-label="Voltar"
                        className="mb-4 -ml-3"
                        iconLeft={<ArrowLeft size={20} aria-hidden="true" />}
                    >
                        Voltar
                    </Button>
                )}

                <PageHeader
                    title="Ajuda"
                    subtitle="Respostas rápidas sobre elenco, turnos e pagamento."
                />

                {/* FAQ */}
                <Card as="section" aria-labelledby="faq-title" className="mb-6">
                    <h2 id="faq-title" className="text-lg font-bold mb-6 flex items-center gap-2">
                        <HelpCircle size={20} aria-hidden="true" /> Perguntas frequentes
                    </h2>
                    <div className="divide-y divide-gray-200">
                        {faqs.map((faq, i) => (
                            <div key={i} className="py-4 first:pt-0 last:pb-0">
                                <h3 className="font-bold text-sm mb-1">{faq.q}</h3>
                                <p className="text-gray-600 text-sm leading-relaxed">{faq.a}</p>
                            </div>
                        ))}
                    </div>
                </Card>

                {/* Contato — só existe quando há um canal publicado (lib/contact). */}
                {contactEmail && (
                    <Card as="section" aria-labelledby="contact-title">
                        <h2 id="contact-title" className="text-lg font-bold mb-2">Contato</h2>
                        <p className="text-gray-600 text-sm mb-4">
                            Não encontrou o que procurava? Entre em contato com nosso suporte.
                        </p>
                        <a
                            href={`mailto:${contactEmail}`}
                            className="flex items-center gap-3 min-h-11 p-3 rounded-xl border-2 border-gray-200 hover:border-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                        >
                            <Mail size={20} className="text-gray-600" aria-hidden="true" />
                            <div className="min-w-0">
                                <p className="font-bold text-sm">Email</p>
                                <p className="text-gray-600 text-xs break-all">{contactEmail}</p>
                            </div>
                        </a>
                    </Card>
                )}
            </div>
        </div>
    );
}
