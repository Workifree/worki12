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
    icon: BarChart3,
    headerBg: 'bg-blue-50',
    badgeClass: 'bg-blue-600 text-white',
    iconBg: 'bg-blue-600 text-white',
    checkColor: 'text-blue-600',
    headline: 'Visibilidade total da operação sem microgerenciar',
    points: [
      'Acompanhe o gasto do mês frente ao seu teto de orçamento antes de estourar.',
      'Veja indicadores reais: tempo para preencher vaga, taxa de presença e motivos de falta.',
      'Aprove cada pessoa que entra na equipe antes de ela operar qualquer turno.',
    ],
  },
  {
    role: 'Para o Financeiro',
    icon: FileSpreadsheet,
    headerBg: 'bg-emerald-50',
    badgeClass: 'bg-emerald-600 text-white',
    iconBg: 'bg-emerald-600 text-white',
    checkColor: 'text-emerald-600',
    headline: 'Fechamento da semana em minutos, sem caçar comprovante',
    points: [
      'Filtre turnos concluídos por período, loja, encarregado ou freela.',
      'Confira horas reais trabalhadas (entrada e saída) lado a lado com o valor combinado.',
      'Baixe a planilha pronta para pagar com nome, CPF, chave PIX e número do recibo.',
    ],
  },
  {
    role: 'Para o Encarregado de Loja',
    icon: Repeat,
    headerBg: 'bg-indigo-50',
    badgeClass: 'bg-indigo-600 text-white',
    iconBg: 'bg-indigo-600 text-white',
    checkColor: 'text-indigo-600',
    headline: 'Escala na palma da mão, sem misturar WhatsApp pessoal',
    points: [
      'Opere apenas os seus turnos pelo celular, já identificados com a sua loja.',
      'Converse com o freela direto no chat do turno e confirme quem já chegou no painel Hoje.',
      'Vai folgar ou tirar férias? Passe ou cubra turnos de outro encarregado em segundos.',
    ],
  },
  {
    role: 'Para o Freela',
    icon: Users,
    headerBg: 'bg-teal-50',
    badgeClass: 'bg-teal-600 text-white',
    iconBg: 'bg-teal-600 text-white',
    checkColor: 'text-teal-600',
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
    iconStyle: 'bg-violet-600 text-white',
    tag: 'Inteligência Artificial',
    tagStyle: 'text-violet-700 bg-violet-50',
    title: 'Copiloto com IA integrado',
    description:
      'Descreva a escala que precisa em português e deixe a IA montar turnos, tirar dúvidas da operação e acelerar o dia a dia sem navegar por várias telas.',
  },
  {
    icon: Layers,
    iconStyle: 'bg-blue-600 text-white',
    tag: 'Escala rápida',
    tagStyle: 'text-blue-700 bg-blue-50',
    title: 'Turnos em série, em lote e modelos salvos',
    description:
      'Crie todos os sábados do mês ou um evento de vários dias de uma vez. Salve modelos prontos para repetir turnos frequentes em segundos.',
  },
  {
    icon: Megaphone,
    iconStyle: 'bg-orange-600 text-white',
    tag: 'Zero furo',
    tagStyle: 'text-orange-700 bg-orange-50',
    title: 'Chamado rápido e modo SOS de emergência',
    description:
      'Avise todo o seu Elenco de confiança de uma vez (quem aceitar primeiro garante a vaga) e acione o chamado SOS quando precisar de reforço fora da sua lista.',
  },
  {
    icon: QrCode,
    iconStyle: 'bg-emerald-600 text-white',
    tag: 'Presença real',
    tagStyle: 'text-emerald-700 bg-emerald-50',
    title: 'Presença comprovada no local',
    description:
      'Confirmação automática na véspera e registro de entrada e saída com QR dinâmico e GPS para eliminar discussão sobre horário trabalhado.',
  },
  {
    icon: Repeat,
    iconStyle: 'bg-indigo-600 text-white',
    tag: 'Multi-lojas',
    tagStyle: 'text-indigo-700 bg-indigo-50',
    title: 'Encarregados, lojas e cobertura de folgas',
    description:
      'Separe turnos por loja para o financeiro, limite cada encarregado aos próprios turnos e ative cobertura temporária quando alguém folgar.',
  },
  {
    icon: BarChart3,
    iconStyle: 'bg-cyan-600 text-white',
    tag: 'Indicadores',
    tagStyle: 'text-cyan-700 bg-cyan-50',
    title: 'Painel de operação e teto de gasto mensal',
    description:
      'Monitore quanto já gastou no mês contra o orçamento definido, acompanhe faltas, tempo médio de resposta e taxa de preenchimento.',
  },
  {
    icon: FileSpreadsheet,
    iconStyle: 'bg-teal-600 text-white',
    tag: 'Financeiro',
    tagStyle: 'text-teal-700 bg-teal-50',
    title: 'Relatório financeiro e planilha de pagamento',
    description:
      'Você paga por fora (PIX ou dinheiro), registra o recibo bilateral e exporta a lista completa com horas reais, CPF e chave PIX só para o Gestor.',
  },
  {
    icon: UserCheck,
    iconStyle: 'bg-rose-600 text-white',
    tag: 'Qualificação',
    tagStyle: 'text-rose-700 bg-rose-50',
    title: 'Disponibilidade, certificações e indicações',
    description:
      'Veja quem declarou estar livre no dia, controle certificações com aviso de vencimento, acompanhe frequência semanal e troque indicações com empresas parceiras.',
  },
  {
    icon: MessageSquare,
    iconStyle: 'bg-sky-600 text-white',
    tag: 'Comunicação',
    tagStyle: 'text-sky-700 bg-sky-50',
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
    <div className="min-h-screen bg-white font-sans text-accent flex flex-col overflow-x-hidden">
      <PageMeta
        title="Escala de freelas com IA, controle de presença e fechamento de diárias"
        description="Nunca mais perca a abertura da loja por falta de freela. Monte escalas com IA, chame sua equipe de confiança em segundos, comprove presença no local e feche o financeiro sem planilha manual."
      />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b-2 border-black">
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
            <a href="#copiloto" className="hover:text-violet-700 transition-colors">
              IA na escala
            </a>
            <a href="#para-quem" className="hover:text-blue-700 transition-colors">
              Para sua equipe
            </a>
            <a href="#beneficios" className="hover:text-emerald-700 transition-colors">
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
        {/* Hero com gradiente sutil esmeralda + cobalto */}
        <section className="relative px-4 sm:px-6 md:px-10 pt-10 pb-16 md:pt-16 md:pb-24 bg-gradient-to-br from-emerald-50/75 via-white to-blue-50/75 overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              backgroundImage: 'radial-gradient(rgba(15,23,42,0.12) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          />

          <div className="relative max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Esquerda: Proposta de Valor WIIFM */}
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border-2 border-black bg-white px-3.5 py-1.5 text-xs font-bold tracking-wide shadow-brutal-xs">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <Sparkles size={12} aria-hidden="true" />
                </span>
                <span>Gestão de freelas com IA para restaurantes, bares e eventos</span>
              </div>

              <h1 className="text-4xl sm:text-5xl md:text-[3.5rem] font-black leading-[1.03] tracking-tight text-slate-950">
                Nunca mais perca a abertura da loja por{' '}
                <span className="bg-gradient-to-r from-[#00A651] via-emerald-600 to-blue-600 bg-clip-text text-transparent">
                  falta de freela.
                </span>
              </h1>

              <p className="text-base sm:text-lg md:text-xl text-slate-700 max-w-2xl leading-relaxed">
                Monte escalas da semana com ajuda da IA, chame sua equipe de confiança em segundos,
                acompanhe a presença real em cada loja e feche o financeiro sem juntar conversa de
                WhatsApp.
              </p>

              {/* 3 Ganhos Reais (WIIFM) com acentos de cor */}
              <ul className="space-y-3 pt-1 max-w-xl">
                <li className="flex items-start gap-3 text-sm sm:text-base text-slate-800">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 border-black bg-emerald-500 text-white">
                    <Check size={14} strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span>
                    <strong className="text-slate-950">Feche faltas em minutos:</strong> avise todo o
                    seu time de confiança de uma vez ou acione o reforço SOS quando apertar.
                  </span>
                </li>
                <li className="flex items-start gap-3 text-sm sm:text-base text-slate-800">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 border-black bg-blue-600 text-white">
                    <Check size={14} strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span>
                    <strong className="text-slate-950">Delegue com controle real:</strong> cada
                    encarregado toca a própria loja enquanto você acompanha gasto, presença e
                    indicadores.
                  </span>
                </li>
                <li className="flex items-start gap-3 text-sm sm:text-base text-slate-800">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 border-black bg-violet-600 text-white">
                    <Check size={14} strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span>
                    <strong className="text-slate-950">Segurança para os dois lados:</strong> horas
                    comprovadas no local, recibo registrado e histórico portátil para o freela.
                  </span>
                </li>
              </ul>
            </div>

            {/* Direita: Cartões de Entrada Ricos e Sofisticados (sombras neutras padrão) */}
            <div className="lg:col-span-5 grid gap-5 w-full">
              {/* Card Empresa — Azul Marinho Profundo */}
              <button
                type="button"
                data-copilot="publico.entrada.escolher-empresa"
                onClick={() => navigate('/login?type=hire&cadastro=1')}
                className="group relative bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-white border-2 border-black rounded-2xl p-6 sm:p-7 text-left shadow-brutal transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
              >
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="w-11 h-11 bg-blue-600 text-white rounded-xl flex items-center justify-center border-2 border-blue-400/70">
                    <Briefcase size={22} strokeWidth={2.5} aria-hidden="true" />
                  </div>
                  <span className="bg-blue-500/20 text-blue-200 border border-blue-400/40 text-xs font-bold px-3 py-1 rounded-full">
                    Para empresas
                  </span>
                </div>
                <h2 className="text-2xl font-black tracking-tight mb-1.5">Quero contratar</h2>
                <p className="text-slate-300 text-sm leading-relaxed">
                  Organize seus freelas de confiança, monte escalas com IA, delegue para
                  encarregados e feche os pagamentos da semana sem planilha manual.
                </p>
                <span className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-white bg-white px-4 text-sm font-bold text-slate-950 group-hover:bg-blue-50 transition-colors">
                  Criar conta de empresa <ArrowRight size={17} aria-hidden="true" />
                </span>
              </button>

              {/* Card Freela — Branco Nítido com Acento Esmeralda */}
              <button
                type="button"
                data-copilot="publico.entrada.escolher-freela"
                onClick={() => navigate('/login?type=work&cadastro=1')}
                className="group relative bg-white text-slate-950 border-2 border-black border-t-[6px] border-t-emerald-600 rounded-2xl p-6 sm:p-7 text-left shadow-brutal transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
              >
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="w-11 h-11 bg-emerald-600 text-white rounded-xl flex items-center justify-center border-2 border-black">
                    <DollarSign size={22} strokeWidth={2.5} aria-hidden="true" />
                  </div>
                  <span className="bg-emerald-50 text-emerald-800 border border-emerald-300 text-xs font-bold px-3 py-1 rounded-full">
                    Para freelas
                  </span>
                </div>
                <h2 className="text-2xl font-black tracking-tight mb-1.5">Quero trabalhar</h2>
                <p className="text-slate-600 text-sm leading-relaxed">
                  Receba convites de empresas que já confiam no seu trabalho, informe quando está
                  livre e guarde avaliações e comprovantes de renda que são seus.
                </p>
                <span className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-black bg-emerald-600 px-4 text-sm font-bold text-white group-hover:bg-slate-950 transition-colors">
                  Criar conta de freela <ArrowRight size={17} aria-hidden="true" />
                </span>
              </button>
            </div>
          </div>
        </section>

        {/* Faixa de marca — Verde-Obsidiana sofisticado */}
        <div className="relative flex w-full items-center bg-[#071A12] border-y-2 border-black">
          <div className="min-w-0 flex-1 overflow-hidden py-3" aria-hidden="true">
            <div
              data-paused={marqueePaused}
              className="whitespace-nowrap animate-marquee flex gap-8 text-emerald-100 font-bold text-xs sm:text-sm uppercase tracking-widest"
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
            className="mr-2 text-emerald-100 enabled:hover:bg-white/15 enabled:active:bg-white/25 focus-visible:ring-white focus-visible:ring-offset-0 motion-reduce:hidden"
          >
            {marqueePaused ? <Play size={18} /> : <Pause size={18} />}
          </IconButton>
        </div>

        {/* Destaque do Copiloto com IA — Violeta + Indigo sofisticado */}
        <section
          id="copiloto"
          className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-gradient-to-br from-violet-50/80 via-white to-blue-50/60 border-b-2 border-black"
        >
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-6 space-y-5">
              <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-black bg-violet-600 text-white px-3.5 py-1 text-xs font-bold uppercase tracking-wider">
                <Sparkles size={13} aria-hidden="true" /> Copiloto com IA
              </span>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-950">
                Peça em português e monte a escala da semana em segundos
              </h2>
              <p className="text-base sm:text-lg text-slate-700 leading-relaxed">
                Quem toca salão e cozinha não tem tempo para preencher o mesmo formulário vinte
                vezes. O Copiloto do Workyn entende o que você precisa, prepara turnos avulsos ou em
                lote e guia sua equipe dentro do próprio app.
              </p>
              <ul className="space-y-3 text-sm sm:text-base text-slate-800 pt-1">
                <li className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-700">
                    <Check size={14} strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span>Crie escalas de fim de semana ou eventos de vários dias com uma frase.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-700">
                    <Check size={14} strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span>Salve modelos prontos para repetir turnos frequentes em um toque.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-700">
                    <Check size={14} strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span>Tire dúvidas da operação e encontre relatórios sem procurar em menus.</span>
                </li>
              </ul>
            </div>

            {/* Simulação visual sofisticada do Copiloto */}
            <div className="lg:col-span-6">
              <div className="rounded-2xl border-2 border-black bg-white shadow-brutal overflow-hidden">
                <div className="flex items-center justify-between bg-slate-950 text-white px-5 py-3.5 border-b-2 border-black">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-white">
                      <Sparkles size={16} aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-sm font-black">Copiloto Workyn</p>
                      <p className="text-[11px] text-slate-300 flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-emerald-400 inline-block" />
                        Ativo no celular e no computador
                      </p>
                    </div>
                  </div>
                  <span className="rounded-full bg-violet-500/20 border border-violet-400/40 px-2.5 py-0.5 text-[11px] font-bold text-violet-200">
                    IA integrada
                  </span>
                </div>

                <div className="p-5 sm:p-6 space-y-4 bg-gradient-to-b from-slate-50 to-white">
                  {/* Mensagem do gestor */}
                  <div className="ml-auto max-w-[88%] rounded-2xl rounded-tr-sm border-2 border-black bg-blue-600 p-3.5 text-sm font-medium text-white">
                    &ldquo;Preciso de 2 garçons na sexta e no sábado às 18h na Loja Centro, R$ 150 a
                    diária, chamando a lista Salão.&rdquo;
                  </div>

                  {/* Resposta estruturada do Copiloto */}
                  <div className="max-w-[94%] rounded-2xl rounded-tl-sm border-2 border-black bg-white p-4 space-y-3">
                    <p className="text-sm font-bold text-slate-950">
                      Pronto. Montei o lote com 2 turnos e 4 vagas na{' '}
                      <span className="text-blue-700">Loja Centro</span>:
                    </p>
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2.5">
                        <span className="font-bold text-slate-900">
                          Sexta · 18:00 · Garçom (2 vagas)
                        </span>
                        <span className="font-extrabold text-emerald-700">R$ 150/pessoa</span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-2.5">
                        <span className="font-bold text-slate-900">
                          Sábado · 18:00 · Garçom (2 vagas)
                        </span>
                        <span className="font-extrabold text-blue-700">R$ 150/pessoa</span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600">
                      Lista <strong className="text-slate-900">Salão</strong> selecionada · Convite
                      aberto até 1h antes do turno. Só confirmar para disparar.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Multi-Stakeholder WIIFM — Cada papel com identidade cromática própria */}
        <section
          id="para-quem"
          className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-white border-b-2 border-black"
        >
          <div className="max-w-7xl mx-auto">
            <div className="max-w-3xl mb-12">
              <span className="inline-block rounded-full border-2 border-black bg-blue-50 text-blue-800 px-3.5 py-1 text-xs font-bold uppercase tracking-wider mb-3">
                O que cada pessoa ganha
              </span>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-950">
                Uma plataforma pensada para quem decide, quem paga, quem opera e quem trabalha
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {STAKEHOLDERS.map((s) => {
                const Icon = s.icon;
                return (
                  <div
                    key={s.role}
                    className="rounded-2xl border-2 border-black bg-white shadow-brutal overflow-hidden flex flex-col"
                  >
                    <div className={`${s.headerBg} px-6 py-4 border-b-2 border-black flex items-center justify-between gap-3`}>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${s.badgeClass}`}>
                        {s.role}
                      </span>
                      <span className={`w-9 h-9 rounded-xl border-2 border-black flex items-center justify-center ${s.iconBg}`}>
                        <Icon size={18} strokeWidth={2.5} aria-hidden="true" />
                      </span>
                    </div>
                    <div className="p-6 flex flex-col gap-4">
                      <h3 className="text-xl font-black tracking-tight text-slate-950">
                        {s.headline}
                      </h3>
                      <ul className="space-y-2.5 text-sm sm:text-[15px] text-slate-700">
                        {s.points.map((pt) => (
                          <li key={pt} className="flex items-start gap-2.5">
                            <Check
                              size={16}
                              strokeWidth={3}
                              className={`${s.checkColor} shrink-0 mt-1`}
                              aria-hidden="true"
                            />
                            <span>{pt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Antes x Depois — Contraste Coral (dor) x Esmeralda (solução) */}
        <section className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-slate-50 border-b-2 border-black">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-3xl mb-12">
              <span className="inline-block rounded-full border-2 border-black bg-emerald-50 text-emerald-800 px-3.5 py-1 text-xs font-bold uppercase tracking-wider mb-3">
                Na prática
              </span>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-950">
                O que muda já na primeira semana usando o Workyn
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {COMPARISON.map((row, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border-2 border-black bg-white shadow-brutal overflow-hidden flex flex-col"
                >
                  <div className="bg-rose-50/70 p-5 flex items-start gap-3 border-b-2 border-black/15">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 border-black bg-rose-600 text-white">
                      <X size={15} strokeWidth={3} aria-hidden="true" />
                    </span>
                    <p className="text-sm text-slate-700 leading-relaxed">{row.antes}</p>
                  </div>
                  <div className="bg-emerald-50/70 p-5 flex items-start gap-3 flex-1">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 border-black bg-emerald-600 text-white">
                      <Check size={15} strokeWidth={3} aria-hidden="true" />
                    </span>
                    <p className="text-sm sm:text-base font-bold text-slate-950 leading-relaxed">
                      {row.depois}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 9 Capacidades Reais Color-Coded */}
        <section
          id="beneficios"
          className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-white border-b-2 border-black"
        >
          <div className="max-w-7xl mx-auto">
            <div className="max-w-3xl mb-12">
              <span className="inline-block rounded-full border-2 border-black bg-indigo-50 text-indigo-800 px-3.5 py-1 text-xs font-bold uppercase tracking-wider mb-3">
                Tudo no mesmo sistema
              </span>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-950">
                Muito além de planilha: sua operação inteira de freelas em um só lugar
              </h2>
              <p className="mt-3 text-base sm:text-lg text-slate-600">
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
                    <div className="flex items-center justify-between gap-2 mb-5">
                      <div
                        className={`w-11 h-11 rounded-xl border-2 border-black flex items-center justify-center ${item.iconStyle}`}
                      >
                        <Icon size={21} strokeWidth={2.5} aria-hidden="true" />
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${item.tagStyle}`}
                      >
                        {item.tag}
                      </span>
                    </div>
                    <h3 className="text-lg font-extrabold tracking-tight text-slate-950 mb-2">
                      {item.title}
                    </h3>
                    <p className="text-sm sm:text-[15px] text-slate-600 leading-relaxed">
                      {item.description}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* Como Funciona — Azul (Empresas) x Esmeralda Profundo (Freelas) */}
        <section
          id="como-funciona"
          className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-gradient-to-b from-slate-50 to-emerald-50/40 border-b-2 border-black"
        >
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-2xl mx-auto mb-12">
              <span className="inline-block rounded-full border-2 border-black bg-white text-slate-950 px-3.5 py-1 text-xs font-bold uppercase tracking-wider mb-3 shadow-brutal-xs">
                Em 3 passos
              </span>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-950">
                Simples para o dono, justo para o freela
              </h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Para Empresas */}
              <div className="rounded-2xl border-2 border-black bg-white p-6 sm:p-8 shadow-brutal">
                <div className="flex items-center justify-between gap-2 mb-7 pb-4 border-b-2 border-blue-100">
                  <h3 className="text-xl font-black flex items-center gap-2.5 text-slate-950">
                    <Briefcase size={22} strokeWidth={2.5} className="text-blue-600" aria-hidden="true" />
                    Para empresas
                  </h3>
                  <span className="rounded-full border border-blue-200 bg-blue-50 text-blue-800 px-3 py-0.5 text-xs font-bold">
                    Gestor e Encarregado
                  </span>
                </div>
                <ol className="space-y-6">
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-blue-600 text-white border-2 border-black rounded-xl flex items-center justify-center">
                      <UserPlus size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-slate-950">
                        1. Traga seu time de confiança
                      </p>
                      <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">
                        Envie um link único para os freelas com quem você já trabalha e separe em
                        listas por função.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-blue-600 text-white border-2 border-black rounded-xl flex items-center justify-center">
                      <CalendarCheck size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-slate-950">
                        2. Monte turnos com IA e confirme presença
                      </p>
                      <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">
                        Abra turnos avulsos, em lote ou em série, receba confirmação na véspera e
                        registre chegada e saída no local.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-blue-600 text-white border-2 border-black rounded-xl flex items-center justify-center">
                      <Receipt size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-slate-950">
                        3. Acompanhe indicadores e feche o caixa
                      </p>
                      <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">
                        Veja o gasto frente ao teto do mês, pague por fora (PIX ou dinheiro) e baixe
                        o relatório pronto por loja e encarregado.
                      </p>
                    </div>
                  </li>
                </ol>
              </div>

              {/* Para Freelas */}
              <div className="rounded-2xl border-2 border-black bg-gradient-to-br from-[#064E3B] via-slate-950 to-slate-900 text-white p-6 sm:p-8 shadow-brutal">
                <div className="flex items-center justify-between gap-2 mb-7 pb-4 border-b-2 border-white/15">
                  <h3 className="text-xl font-black flex items-center gap-2.5 text-emerald-300">
                    <Users size={22} strokeWidth={2.5} aria-hidden="true" />
                    Para freelas
                  </h3>
                  <span className="rounded-full border border-emerald-400/40 bg-emerald-500/20 text-emerald-200 px-3 py-0.5 text-xs font-bold">
                    Sua carreira
                  </span>
                </div>
                <ol className="space-y-6">
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-emerald-500 text-white border-2 border-white/80 rounded-xl flex items-center justify-center">
                      <Clock size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-white">
                        1. Aceite o turno em um toque
                      </p>
                      <p className="text-sm text-slate-300 mt-0.5 leading-relaxed">
                        Informe os dias em que está livre, receba aviso no celular e no e-mail e
                        garanta seu turno antes que acabe.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-emerald-500 text-white border-2 border-white/80 rounded-xl flex items-center justify-center">
                      <Bell size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-white">
                        2. Comprove presença e combine no chat
                      </p>
                      <p className="text-sm text-slate-300 mt-0.5 leading-relaxed">
                        Converse direto sobre o turno e registre entrada e saída no local para
                        deixar suas horas documentadas.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-emerald-500 text-white border-2 border-white/80 rounded-xl flex items-center justify-center">
                      <DollarSign size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-white">
                        3. Guarde recibos, certificações e reputação
                      </p>
                      <p className="text-sm text-slate-300 mt-0.5 leading-relaxed">
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
        <section id="duvidas" className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-white border-b-2 border-black">
          <div className="max-w-4xl mx-auto">
            <div className="mb-10">
              <span className="inline-block rounded-full border-2 border-black bg-slate-100 text-slate-900 px-3.5 py-1 text-xs font-bold uppercase tracking-wider mb-3">
                Perguntas frequentes
              </span>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-950">
                Dúvidas antes de começar
              </h2>
            </div>

            <div className="space-y-4">
              {FAQ_ITEMS.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-2xl border-2 border-black bg-slate-50/70 open:bg-white shadow-brutal-sm transition-colors"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 font-extrabold text-base sm:text-lg text-slate-950">
                    <span>{item.q}</span>
                    <ChevronDown
                      size={20}
                      className="shrink-0 text-slate-600 transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="px-5 pb-5 pt-0 text-sm sm:text-base text-slate-600 leading-relaxed border-t border-black/10">
                    <p className="pt-3">{item.a}</p>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Final — Gradiente sofisticado Esmeralda -> Slate -> Azul (botões padrão!) */}
        <section className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-gradient-to-br from-[#064E3B] via-slate-950 to-blue-950 text-white text-center border-b-2 border-black">
          <div className="max-w-3xl mx-auto space-y-6">
            <span className="inline-block rounded-full border border-emerald-400/40 bg-emerald-500/20 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-emerald-200">
              Cadastro gratuito
            </span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight leading-tight">
              Coloque sua escala de freelas em ordem hoje
            </h2>
            <p className="text-base sm:text-lg text-slate-300 max-w-xl mx-auto leading-relaxed">
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
      <footer className="px-4 sm:px-6 md:px-10 py-10 bg-white text-slate-900">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-center md:text-left">
            <p className="text-xl font-black tracking-tight">Workyn.</p>
            <p className="text-xs text-slate-500 mt-1">
              &copy; {new Date().getFullYear()} Workyn. Escala de freelas com IA, presença e
              pagamentos organizados.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-x-2 gap-y-1 text-sm font-bold">
            <button
              type="button"
              onClick={() => navigate('/sobre')}
              className="min-h-11 px-3 text-slate-600 hover:text-black transition-colors"
            >
              Sobre
            </button>
            <button
              type="button"
              onClick={() => navigate('/termos')}
              className="min-h-11 px-3 text-slate-600 hover:text-black transition-colors"
            >
              Termos de Uso
            </button>
            <button
              type="button"
              onClick={() => navigate('/privacidade')}
              className="min-h-11 px-3 text-slate-600 hover:text-black transition-colors"
            >
              Privacidade
            </button>
            <button
              type="button"
              onClick={() => navigate('/licencas')}
              className="min-h-11 px-3 text-slate-600 hover:text-black transition-colors"
            >
              Licenças
            </button>
            <button
              type="button"
              onClick={() => navigate('/ajuda')}
              className="min-h-11 px-3 text-slate-600 hover:text-black transition-colors"
            >
              Ajuda
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
