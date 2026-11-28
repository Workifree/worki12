import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bell,
  Briefcase,
  Building2,
  CalendarCheck,
  Check,
  ChevronDown,
  Clock,
  DollarSign,
  FileSpreadsheet,
  Megaphone,
  Pause,
  Play,
  QrCode,
  Receipt,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import { Button, IconButton } from '../components/ui';

const BENEFITS = [
  {
    eyebrow: 'Para quem toca a loja',
    icon: Megaphone,
    title: 'Cubra faltas antes de virar correria',
    description:
      'Em vez de mandar mensagem um por um esperando resposta no WhatsApp, você avisa todo o seu time de confiança de uma vez. Quem aceitar primeiro já fica confirmado na escala.',
  },
  {
    eyebrow: 'Previsibilidade',
    icon: QrCode,
    title: 'Saiba quem realmente vai aparecer',
    description:
      'O freela confirma presença na véspera e registra entrada e saída no local pelo celular. Você abre o painel e vê quem já está no posto, sem ficar cobrando no telefone.',
  },
  {
    eyebrow: 'Para o financeiro',
    icon: FileSpreadsheet,
    title: 'Feche os pagamentos sem planilha manual',
    description:
      'Chega de caçar chave PIX em grupo ou conferir diária em print de conversa. Filtre o período e baixe a lista pronta para pagar com nome, horas reais, valor e recibo de cada pessoa.',
  },
  {
    eyebrow: 'Mais de uma loja ou turno',
    icon: Building2,
    title: 'Delegue a escala sem perder o controle',
    description:
      'Cada encarregado gerencia apenas os próprios turnos e a própria loja, sem acessar dados financeiros nem a escala dos colegas. O Gestor enxerga tudo consolidado em um só painel.',
  },
  {
    eyebrow: 'Resposta rápida',
    icon: Bell,
    title: 'Quem trabalha com você não perde o convite',
    description:
      'Os convites e lembretes de turno chegam direto no celular e no e-mail do freela mesmo com o navegador fechado. Menos esquecimento, menos furo e escala fechada muito mais cedo.',
  },
  {
    eyebrow: 'Segurança dos dois lados',
    icon: ShieldCheck,
    title: 'Tudo combinado, provado e documentado',
    description:
      'Você paga direto do seu jeito (PIX ou dinheiro) e registra o recibo. A empresa acompanha a frequência semanal de cada freela e o profissional guarda seu histórico e comprovante de renda.',
  },
];

const COMPARISON = [
  {
    antes: 'Perder a manhã no WhatsApp chamando freela um por um quando alguém falta na abertura.',
    depois: 'Avisar todo o seu Elenco de confiança em um toque e fechar a vaga em minutos.',
  },
  {
    antes: 'Só descobrir no horário do expediente que o freela esqueceu o turno ou pegou outro serviço.',
    depois: 'Receber confirmação na véspera e acompanhar em tempo real quem já chegou no local.',
  },
  {
    antes: 'Gastar horas toda semana juntando chave PIX, nome e valor de diária em planilha manual.',
    depois: 'Baixar a lista de pagamento pronta para o financeiro, separada por loja e encarregado.',
  },
  {
    antes: 'Deixar encarregados sem ferramenta ou expor dados financeiros para quem só toca a operação.',
    depois: 'Dar acesso na medida certa: encarregado opera os próprios turnos; financeiro fica com o Gestor.',
  },
];

const FAQ_ITEMS = [
  {
    q: 'O Workyn cobra mensalidade ou comissão sobre o valor do freela?',
    a: 'Você começa grátis. O pagamento da diária continua sendo feito direto por você ao profissional (PIX ou dinheiro), enquanto o Workyn organiza a escala, a presença, os recibos e o fechamento do financeiro.',
  },
  {
    q: 'Preciso contratar desconhecidos ou posso usar meus próprios freelas?',
    a: 'Você trabalha com quem já conhece. Basta enviar o link do seu Elenco para os freelas que já atendem sua empresa, organizar por função e chamar direto quando abrir um turno.',
  },
  {
    q: 'Funciona para empresas com vários encarregados ou mais de uma loja?',
    a: 'Sim. Cada encarregado acessa apenas os próprios turnos, já vinculados à sua loja, e o Gestor acompanha toda a operação e o financeiro separados por loja e responsável.',
  },
  {
    q: 'Como o Workyn ajuda a controlar a recorrência de um mesmo freela?',
    a: 'Na hora de chamar um profissional, o Workyn mostra quantas vezes ele já trabalhou na semana na sua empresa para você distribuir os turnos com segurança.',
  },
  {
    q: 'O freela precisa baixar aplicativo na loja do celular?',
    a: 'Funciona direto no navegador do celular e pode ser salvo na Tela de Início com avisos no aparelho e por e-mail.',
  },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [marqueePaused, setMarqueePaused] = useState(false);

  return (
    <div className="min-h-screen bg-canvas font-sans text-accent flex flex-col overflow-x-hidden">
      <PageMeta
        title="Escala de freelas, controle de presença e fechamento de diárias"
        description="Nunca mais perca a abertura da loja por falta de freela. Chame sua equipe de confiança em segundos, confirme presença no local e feche os pagamentos da semana sem planilha manual."
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
            <a href="#beneficios" className="hover:text-black transition-colors">
              Benefícios
            </a>
            <a href="#comparativo" className="hover:text-black transition-colors">
              Na prática
            </a>
            <a href="#como-funciona" className="hover:text-black transition-colors">
              Como funciona
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
                <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                <span>Para restaurantes, bares, eventos e profissionais autônomos</span>
              </div>

              <h1 className="text-4xl sm:text-5xl md:text-[3.4rem] font-black leading-[1.04] tracking-tight text-accent">
                Nunca mais perca a abertura da loja por{' '}
                <span className="text-primary">falta de freela.</span>
              </h1>

              <p className="text-base sm:text-lg md:text-xl text-gray-700 max-w-2xl leading-relaxed">
                Chame sua equipe de confiança em segundos, saiba na véspera quem confirmou presença
                e feche os pagamentos da semana sem juntar conversa de WhatsApp.
              </p>

              {/* 3 Ganhos Reais (WIIFM) */}
              <ul className="space-y-3 pt-1 max-w-xl">
                <li className="flex items-start gap-3 text-sm sm:text-base text-gray-800">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-black bg-[#D7F5E4] text-primary">
                    <Check size={14} strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span>
                    <strong className="text-accent">Volte a ter paz na abertura:</strong> preencha
                    faltas de última hora avisando todo o seu time de confiança de uma vez.
                  </span>
                </li>
                <li className="flex items-start gap-3 text-sm sm:text-base text-gray-800">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-black bg-[#D7F5E4] text-primary">
                    <Check size={14} strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span>
                    <strong className="text-accent">Feche o financeiro em minutos:</strong> cada
                    turno chega com horas reais trabalhadas, loja e dados prontos para pagar.
                  </span>
                </li>
                <li className="flex items-start gap-3 text-sm sm:text-base text-gray-800">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-black bg-[#D7F5E4] text-primary">
                    <Check size={14} strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span>
                    <strong className="text-accent">Segurança para os dois lados:</strong> recibo
                    registrado para a empresa e comprovante de renda portátil para o freela.
                  </span>
                </li>
              </ul>
            </div>

            {/* Direita: Cartões de Entrada (Padrão Neo-Brutalista Limpo, sem sombras coloridas) */}
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
                  Organize seus freelas de confiança, delegue turnos para encarregados e acabe com
                  as planilhas manuais no dia de pagamento.
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
                  Receba convites de empresas que já confiam no seu trabalho e construa um histórico
                  com avaliações e comprovantes de renda que são seus.
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
              {Array(16)
                .fill(
                  'WORKYN • ESCALA ORGANIZADA • EQUIPE DE CONFIANÇA • PRESENÇA COMPROVADA • FECHAMENTO EM MINUTOS • RECIBO PARA OS DOIS LADOS • ',
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

        {/* Antes x Depois */}
        <section id="comparativo" className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-white border-b-2 border-black">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-3xl mb-12">
              <span className="inline-block rounded-full border-2 border-black bg-canvas text-accent px-3.5 py-1 text-xs font-bold uppercase tracking-wider mb-3">
                Na prática
              </span>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-accent">
                O que muda já na primeira semana usando o Workyn
              </h2>
              <p className="mt-3 text-base sm:text-lg text-gray-600">
                Sua operação deixa de depender de memória e grupos de WhatsApp para funcionar com
                clareza do começo ao fim do turno.
              </p>
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

        {/* Benefícios Reais (WIIFM) */}
        <section id="beneficios" className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-canvas border-b-2 border-black">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-3xl mb-12">
              <span className="inline-block rounded-full border-2 border-black bg-[#D7F5E4] text-primary px-3.5 py-1 text-xs font-bold uppercase tracking-wider mb-3">
                Por que usar o Workyn
              </span>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-accent">
                Menos improviso na escala, mais controle no caixa
              </h2>
              <p className="mt-3 text-base sm:text-lg text-gray-700">
                Tudo o que uma operação com freelas precisa para rodar leve no dia a dia e prestar
                contas com transparência.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {BENEFITS.map((item) => {
                const Icon = item.icon;
                return (
                  <article
                    key={item.title}
                    className="rounded-2xl border-2 border-black bg-white p-6 shadow-brutal transition-transform hover:-translate-y-0.5 flex flex-col"
                  >
                    <div className="flex items-center justify-between gap-2 mb-5">
                      <div className="w-11 h-11 rounded-xl border-2 border-black bg-canvas text-accent flex items-center justify-center">
                        <Icon size={22} strokeWidth={2.5} aria-hidden="true" />
                      </div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                        {item.eyebrow}
                      </span>
                    </div>
                    <h3 className="text-lg sm:text-xl font-extrabold tracking-tight text-accent mb-2">
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
              <p className="mt-3 text-base sm:text-lg text-gray-600">
                Você traz os profissionais que já confia, chama direto para cada turno e fecha o
                pagamento com recibo registrado para os dois lados.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Para Empresas */}
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
                        2. Abra o turno e acompanhe a presença
                      </p>
                      <p className="text-sm text-gray-600 mt-0.5 leading-relaxed">
                        Chame vários freelas de uma vez, receba confirmação na véspera e registre
                        chegada e saída no local pelo celular.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-accent text-white border-2 border-black rounded-xl flex items-center justify-center">
                      <Receipt size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-accent">
                        3. Feche o financeiro sem retrabalho
                      </p>
                      <p className="text-sm text-gray-600 mt-0.5 leading-relaxed">
                        Pague por fora (PIX ou dinheiro), registre o pagamento e baixe o relatório
                        filtrado por loja, encarregado e freela.
                      </p>
                    </div>
                  </li>
                </ol>
              </div>

              {/* Para Freelas */}
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
                        Receba o aviso no celular e no e-mail quando uma empresa do seu Elenco abrir
                        vaga e garanta seu dia de trabalho.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-primary text-white border-2 border-white/90 rounded-xl flex items-center justify-center">
                      <QrCode size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-white">
                        2. Comprove suas horas trabalhadas
                      </p>
                      <p className="text-sm text-gray-300 mt-0.5 leading-relaxed">
                        Registre entrada e saída direto no local para deixar seu horário documentado
                        com clareza para você e para a empresa.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-primary text-white border-2 border-white/90 rounded-xl flex items-center justify-center">
                      <DollarSign size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-white">
                        3. Guarde recibos e reputação
                      </p>
                      <p className="text-sm text-gray-300 mt-0.5 leading-relaxed">
                        Confirme cada pagamento recebido e leve seu histórico, avaliações e
                        comprovantes de renda com você para qualquer lugar.
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

        {/* CTA Final (botões 100% padrão do sistema, sem sombra colorida) */}
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
              &copy; {new Date().getFullYear()} Workyn. Escala de freelas, presença e pagamentos
              organizados.
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
