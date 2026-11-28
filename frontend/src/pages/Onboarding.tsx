import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Bell,
  Briefcase,
  CalendarCheck,
  Check,
  ChevronDown,
  Clock,
  DollarSign,
  FileSpreadsheet,
  Layers,
  Megaphone,
  MessageSquare,
  Pause,
  Play,
  QrCode,
  Receipt,
  Repeat,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import { Button, IconButton } from '../components/ui';

const STAKEHOLDERS = [
  {
    role: 'Para o Dono e Gestor',
    headline: 'Visibilidade total da operação sem microgerenciar',
    points: [
      'Acompanhe o gasto do mês frente ao seu teto de orçamento antes de estourar.',
      'Veja indicadores reais: tempo para preencher vaga, taxa de presença e motivos de falta.',
      'Aprove cada pessoa que entra na equipe antes de ela operar qualquer turno.',
    ],
  },
  {
    role: 'Para o Financeiro',
    headline: 'Fechamento da semana em minutos, sem caçar comprovante',
    points: [
      'Filtre turnos concluídos por período, loja, encarregado ou freela.',
      'Confira horas reais trabalhadas (entrada e saída) lado a lado com o valor combinado.',
      'Baixe a planilha pronta para pagar com nome, CPF, chave PIX e número do recibo.',
    ],
  },
  {
    role: 'Para o Encarregado de Loja',
    headline: 'Escala na palma da mão, sem misturar WhatsApp pessoal',
    points: [
      'Opere apenas os seus turnos pelo celular, já identificados com a sua loja.',
      'Converse com o freela direto no chat do turno e confirme quem já chegou no painel Hoje.',
      'Vai folgar ou tirar férias? Passe ou cubra turnos de outro encarregado em segundos.',
    ],
  },
  {
    role: 'Para o Freela',
    headline: 'Mais trabalho, menos espera e histórico que é seu',
    points: [
      'Receba convites no celular e no e-mail e veja avaliações da empresa antes de aceitar.',
      'Informe os dias e períodos em que está livre para ser chamado primeiro.',
      'Confirme cada recebimento e guarde histórico, notas e comprovante de renda portáteis.',
    ],
  },
];

const CAPABILITIES = [
  {
    icon: Sparkles,
    title: 'Copiloto com IA integrado',
    description:
      'Descreva a escala que precisa em português e deixe a IA montar turnos, tirar dúvidas da operação e acelerar o dia a dia sem navegar por várias telas.',
  },
  {
    icon: Layers,
    title: 'Turnos em série, em lote e modelos salvos',
    description:
      'Crie todos os sábados do mês ou um evento de vários dias de uma vez. Salve modelos prontos para repetir turnos frequentes em segundos.',
  },
  {
    icon: Megaphone,
    title: 'Chamado rápido e modo SOS de emergência',
    description:
      'Avise todo o seu Elenco de confiança de uma vez (quem aceitar primeiro garante a vaga) e acione o chamado SOS quando precisar de reforço fora da sua lista.',
  },
  {
    icon: QrCode,
    title: 'Presença comprovada no local',
    description:
      'Confirmação automática na véspera e registro de entrada e saída com QR dinâmico e GPS para eliminar discussão sobre horário trabalhado.',
  },
  {
    icon: Repeat,
    title: 'Encarregados, lojas e cobertura de folgas',
    description:
      'Separe turnos por loja para o financeiro, limite cada encarregado aos próprios turnos e ative cobertura temporária quando alguém folgar.',
  },
  {
    icon: BarChart3,
    title: 'Painel de operação e teto de gasto mensal',
    description:
      'Monitore quanto já gastou no mês contra o orçamento definido, acompanhe faltas, tempo médio de resposta e taxa de preenchimento.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Relatório financeiro e planilha de pagamento',
    description:
      'Você paga por fora (PIX ou dinheiro), registra o recibo bilateral e exporta a lista completa com horas reais, CPF e chave PIX só para o Gestor.',
  },
  {
    icon: UserCheck,
    title: 'Disponibilidade, certificações e indicações',
    description:
      'Veja quem declarou estar livre no dia, controle certificações com aviso de vencimento, acompanhe frequência semanal e troque indicações com empresas parceiras.',
  },
  {
    icon: MessageSquare,
    title: 'Chat por turno e avisos fora do app',
    description:
      'Combine detalhes dentro do próprio turno sem poluir seu WhatsApp pessoal. Convites, aceites e lembretes chegam por notificação no celular e por e-mail.',
  },
];

const COMPARISON = [
  {
    antes: 'Perder a manhã no WhatsApp chamando freela um por um quando alguém falta na abertura.',
    depois: 'Avisar todo o seu Elenco em um toque e fechar a vaga em minutos, com prazo configurável.',
  },
  {
    antes: 'Digitar a mesma escala toda semana e descobrir em cima da hora que ninguém confirmou.',
    depois: 'Criar lotes ou séries com a IA, confirmar presença na véspera e acompanhar chegadas no painel Hoje.',
  },
  {
    antes: 'Gastar horas juntando print de conversa, chave PIX e diária em planilha manual.',
    depois: 'Baixar a planilha pronta para o financeiro, filtrada por loja, encarregado e período.',
  },
  {
    antes: 'Encarregados sem ferramenta ou acessando dados financeiros que deveriam ficar só com o Gestor.',
    depois: 'Cada encarregado opera os próprios turnos com cobertura de folgas; financeiro fica restrito ao Gestor.',
  },
];

const FAQ_ITEMS = [
  {
    q: 'O Workyn cobra mensalidade ou comissão sobre o valor do freela?',
    a: 'Você começa grátis. O pagamento da diária continua sendo feito direto por você ao profissional (PIX ou dinheiro), enquanto o Workyn organiza a escala, a presença, os recibos e o fechamento do financeiro.',
  },
  {
    q: 'O que o Copiloto com IA consegue fazer na prática?',
    a: 'Ele ajuda a criar turnos e lotes a partir de instruções simples em português, responde dúvidas sobre a sua operação e reduz o tempo gasto montando escalas repetitivas.',
  },
  {
    q: 'Preciso contratar desconhecidos ou posso usar meus próprios freelas?',
    a: 'Você trabalha com quem já conhece. Basta enviar o link do seu Elenco para os freelas que já atendem sua empresa, organizar por listas de função e chamar direto. Quando precisar de emergência, o modo SOS também está disponível.',
  },
  {
    q: 'Funciona para empresas com vários encarregados ou mais de uma loja?',
    a: 'Sim. Cada encarregado acessa apenas os próprios turnos, já vinculados à sua loja, com opção de cobertura em folgas e férias. O Gestor acompanha toda a operação e o financeiro consolidados.',
  },
  {
    q: 'Como o Workyn ajuda a controlar a recorrência de um mesmo freela?',
    a: 'Na hora de chamar um profissional, o Workyn mostra quantas vezes ele já trabalhou na semana na sua empresa para você distribuir os turnos com segurança.',
  },
  {
    q: 'O freela precisa baixar aplicativo na loja do celular?',
    a: 'Funciona direto no navegador do celular e pode ser salvo na Tela de Início como app, com notificações no aparelho e avisos por e-mail.',
  },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [marqueePaused, setMarqueePaused] = useState(false);

  return (
    <div className="min-h-screen bg-canvas font-sans text-accent flex flex-col overflow-x-hidden">
      <PageMeta
        title="Escala de freelas com IA, controle de presença e fechamento de diárias"
        description="Nunca mais perca a abertura da loja por falta de freela. Monte escalas com IA, chame sua equipe de confiança em segundos, comprove presença no local e feche o financeiro sem planilha manual."
      />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-canvas/95 backdrop-blur-md border-b-2 border-black">
        <nav
          aria-label="Navegação principal"
          className="max-w-7xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 md:px-10 py-3"
        >
          <a
            href="/"
            className="inline-flex items-center gap-2.5 min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black rounded-lg"
          >
            <img
              src="/favicon.svg"
              alt=""
              width={34}
              height={34}
              className="w-8 h-8 border-2 border-black rounded-lg shadow-[2px_2px_0_0_#000] bg-white"
            />
            <span className="text-2xl font-black tracking-tight">Workyn.</span>
          </a>

          <div className="hidden md:flex items-center gap-7 text-sm font-bold text-gray-700">
            <a href="#copiloto" className="hover:text-black transition-colors">
              IA na escala
            </a>
            <a href="#para-quem" className="hover:text-black transition-colors">
              Para sua equipe
            </a>
            <a href="#beneficios" className="hover:text-black transition-colors">
              Recursos
            </a>
            <a href="#duvidas" className="hover:text-black transition-colors">
              Dúvidas
            </a>
          </div>

          <div className="flex items-center gap-2.5">
            <Button variant="secondary" size="md" onClick={() => navigate('/login')}>
              Entrar
            </Button>
            <Button
              variant="dark"
              size="md"
              onClick={() => navigate('/login?type=hire&cadastro=1')}
              className="hidden sm:inline-flex"
            >
              Começar grátis
            </Button>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section
          className="relative px-4 sm:px-6 md:px-10 pt-10 pb-16 md:pt-16 md:pb-24"
          style={{
            backgroundImage: 'radial-gradient(rgba(17,17,17,0.07) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        >
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Esquerda: Proposta de Valor WIIFM */}
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border-2 border-black bg-white px-3.5 py-1.5 text-xs font-bold tracking-wide shadow-brutal-xs">
                <Sparkles size={14} className="text-primary" aria-hidden="true" />
                <span>Gestão de freelas com IA para restaurantes, bares e eventos</span>
              </div>

              <h1 className="text-4xl sm:text-5xl md:text-[3.4rem] font-black leading-[1.04] tracking-tight text-accent">
                Nunca mais perca a abertura da loja por{' '}
                <span className="text-primary">falta de freela.</span>
              </h1>

              <p className="text-base sm:text-lg md:text-xl text-gray-700 max-w-2xl leading-relaxed">
                Monte escalas da semana com ajuda da IA, chame sua equipe de confiança em segundos,
                acompanhe a presença real em cada loja e feche o financeiro sem juntar conversa de
                WhatsApp.
              </p>

              {/* 3 Ganhos Reais (WIIFM) */}
              <ul className="space-y-3 pt-1 max-w-xl">
                <li className="flex items-start gap-3 text-sm sm:text-base text-gray-800">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-black bg-[#D7F5E4] text-primary">
                    <Check size={14} strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span>
                    <strong className="text-accent">Feche faltas em minutos:</strong> avise todo o
                    seu time de confiança de uma vez ou acione o reforço SOS quando apertar.
                  </span>
                </li>
                <li className="flex items-start gap-3 text-sm sm:text-base text-gray-800">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-black bg-[#D7F5E4] text-primary">
                    <Check size={14} strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span>
                    <strong className="text-accent">Delegue com controle real:</strong> cada
                    encarregado toca a própria loja enquanto você acompanha gasto, presença e
                    indicadores.
                  </span>
                </li>
                <li className="flex items-start gap-3 text-sm sm:text-base text-gray-800">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-black bg-[#D7F5E4] text-primary">
                    <Check size={14} strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span>
                    <strong className="text-accent">Segurança para os dois lados:</strong> horas
                    comprovadas no local, recibo registrado e histórico portátil para o freela.
                  </span>
                </li>
              </ul>
            </div>

            {/* Direita: Cartões de Entrada Padrão (sem sombras coloridas) */}
            <div className="lg:col-span-5 grid gap-5 w-full">
              {/* Card Empresa */}
              <button
                type="button"
                data-copilot="publico.entrada.escolher-empresa"
                onClick={() => navigate('/login?type=hire&cadastro=1')}
                className="group relative bg-accent text-white border-2 border-black rounded-2xl p-6 sm:p-7 text-left shadow-brutal transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
              >
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="w-11 h-11 bg-white/10 text-white rounded-xl flex items-center justify-center border-2 border-white/80">
                    <Briefcase size={22} strokeWidth={2.5} aria-hidden="true" />
                  </div>
                  <span className="bg-white/15 text-white border border-white/25 text-xs font-bold px-3 py-1 rounded-full">
                    Para empresas
                  </span>
                </div>
                <h2 className="text-2xl font-black tracking-tight mb-1.5">Quero contratar</h2>
                <p className="text-gray-300 text-sm leading-relaxed">
                  Organize seus freelas de confiança, monte escalas com IA, delegue para
                  encarregados e feche os pagamentos da semana sem planilha manual.
                </p>
                <span className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-white bg-white px-4 text-sm font-bold text-black group-hover:bg-gray-100 transition-colors">
                  Criar conta de empresa <ArrowRight size={17} aria-hidden="true" />
                </span>
              </button>

              {/* Card Freela */}
              <button
                type="button"
                data-copilot="publico.entrada.escolher-freela"
                onClick={() => navigate('/login?type=work&cadastro=1')}
                className="group relative bg-white text-accent border-2 border-black rounded-2xl p-6 sm:p-7 text-left shadow-brutal transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
              >
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="w-11 h-11 bg-[#D7F5E4] text-primary rounded-xl flex items-center justify-center border-2 border-black">
                    <DollarSign size={22} strokeWidth={2.5} aria-hidden="true" />
                  </div>
                  <span className="bg-[#D7F5E4] text-primary border border-primary/30 text-xs font-bold px-3 py-1 rounded-full">
                    Para freelas
                  </span>
                </div>
                <h2 className="text-2xl font-black tracking-tight mb-1.5">Quero trabalhar</h2>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Receba convites de empresas que já confiam no seu trabalho, informe quando está
                  livre e guarde avaliações e comprovantes de renda que são seus.
                </p>
                <span className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-black bg-primary px-4 text-sm font-bold text-white group-hover:bg-black transition-colors">
                  Criar conta de freela <ArrowRight size={17} aria-hidden="true" />
                </span>
              </button>
            </div>
          </div>
        </section>

        {/* Faixa de marca */}
        <div className="relative flex w-full items-center bg-accent border-y-2 border-black">
          <div className="min-w-0 flex-1 overflow-hidden py-3" aria-hidden="true">
            <div
              data-paused={marqueePaused}
              className="whitespace-nowrap animate-marquee flex gap-8 text-white font-bold text-xs sm:text-sm uppercase tracking-widest"
            >
              {Array(14)
                .fill(
                  'WORKYN • COPILOTO COM IA • ESCALA EM LOTE E SÉRIE • PRESENÇA COMPROVADA • ENCARREGADOS POR LOJA • CONTROLE DE GASTO • RECIBO PORTÁTIL • ',
                )
                .map((text, i) => (
                  <span key={i}>{text}</span>
                ))}
            </div>
          </div>
          <IconButton
            aria-label={marqueePaused ? 'Retomar letreiro' : 'Pausar letreiro'}
            onClick={() => setMarqueePaused((paused) => !paused)}
            className="mr-2 text-white enabled:hover:bg-white/15 enabled:active:bg-white/25 focus-visible:ring-white focus-visible:ring-offset-0 motion-reduce:hidden"
          >
            {marqueePaused ? <Play size={18} /> : <Pause size={18} />}
          </IconButton>
        </div>

        {/* Destaque do Copiloto com IA (Show, Don't Tell) */}
        <section id="copiloto" className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-white border-b-2 border-black">
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-6 space-y-5">
              <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-black bg-[#D7F5E4] text-primary px-3.5 py-1 text-xs font-bold uppercase tracking-wider">
                <Sparkles size={13} aria-hidden="true" /> Copiloto com IA
              </span>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-accent">
                Peça em português e monte a escala da semana em segundos
              </h2>
              <p className="text-base sm:text-lg text-gray-600 leading-relaxed">
                Quem toca salão e cozinha não tem tempo para preencher o mesmo formulário vinte
                vezes. O Copiloto do Workyn entende o que você precisa, prepara turnos avulsos ou em
                lote e guia sua equipe dentro do próprio app.
              </p>
              <ul className="space-y-2.5 text-sm sm:text-base text-gray-800 pt-1">
                <li className="flex items-start gap-2.5">
                  <Check size={18} className="text-primary shrink-0 mt-0.5" strokeWidth={2.5} aria-hidden="true" />
                  <span>Crie escalas de fim de semana ou eventos de vários dias com uma frase.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={18} className="text-primary shrink-0 mt-0.5" strokeWidth={2.5} aria-hidden="true" />
                  <span>Salve modelos prontos para repetir turnos frequentes em um toque.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check size={18} className="text-primary shrink-0 mt-0.5" strokeWidth={2.5} aria-hidden="true" />
                  <span>Tire dúvidas da operação e encontre relatórios sem procurar em menus.</span>
                </li>
              </ul>
            </div>

            {/* Simulação visual limpa do Copiloto (no estilo do app) */}
            <div className="lg:col-span-6">
              <div className="rounded-2xl border-2 border-black bg-canvas p-5 sm:p-6 shadow-brutal space-y-4">
                <div className="flex items-center justify-between border-b-2 border-black/15 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-black bg-accent text-white">
                      <Sparkles size={16} aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-sm font-black text-accent">Copiloto Workyn</p>
                      <p className="text-xs text-gray-600">Assistente da operação</p>
                    </div>
                  </div>
                  <span className="rounded-full border border-black/20 bg-white px-2.5 py-0.5 text-[11px] font-bold text-gray-700">
                    No celular e no PC
                  </span>
                </div>

                {/* Mensagem do gestor */}
                <div className="ml-auto max-w-[88%] rounded-2xl rounded-tr-sm border-2 border-black bg-accent p-3.5 text-sm text-white">
                  &ldquo;Preciso de 2 garçons na sexta e no sábado às 18h na Loja Centro, R$ 150 a
                  diária, chamando a lista Salão.&rdquo;
                </div>

                {/* Resposta estruturada do Copiloto */}
                <div className="max-w-[92%] rounded-2xl rounded-tl-sm border-2 border-black bg-white p-4 space-y-3">
                  <p className="text-sm font-bold text-accent">
                    Pronto. Montei o lote com 2 turnos e 4 vagas na Loja Centro:
                  </p>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between rounded-xl border border-black/15 bg-canvas px-3 py-2">
                      <span className="font-bold">Sexta · 18:00 · Garçom (2 vagas)</span>
                      <span className="font-extrabold text-primary">R$ 150/pessoa</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-black/15 bg-canvas px-3 py-2">
                      <span className="font-bold">Sábado · 18:00 · Garçom (2 vagas)</span>
                      <span className="font-extrabold text-primary">R$ 150/pessoa</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600">
                    Lista <strong>Salão</strong> selecionada · Convite aberto até 1h antes do turno.
                    Só confirmar para disparar.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Multi-Stakeholder WIIFM: O que cada papel ganha */}
        <section id="para-quem" className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-canvas border-b-2 border-black">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-3xl mb-12">
              <span className="inline-block rounded-full border-2 border-black bg-white text-accent px-3.5 py-1 text-xs font-bold uppercase tracking-wider mb-3 shadow-brutal-xs">
                O que cada pessoa ganha
              </span>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-accent">
                Uma ferramenta pensada para quem decide, quem paga, quem opera e quem trabalha
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {STAKEHOLDERS.map((s) => (
                <div
                  key={s.role}
                  className="rounded-2xl border-2 border-black bg-white p-6 sm:p-7 shadow-brutal flex flex-col gap-4"
                >
                  <div>
                    <span className="inline-block rounded-full border border-black/20 bg-canvas px-3 py-0.5 text-xs font-bold text-gray-700 mb-2">
                      {s.role}
                    </span>
                    <h3 className="text-xl font-black tracking-tight text-accent">{s.headline}</h3>
                  </div>
                  <ul className="space-y-2.5 text-sm sm:text-[15px] text-gray-700">
                    {s.points.map((pt) => (
                      <li key={pt} className="flex items-start gap-2.5">
                        <Check
                          size={16}
                          strokeWidth={3}
                          className="text-primary shrink-0 mt-1"
                          aria-hidden="true"
                        />
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Antes x Depois */}
        <section className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-white border-b-2 border-black">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-3xl mb-12">
              <span className="inline-block rounded-full border-2 border-black bg-canvas text-accent px-3.5 py-1 text-xs font-bold uppercase tracking-wider mb-3">
                Na prática
              </span>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-accent">
                O que muda já na primeira semana usando o Workyn
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {COMPARISON.map((row, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border-2 border-black bg-canvas p-6 shadow-brutal flex flex-col gap-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 border-black bg-white text-red-600">
                      <X size={15} strokeWidth={3} aria-hidden="true" />
                    </span>
                    <p className="text-sm text-gray-600 leading-relaxed">{row.antes}</p>
                  </div>
                  <div className="border-t-2 border-black/15 pt-4 flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 border-black bg-primary text-white">
                      <Check size={15} strokeWidth={3} aria-hidden="true" />
                    </span>
                    <p className="text-sm sm:text-base font-bold text-accent leading-relaxed">
                      {row.depois}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 9 Capacidades Reais Completas */}
        <section id="beneficios" className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-canvas border-b-2 border-black">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-3xl mb-12">
              <span className="inline-block rounded-full border-2 border-black bg-[#D7F5E4] text-primary px-3.5 py-1 text-xs font-bold uppercase tracking-wider mb-3">
                Tudo no mesmo sistema
              </span>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-accent">
                Muito além de planilha: sua operação inteira de freelas em um só lugar
              </h2>
              <p className="mt-3 text-base sm:text-lg text-gray-700">
                Da criação da escala com IA até a prestação de contas no fim do mês, cada detalhe foi
                construído para o ritmo real de loja e evento.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {CAPABILITIES.map((item) => {
                const Icon = item.icon;
                return (
                  <article
                    key={item.title}
                    className="rounded-2xl border-2 border-black bg-white p-6 shadow-brutal transition-transform hover:-translate-y-0.5 flex flex-col"
                  >
                    <div className="w-11 h-11 rounded-xl border-2 border-black bg-canvas text-accent flex items-center justify-center mb-4">
                      <Icon size={22} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <h3 className="text-lg font-extrabold tracking-tight text-accent mb-2">
                      {item.title}
                    </h3>
                    <p className="text-sm sm:text-[15px] text-gray-600 leading-relaxed">
                      {item.description}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* Como Funciona */}
        <section id="como-funciona" className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-white border-b-2 border-black">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-2xl mx-auto mb-12">
              <span className="inline-block rounded-full border-2 border-black bg-canvas text-accent px-3.5 py-1 text-xs font-bold uppercase tracking-wider mb-3">
                Em 3 passos
              </span>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-accent">
                Simples para o dono, justo para o freela
              </h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="rounded-2xl border-2 border-black bg-canvas p-6 sm:p-8 shadow-brutal">
                <div className="flex items-center justify-between gap-2 mb-7 pb-4 border-b-2 border-black/15">
                  <h3 className="text-xl font-black flex items-center gap-2.5 text-accent">
                    <Briefcase size={22} strokeWidth={2.5} aria-hidden="true" />
                    Para empresas
                  </h3>
                  <span className="rounded-full border-2 border-black bg-white text-accent px-3 py-0.5 text-xs font-bold">
                    Gestor e Encarregado
                  </span>
                </div>
                <ol className="space-y-6">
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-accent text-white border-2 border-black rounded-xl flex items-center justify-center">
                      <UserPlus size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-accent">1. Traga seu time de confiança</p>
                      <p className="text-sm text-gray-600 mt-0.5 leading-relaxed">
                        Envie um link único para os freelas com quem você já trabalha e separe em
                        listas por função.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-accent text-white border-2 border-black rounded-xl flex items-center justify-center">
                      <CalendarCheck size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-accent">
                        2. Monte turnos com IA e confirme presença
                      </p>
                      <p className="text-sm text-gray-600 mt-0.5 leading-relaxed">
                        Abra turnos avulsos, em lote ou em série, receba confirmação na véspera e
                        registre chegada e saída no local.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-accent text-white border-2 border-black rounded-xl flex items-center justify-center">
                      <Receipt size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-accent">
                        3. Acompanhe indicadores e feche o caixa
                      </p>
                      <p className="text-sm text-gray-600 mt-0.5 leading-relaxed">
                        Veja o gasto frente ao teto do mês, pague por fora (PIX ou dinheiro) e baixe
                        o relatório pronto por loja e encarregado.
                      </p>
                    </div>
                  </li>
                </ol>
              </div>

              <div className="rounded-2xl border-2 border-black bg-accent text-white p-6 sm:p-8 shadow-brutal">
                <div className="flex items-center justify-between gap-2 mb-7 pb-4 border-b-2 border-white/15">
                  <h3 className="text-xl font-black flex items-center gap-2.5 text-[#5EF0A3]">
                    <Users size={22} strokeWidth={2.5} aria-hidden="true" />
                    Para freelas
                  </h3>
                  <span className="rounded-full border border-white/30 bg-white/10 text-white px-3 py-0.5 text-xs font-bold">
                    Sua carreira
                  </span>
                </div>
                <ol className="space-y-6">
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-primary text-white border-2 border-white/90 rounded-xl flex items-center justify-center">
                      <Clock size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-white">1. Aceite o turno em um toque</p>
                      <p className="text-sm text-gray-300 mt-0.5 leading-relaxed">
                        Informe os dias em que está livre, receba aviso no celular e no e-mail e
                        garanta seu turno antes que acabe.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-primary text-white border-2 border-white/90 rounded-xl flex items-center justify-center">
                      <Bell size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-white">
                        2. Comprove presença e combine no chat
                      </p>
                      <p className="text-sm text-gray-300 mt-0.5 leading-relaxed">
                        Converse direto sobre o turno e registre entrada e saída no local para
                        deixar suas horas documentadas.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-primary text-white border-2 border-white/90 rounded-xl flex items-center justify-center">
                      <DollarSign size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-white">
                        3. Guarde recibos, certificações e reputação
                      </p>
                      <p className="text-sm text-gray-300 mt-0.5 leading-relaxed">
                        Confirme cada pagamento recebido e leve seu histórico, avaliações e
                        comprovantes de renda com você.
                      </p>
                    </div>
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="duvidas" className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-canvas border-b-2 border-black">
          <div className="max-w-4xl mx-auto">
            <div className="mb-10">
              <span className="inline-block rounded-full border-2 border-black bg-white px-3.5 py-1 text-xs font-bold uppercase tracking-wider mb-3 shadow-brutal-xs">
                Perguntas frequentes
              </span>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-accent">
                Dúvidas antes de começar
              </h2>
            </div>

            <div className="space-y-4">
              {FAQ_ITEMS.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-2xl border-2 border-black bg-white shadow-brutal-sm"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 font-extrabold text-base sm:text-lg text-accent">
                    <span>{item.q}</span>
                    <ChevronDown
                      size={20}
                      className="shrink-0 text-gray-600 transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="px-5 pb-5 pt-0 text-sm sm:text-base text-gray-600 leading-relaxed border-t border-black/10">
                    <p className="pt-3">{item.a}</p>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Final (botões 100% padrão, sem sombra colorida) */}
        <section className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-accent text-white text-center border-b-2 border-black">
          <div className="max-w-3xl mx-auto space-y-6">
            <span className="inline-block rounded-full border border-white/25 bg-white/10 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-[#5EF0A3]">
              Cadastro gratuito
            </span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight leading-tight">
              Coloque sua escala de freelas em ordem hoje
            </h2>
            <p className="text-base sm:text-lg text-gray-300 max-w-xl mx-auto leading-relaxed">
              Leva menos de 2 minutos para criar a conta, convidar seu time de confiança e abrir o
              primeiro turno pelo celular.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
              <Button
                variant="primary"
                size="lg"
                onClick={() => navigate('/login?type=hire&cadastro=1')}
              >
                Criar conta de empresa
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => navigate('/login?type=work&cadastro=1')}
              >
                Criar conta de freela
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="px-4 sm:px-6 md:px-10 py-10 bg-canvas text-accent">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-center md:text-left">
            <p className="text-xl font-black tracking-tight">Workyn.</p>
            <p className="text-xs text-gray-600 mt-1">
              &copy; {new Date().getFullYear()} Workyn. Escala de freelas com IA, presença e
              pagamentos organizados.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-x-2 gap-y-1 text-sm font-bold">
            <button
              type="button"
              onClick={() => navigate('/sobre')}
              className="min-h-11 px-3 text-gray-700 hover:text-black transition-colors"
            >
              Sobre
            </button>
            <button
              type="button"
              onClick={() => navigate('/termos')}
              className="min-h-11 px-3 text-gray-700 hover:text-black transition-colors"
            >
              Termos de Uso
            </button>
            <button
              type="button"
              onClick={() => navigate('/privacidade')}
              className="min-h-11 px-3 text-gray-700 hover:text-black transition-colors"
            >
              Privacidade
            </button>
            <button
              type="button"
              onClick={() => navigate('/licencas')}
              className="min-h-11 px-3 text-gray-700 hover:text-black transition-colors"
            >
              Licenças
            </button>
            <button
              type="button"
              onClick={() => navigate('/ajuda')}
              className="min-h-11 px-3 text-gray-700 hover:text-black transition-colors"
            >
              Ajuda
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
