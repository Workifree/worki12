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

const PILLARS = [
  {
    eyebrow: 'Velocidade na escala',
    icon: Megaphone,
    accent: 'text-blue-700 bg-blue-50 border-blue-200',
    title: 'Feche falta de última hora em minutos',
    description:
      'Em vez de mandar mensagem um por um no WhatsApp, dispare um único chamado para todo o seu Elenco ou para listas salvas (Salão, Cozinha, Bar). Quem aceitar primeiro garante a vaga, com prazo configurável até 1h antes do turno.',
  },
  {
    eyebrow: 'Presença comprovada',
    icon: QrCode,
    accent: 'text-primary bg-[#D7F5E4] border-primary/30',
    title: 'Check-in com QR dinâmico e GPS no local',
    description:
      'O encarregado mostra o QR que muda na tela do celular e o freela registra chegada e saída na hora. Acabou o achismo sobre horário de entrada ou saída: as horas reais vão direto para o relatório.',
  },
  {
    eyebrow: 'Fechamento sem retrabalho',
    icon: FileSpreadsheet,
    accent: 'text-blue-700 bg-blue-50 border-blue-200',
    title: 'Planilha de PIX pronta para o financeiro',
    description:
      'Filtre por período, loja, encarregado ou freela e exporte o CSV pronto para pagar. Nome, CPF, chave PIX, horas trabalhadas, total a pagar e número do recibo reunidos em um clique.',
  },
  {
    eyebrow: 'Governança de equipe',
    icon: Building2,
    accent: 'text-accent bg-gray-100 border-gray-300',
    title: 'Encarregados por loja, financeiro só com o Gestor',
    description:
      'Convide encarregados por link único preso ao e-mail. Cada encarregado opera apenas os próprios turnos já marcados com a sua loja, enquanto CPF, PIX e relatórios completos ficam restritos ao Gestor.',
  },
  {
    eyebrow: 'Ninguém perde o horário',
    icon: Bell,
    accent: 'text-primary bg-[#D7F5E4] border-primary/30',
    title: 'Avisos no celular e por e-mail fora do app',
    description:
      'Convites de turno, confirmações automáticas de véspera, aceites e cancelamentos chegam por notificação push no celular e por e-mail. A empresa sabe antes quem vai aparecer.',
  },
  {
    eyebrow: 'Relação limpa dos dois lados',
    icon: ShieldCheck,
    accent: 'text-accent bg-gray-100 border-gray-300',
    title: 'Recibo registrado e alerta semanal de frequência',
    description:
      'Você paga por fora (PIX ou dinheiro) e registra no Workyn. O app alerta quando um mesmo freela está trabalhando muitos dias na semana e gera comprovante portátil de renda para o profissional.',
  },
];

const COMPARISON = [
  {
    antes: 'Ficar 1 hora no WhatsApp chamando freela um por um quando alguém falta na abertura.',
    depois: 'Disparar 1 chamado para o seu Elenco: o primeiro que aceitar fecha a vaga na hora.',
  },
  {
    antes: 'Só descobrir no horário do turno que o freela esqueceu ou pegou outro serviço.',
    depois: 'Confirmação automática na véspera, push no celular e painel Hoje com quem já chegou.',
  },
  {
    antes: 'Juntar print de conversa, chave PIX e diária na mão toda semana para o financeiro pagar.',
    depois: 'Exportar a planilha de PIX filtrada por loja e período com horas reais e recibo.',
  },
  {
    antes: 'Perder controle de quem chamou quem em cada loja ou expor dados do financeiro.',
    depois: 'Cada encarregado vê só os próprios turnos; o Gestor audita todas as lojas num painel.',
  },
];

const FAQ_ITEMS = [
  {
    q: 'O Workyn cobra mensalidade ou comissão sobre o valor do freela?',
    a: 'Comece gratuitamente. Você continua pagando o freela direto por PIX ou dinheiro, e o Workyn organiza os turnos, a presença no local, os recibos e a planilha de pagamento.',
  },
  {
    q: 'Preciso contratar desconhecidos ou posso usar meus próprios freelas?',
    a: 'O foco do Workyn é o seu Elenco de confiança. Você envia um link para os freelas com quem já trabalha, separa por listas de função e chama direto sempre que abrir um turno.',
  },
  {
    q: 'Funciona para empresas com vários encarregados ou mais de uma loja?',
    a: 'Sim. Em Configurações → Equipe você convida encarregados e gestores por link único e vincula cada encarregado à sua loja. Todo turno criado por ele já sai separado por loja no relatório financeiro.',
  },
  {
    q: 'Como o Workyn ajuda no controle de recorrência de freelas?',
    a: 'Ao montar um chamado ou série de turnos, o Workyn mostra quantas vezes aquele freela já trabalhou na semana na sua empresa, ajudando você a distribuir melhor a escala.',
  },
  {
    q: 'O freela precisa baixar aplicativo na loja do celular?',
    a: 'Funciona direto no navegador do celular e pode ser adicionado à Tela de Início como app, com notificações push e avisos por e-mail.',
  },
];

const FAQ_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ_ITEMS.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: {
      '@type': 'Answer',
      text: item.a,
    },
  })),
};

export default function Onboarding() {
  const navigate = useNavigate();
  const [marqueePaused, setMarqueePaused] = useState(false);

  return (
    <div className="min-h-screen bg-canvas font-sans text-accent flex flex-col overflow-x-hidden">
      <PageMeta
        title="Gestão de freelas, turnos, presença e planilha de PIX"
        description="Organize seu Elenco de freelas de confiança, dispare chamados de turno em um toque, confirme presença com QR e GPS e exporte a planilha de PIX pronta para o financeiro."
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }}
      />

      {/* Header Neo-Brutalista Refinado */}
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
              className="w-8 h-8 border-2 border-black rounded-lg shadow-[2px_2px_0_0_#111] bg-white"
            />
            <span className="text-2xl font-black tracking-tight">Workyn.</span>
          </a>

          <div className="hidden md:flex items-center gap-7 text-sm font-bold text-gray-700">
            <a href="#recursos" className="hover:text-black transition-colors">
              Recursos
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
            <Button
              variant="secondary"
              size="md"
              onClick={() => navigate('/login')}
              className="border-2 border-black bg-white shadow-[2px_2px_0_0_#111] font-bold text-xs sm:text-sm"
            >
              Entrar
            </Button>
            <Button
              variant="dark"
              size="md"
              onClick={() => navigate('/login?type=hire&cadastro=1')}
              className="hidden sm:inline-flex border-2 border-black shadow-[3px_3px_0_0_#00A651] font-bold text-xs sm:text-sm"
            >
              Começar grátis
            </Button>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero Moderno-Brutalista */}
        <section
          className="relative px-4 sm:px-6 md:px-10 pt-10 pb-16 md:pt-16 md:pb-24"
          style={{
            backgroundImage: 'radial-gradient(rgba(17,17,17,0.08) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        >
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Esquerda: Headline + Argumento Central */}
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border-2 border-black bg-white px-3.5 py-1.5 text-xs font-bold tracking-wide shadow-[2px_2px_0_0_#111]">
                <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                <span>Feito para restaurantes, bares, eventos e operações com freelas</span>
              </div>

              <h1 className="text-4xl sm:text-5xl md:text-[3.5rem] font-black leading-[1.03] tracking-tight text-accent">
                Sua escala de freelas organizada,{' '}
                <span className="text-primary underline decoration-4 decoration-black underline-offset-4">
                  do convite ao PIX.
                </span>
              </h1>

              <p className="text-base sm:text-lg md:text-xl text-gray-700 max-w-2xl leading-relaxed">
                Chame seu Elenco de confiança em um toque, comprove presença no local com QR e GPS e
                feche a semana com a planilha de pagamento pronta para o financeiro.
              </p>

              {/* 3 Pilares rápidos */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div className="rounded-xl border-2 border-black bg-white p-3.5 shadow-[3px_3px_0_0_#111]">
                  <p className="text-[11px] font-black uppercase tracking-wider text-blue-700">
                    Chamado 1 → N
                  </p>
                  <p className="text-sm font-bold text-accent mt-1">
                    Quem aceitar primeiro fecha a vaga
                  </p>
                </div>
                <div className="rounded-xl border-2 border-black bg-white p-3.5 shadow-[3px_3px_0_0_#111]">
                  <p className="text-[11px] font-black uppercase tracking-wider text-primary">
                    Financeiro limpo
                  </p>
                  <p className="text-sm font-bold text-accent mt-1">
                    Horas reais, recibo e CSV de PIX
                  </p>
                </div>
                <div className="rounded-xl border-2 border-black bg-white p-3.5 shadow-[3px_3px_0_0_#111]">
                  <p className="text-[11px] font-black uppercase tracking-wider text-gray-700">
                    No celular
                  </p>
                  <p className="text-sm font-bold text-accent mt-1">
                    Push e e-mail fora do app
                  </p>
                </div>
              </div>
            </div>

            {/* Direita: Cartões de Entrada Táteis (Empresa + Freela) */}
            <div className="lg:col-span-5 grid gap-5 w-full">
              {/* Card Empresa */}
              <button
                type="button"
                data-copilot="publico.entrada.escolher-empresa"
                onClick={() => navigate('/login?type=hire&cadastro=1')}
                className="group relative bg-accent text-white border-2 border-black rounded-2xl p-6 sm:p-7 text-left shadow-[6px_6px_0_0_#2563EB] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[8px_8px_0_0_#2563EB] active:translate-x-0.5 active:translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
              >
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="w-11 h-11 bg-blue-600 text-white rounded-xl flex items-center justify-center border-2 border-white/90">
                    <Briefcase size={22} strokeWidth={2.5} aria-hidden="true" />
                  </div>
                  <span className="bg-blue-600 text-white border border-white/30 text-[11px] font-black uppercase tracking-wider px-3 py-1 rounded-full">
                    Para empresas
                  </span>
                </div>
                <h2 className="text-2xl font-black tracking-tight mb-1.5">Quero contratar</h2>
                <p className="text-gray-300 text-sm leading-relaxed">
                  Monte seu Elenco de confiança, delegue turnos para encarregados por loja e exporte
                  os pagamentos da semana sem planilha manual.
                </p>
                <span className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-white bg-white px-4 text-sm font-extrabold text-black group-hover:bg-blue-50 transition-colors">
                  Criar conta de empresa <ArrowRight size={17} aria-hidden="true" />
                </span>
              </button>

              {/* Card Freela */}
              <button
                type="button"
                data-copilot="publico.entrada.escolher-freela"
                onClick={() => navigate('/login?type=work&cadastro=1')}
                className="group relative bg-white text-accent border-2 border-black rounded-2xl p-6 sm:p-7 text-left shadow-[6px_6px_0_0_#00A651] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[8px_8px_0_0_#00A651] active:translate-x-0.5 active:translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
              >
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="w-11 h-11 bg-[#D7F5E4] text-primary rounded-xl flex items-center justify-center border-2 border-black">
                    <DollarSign size={22} strokeWidth={2.5} aria-hidden="true" />
                  </div>
                  <span className="bg-[#D7F5E4] text-primary border border-primary/40 text-[11px] font-black uppercase tracking-wider px-3 py-1 rounded-full">
                    Para freelas
                  </span>
                </div>
                <h2 className="text-2xl font-black tracking-tight mb-1.5">Quero trabalhar</h2>
                <p className="text-gray-600 text-sm leading-relaxed">
                  Receba convites no celular, comprove suas horas no local e construa sua carteira
                  portátil com avaliações e comprovantes de renda.
                </p>
                <span className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-black bg-primary px-4 text-sm font-extrabold text-white group-hover:bg-black transition-colors">
                  Criar conta de freela <ArrowRight size={17} aria-hidden="true" />
                </span>
              </button>
            </div>
          </div>
        </section>

        {/* Faixa Marquee Preta & Verde (sem amarelo) */}
        <div className="relative flex w-full items-center bg-accent border-y-2 border-black">
          <div className="min-w-0 flex-1 overflow-hidden py-3" aria-hidden="true">
            <div
              data-paused={marqueePaused}
              className="whitespace-nowrap animate-marquee flex gap-8 text-white font-bold text-xs sm:text-sm uppercase tracking-widest"
            >
              {Array(16)
                .fill(
                  'WORKYN • ELENCO DE CONFIANÇA • CHAMADO 1 PARA VÁRIOS • PRESENÇA COM QR E GPS • PLANILHA DE PIX PRONTA • RECIBO AUTOMÁTICO • ',
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

        {/* Antes x Depois: Argumento Operacional Direto */}
        <section id="comparativo" className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-white border-b-2 border-black">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-3xl mb-12">
              <span className="inline-block rounded-full border-2 border-black bg-blue-50 text-blue-800 px-3.5 py-1 text-xs font-black uppercase tracking-wider mb-3">
                Na prática
              </span>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-accent">
                O que muda na primeira semana usando o Workyn
              </h2>
              <p className="mt-3 text-base sm:text-lg text-gray-600">
                Menos tempo apagando incêndio no WhatsApp e fechamento financeiro sem conferir print
                de conversa.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {COMPARISON.map((row, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border-2 border-black bg-canvas p-6 shadow-[4px_4px_0_0_#111] flex flex-col gap-4"
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

        {/* Recursos Completos */}
        <section id="recursos" className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-canvas border-b-2 border-black">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-3xl mb-12">
              <span className="inline-block rounded-full border-2 border-black bg-[#D7F5E4] text-primary px-3.5 py-1 text-xs font-black uppercase tracking-wider mb-3">
                Tudo no mesmo painel
              </span>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-accent">
                Cada etapa do turno registrada do começo ao fim
              </h2>
              <p className="mt-3 text-base sm:text-lg text-gray-700">
                Operação, presença e financeiro conversando no mesmo lugar, pensado primeiro para
                quem resolve tudo pelo celular.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {PILLARS.map((item) => {
                const Icon = item.icon;
                return (
                  <article
                    key={item.title}
                    className="rounded-2xl border-2 border-black bg-white p-6 shadow-[4px_4px_0_0_#111] transition-transform hover:-translate-y-0.5 flex flex-col"
                  >
                    <div className="flex items-center justify-between gap-2 mb-5">
                      <div
                        className={`w-11 h-11 rounded-xl border-2 border-black flex items-center justify-center ${item.accent}`}
                      >
                        <Icon size={22} strokeWidth={2.5} aria-hidden="true" />
                      </div>
                      <span className="text-[11px] font-black uppercase tracking-wider text-gray-500">
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

        {/* Como Funciona — Dois Lados */}
        <section id="como-funciona" className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-white border-b-2 border-black">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-2xl mx-auto mb-12">
              <span className="inline-block rounded-full border-2 border-black bg-canvas text-accent px-3.5 py-1 text-xs font-black uppercase tracking-wider mb-3">
                Em 3 passos
              </span>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-accent">
                Simples para o dono, claro para o freela
              </h2>
              <p className="mt-3 text-base sm:text-lg text-gray-600">
                Sua empresa traz quem já confia, chama direto para cada turno e fecha o pagamento
                com recibo registrado para os dois lados.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Para Empresas */}
              <div className="rounded-2xl border-2 border-black bg-canvas p-6 sm:p-8 shadow-[6px_6px_0_0_#2563EB]">
                <div className="flex items-center justify-between gap-2 mb-7 pb-4 border-b-2 border-black/15">
                  <h3 className="text-xl font-black flex items-center gap-2.5 text-accent">
                    <Briefcase size={22} strokeWidth={2.5} className="text-blue-700" aria-hidden="true" />
                    Para empresas
                  </h3>
                  <span className="rounded-full border-2 border-black bg-blue-600 text-white px-3 py-0.5 text-[11px] font-black uppercase tracking-wider">
                    Gestor e Encarregado
                  </span>
                </div>
                <ol className="space-y-6">
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-blue-600 text-white border-2 border-black rounded-xl flex items-center justify-center shadow-[2px_2px_0_0_#111]">
                      <UserPlus size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-accent">1. Monte seu Elenco</p>
                      <p className="text-sm text-gray-600 mt-0.5 leading-relaxed">
                        Envie o link do Elenco para os freelas com quem você já trabalha e separe
                        em listas por função.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-blue-600 text-white border-2 border-black rounded-xl flex items-center justify-center shadow-[2px_2px_0_0_#111]">
                      <CalendarCheck size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-accent">
                        2. Dispare turnos e confirme presença
                      </p>
                      <p className="text-sm text-gray-600 mt-0.5 leading-relaxed">
                        Crie turnos avulsos, em série ou em lote. Chame vários freelas de uma vez e
                        registre chegada e saída no local pelo QR.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-blue-600 text-white border-2 border-black rounded-xl flex items-center justify-center shadow-[2px_2px_0_0_#111]">
                      <Receipt size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-accent">
                        3. Exporte a planilha de PIX
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
              <div className="rounded-2xl border-2 border-black bg-accent text-white p-6 sm:p-8 shadow-[6px_6px_0_0_#00A651]">
                <div className="flex items-center justify-between gap-2 mb-7 pb-4 border-b-2 border-white/15">
                  <h3 className="text-xl font-black flex items-center gap-2.5 text-[#5EF0A3]">
                    <Users size={22} strokeWidth={2.5} aria-hidden="true" />
                    Para freelas
                  </h3>
                  <span className="rounded-full border border-white/30 bg-primary text-white px-3 py-0.5 text-[11px] font-black uppercase tracking-wider">
                    Sua carreira
                  </span>
                </div>
                <ol className="space-y-6">
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-primary text-white border-2 border-white/90 rounded-xl flex items-center justify-center">
                      <Clock size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-white">1. Aceite em um toque</p>
                      <p className="text-sm text-gray-300 mt-0.5 leading-relaxed">
                        Receba aviso no celular e por e-mail quando uma empresa do seu Elenco abrir
                        um turno e garanta a vaga na hora.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-primary text-white border-2 border-white/90 rounded-xl flex items-center justify-center">
                      <QrCode size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-extrabold text-base text-white">
                        2. Comprove suas horas no local
                      </p>
                      <p className="text-sm text-gray-300 mt-0.5 leading-relaxed">
                        Leia o QR do responsável na chegada e na saída para deixar seu horário real
                        registrado sem discussão.
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
                        comprovantes de renda com você.
                      </p>
                    </div>
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ (SEO + Objeções Reais) */}
        <section id="duvidas" className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-canvas border-b-2 border-black">
          <div className="max-w-4xl mx-auto">
            <div className="mb-10">
              <span className="inline-block rounded-full border-2 border-black bg-white px-3.5 py-1 text-xs font-black uppercase tracking-wider mb-3 shadow-[2px_2px_0_0_#111]">
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
                  className="group rounded-2xl border-2 border-black bg-white shadow-[4px_4px_0_0_#111]"
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

        {/* CTA Final Moderno-Brutalista (Preto + Verde Workyn, sem amarelo) */}
        <section className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-accent text-white text-center border-b-2 border-black">
          <div className="max-w-3xl mx-auto space-y-6">
            <span className="inline-block rounded-full border border-white/25 bg-white/10 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-[#5EF0A3]">
              Cadastro gratuito
            </span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight leading-tight">
              Coloque sua escala de freelas em ordem hoje
            </h2>
            <p className="text-base sm:text-lg text-gray-300 max-w-xl mx-auto leading-relaxed">
              Leva menos de 2 minutos para criar a conta, convidar seu Elenco e abrir o primeiro
              turno no celular.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
              <Button
                variant="primary"
                size="lg"
                onClick={() => navigate('/login?type=hire&cadastro=1')}
                className="border-2 border-white shadow-[4px_4px_0_0_#2563EB] font-extrabold"
              >
                Criar conta de empresa
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => navigate('/login?type=work&cadastro=1')}
                className="border-2 border-white bg-white text-black shadow-[4px_4px_0_0_#00A651] font-extrabold"
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
              &copy; {new Date().getFullYear()} Workyn. Gestão de turnos, presença e pagamentos para
              o trabalho freela.
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
