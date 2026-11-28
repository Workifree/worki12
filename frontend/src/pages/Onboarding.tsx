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

const FEATURES = [
  {
    tag: 'OPERAÇÃO',
    tagClass: 'bg-[#FFE14D] text-black',
    icon: Megaphone,
    iconBg: 'bg-[#FFE14D]',
    title: 'Chamado para vários freelas',
    description:
      'Selecione seu Elenco ou uma lista salva (Cozinha, Salão, Bar) e dispare de uma vez. Quem aceitar primeiro garante a vaga, com prazo configurável até 1h antes do turno.',
  },
  {
    tag: 'PRESENÇA',
    tagClass: 'bg-primary text-white',
    icon: QrCode,
    iconBg: 'bg-[#D7F5E4]',
    title: 'Check-in com QR e GPS no local',
    description:
      'O encarregado mostra o QR dinâmico na tela e o freela registra chegada e saída no local. As horas reais trabalhadas vão direto para o relatório e para o recibo.',
  },
  {
    tag: 'FINANCEIRO',
    tagClass: 'bg-blue-600 text-white',
    icon: FileSpreadsheet,
    iconBg: 'bg-blue-100',
    title: 'Relatório completo e planilha de PIX',
    description:
      'Filtre por período, loja, encarregado ou freela. Exporte a planilha CSV com horas, valores, CPF, chave PIX e recibos pronta para pagar e mandar para a contabilidade.',
  },
  {
    tag: 'EQUIPE',
    tagClass: 'bg-black text-white',
    icon: Building2,
    iconBg: 'bg-gray-200',
    title: 'Encarregados e lojas no mesmo lugar',
    description:
      'Convide encarregados por link único preso ao e-mail. Cada pessoa opera apenas os próprios turnos, vinculados à sua loja, enquanto o Gestor acompanha toda a operação.',
  },
  {
    tag: 'AVISOS',
    tagClass: 'bg-[#FFE14D] text-black',
    icon: Bell,
    iconBg: 'bg-[#FFE14D]',
    title: 'Notificação no celular e por e-mail',
    description:
      'Convites de turno, confirmações de véspera, aceites e cancelamentos chegam por notificação push no celular e por e-mail, mesmo com o navegador fechado.',
  },
  {
    tag: 'RECIBO',
    tagClass: 'bg-primary text-white',
    icon: ShieldCheck,
    iconBg: 'bg-[#D7F5E4]',
    title: 'Pagamento direto com comprovante',
    description:
      'Você paga o freela por fora (PIX ou dinheiro) e registra no Workyn. O freela confirma o recebimento e acumula histórico, avaliação e comprovante de renda portáteis.',
  },
];

const COMPARISON = [
  {
    antes: 'Mandar mensagem um por um no WhatsApp às 8h da manhã rezando para alguém responder.',
    depois: 'Disparar um chamado para todo o Elenco de uma vez: o primeiro que aceitar fecha a vaga.',
  },
  {
    antes: 'Descobrir na hora de abrir a loja que o freela esqueceu o turno ou desistiu.',
    depois: 'Confirmação automática de véspera, aviso no celular e painel Hoje mostrando quem já chegou.',
  },
  {
    antes: 'Perder horas no fim da semana juntando chave PIX, nome e valor em planilha manual.',
    depois: 'Gerar a planilha de pagamento filtrada por período e loja em um clique, com horas reais e recibo.',
  },
  {
    antes: 'Encarregados sem controle ou vendo dados financeiros que deveriam ficar só com o Gestor.',
    depois: 'Cada encarregado vê apenas os próprios turnos; CPF, PIX e financeiro ficam restritos ao Gestor.',
  },
];

const FAQ_ITEMS = [
  {
    q: 'O Workyn cobra mensalidade ou comissão sobre o valor do freela?',
    a: 'Comece gratuitamente. O pagamento do turno continua sendo feito direto por você ao freela (por PIX ou dinheiro), e o Workyn organiza os turnos, a presença, os recibos e a planilha financeira.',
  },
  {
    q: 'Preciso contratar desconhecidos ou posso usar meus próprios freelas?',
    a: 'O Workyn é feito para o seu Elenco de confiança. Você envia um link para os freelas com quem já trabalha, organiza em listas por função e chama direto quando precisar.',
  },
  {
    q: 'Funciona para empresas com vários encarregados ou mais de uma loja?',
    a: 'Sim. Em Configurações → Equipe você convida encarregados e gestores por link único e pode vincular cada encarregado a uma loja (etiqueta). Todo turno criado por ele já sai separado por loja no relatório financeiro.',
  },
  {
    q: 'O Workyn ajuda a evitar risco de recorrência excessiva com o mesmo freela?',
    a: 'Sim. Ao montar um chamado ou série de turnos, o Workyn exibe um alerta objetivo mostrando quantas vezes aquele freela já trabalhou na semana na sua empresa, para você decidir com clareza.',
  },
  {
    q: 'O freela precisa baixar aplicativo na App Store ou Play Store?',
    a: 'Funciona direto no navegador do celular e pode ser adicionado à Tela de Início como aplicativo, com notificações push no celular e avisos por e-mail.',
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

      {/* Header / Nav Brutalista */}
      <header className="sticky top-0 z-40 bg-canvas border-b-2 border-black">
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
              width={36}
              height={36}
              className="w-9 h-9 border-2 border-black rounded-lg shadow-[2px_2px_0_0_#000] bg-white"
            />
            <span className="text-2xl font-black tracking-tight uppercase">Workyn.</span>
          </a>

          <div className="hidden md:flex items-center gap-6 text-sm font-extrabold uppercase tracking-wide">
            <a href="#recursos" className="hover:underline underline-offset-4">
              Recursos
            </a>
            <a href="#como-funciona" className="hover:underline underline-offset-4">
              Como funciona
            </a>
            <a href="#duvidas" className="hover:underline underline-offset-4">
              Dúvidas
            </a>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => navigate('/login')}
              className="border-2 border-black shadow-brutal-sm font-black uppercase text-xs sm:text-sm"
            >
              Entrar
            </Button>
            <Button
              variant="dark"
              size="md"
              onClick={() => navigate('/login?type=hire&cadastro=1')}
              className="hidden sm:inline-flex border-2 border-black shadow-brutal-sm font-black uppercase text-xs sm:text-sm"
            >
              Começar grátis
            </Button>
          </div>
        </nav>
      </header>

      {/* Hero Brutalista */}
      <main>
        <section className="px-4 sm:px-6 md:px-10 pt-10 pb-14 md:pt-16 md:pb-20 max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Coluna Esquerda: Headline + Proposta de Valor */}
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-lg border-2 border-black bg-[#FFE14D] px-3 py-1.5 text-xs font-black uppercase tracking-wider shadow-[3px_3px_0_0_#000]">
                <span>Restaurantes</span>
                <span aria-hidden="true">•</span>
                <span>Bares</span>
                <span aria-hidden="true">•</span>
                <span>Eventos</span>
                <span aria-hidden="true">•</span>
                <span>Operações</span>
              </div>

              <h1 className="text-4xl sm:text-5xl md:text-6xl font-black uppercase leading-[0.98] tracking-tight text-accent">
                Pare de fechar escala de freela{' '}
                <span className="inline-block bg-primary text-white px-2.5 py-0.5 border-2 border-black shadow-[4px_4px_0_0_#000] mt-1">
                  no WhatsApp.
                </span>
              </h1>

              <p className="text-base sm:text-lg md:text-xl font-medium text-gray-800 max-w-2xl border-l-4 border-black pl-4 leading-relaxed">
                Chame seu Elenco de confiança em um toque, confirme presença no local com QR e GPS
                e exporte a planilha de PIX pronta para o financeiro.
              </p>

              {/* Micro-provas objetivas do produto */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div className="rounded-xl border-2 border-black bg-white p-3 shadow-[3px_3px_0_0_#000]">
                  <p className="text-xs font-black uppercase text-blue-700">Chamado 1 → N</p>
                  <p className="text-sm font-bold mt-0.5">Quem aceitar primeiro fica com a vaga</p>
                </div>
                <div className="rounded-xl border-2 border-black bg-white p-3 shadow-[3px_3px_0_0_#000]">
                  <p className="text-xs font-black uppercase text-primary">Financeiro limpo</p>
                  <p className="text-sm font-bold mt-0.5">Horas reais, recibo e CSV de PIX</p>
                </div>
                <div className="rounded-xl border-2 border-black bg-white p-3 shadow-[3px_3px_0_0_#000]">
                  <p className="text-xs font-black uppercase text-black">Mobile-first</p>
                  <p className="text-sm font-bold mt-0.5">Push no celular e e-mail na hora</p>
                </div>
              </div>
            </div>

            {/* Coluna Direita: 2 Cartões de Entrada Neo-Brutalistas */}
            <div className="lg:col-span-5 grid gap-5 w-full">
              {/* Card Empresa */}
              <button
                type="button"
                data-copilot="publico.entrada.escolher-empresa"
                onClick={() => navigate('/login?type=hire&cadastro=1')}
                className="group relative bg-accent text-white border-2 border-black rounded-2xl p-6 sm:p-7 text-left shadow-[6px_6px_0_0_#2563EB] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[8px_8px_0_0_#2563EB] active:translate-x-0.5 active:translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
              >
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="w-12 h-12 bg-blue-600 text-white rounded-xl flex items-center justify-center border-2 border-white">
                    <Briefcase size={24} strokeWidth={2.5} aria-hidden="true" />
                  </div>
                  <span className="bg-[#FFE14D] text-black border-2 border-black text-xs font-black uppercase px-3 py-1 rounded-lg">
                    Para empresas
                  </span>
                </div>
                <h2 className="text-2xl font-black uppercase tracking-tight mb-1.5">
                  Quero contratar
                </h2>
                <p className="text-gray-200 text-sm leading-relaxed">
                  Monte seu Elenco de confiança, delegue turnos para encarregados por loja e feche o
                  pagamento da semana em minutos.
                </p>
                <span className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-black bg-[#FFE14D] px-4 text-sm font-black uppercase text-black group-hover:bg-white transition-colors">
                  Criar conta de empresa <ArrowRight size={18} aria-hidden="true" />
                </span>
              </button>

              {/* Card Freela */}
              <button
                type="button"
                data-copilot="publico.entrada.escolher-freela"
                onClick={() => navigate('/login?type=work&cadastro=1')}
                className="group relative bg-white text-accent border-2 border-black rounded-2xl p-6 sm:p-7 text-left shadow-[6px_6px_0_0_#00A651] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[8px_8px_0_0_#00A651] active:translate-x-0.5 active:translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
              >
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="w-12 h-12 bg-[#D7F5E4] text-primary rounded-xl flex items-center justify-center border-2 border-black">
                    <DollarSign size={24} strokeWidth={2.5} aria-hidden="true" />
                  </div>
                  <span className="bg-primary text-white border-2 border-black text-xs font-black uppercase px-3 py-1 rounded-lg">
                    Para freelas
                  </span>
                </div>
                <h2 className="text-2xl font-black uppercase tracking-tight mb-1.5">
                  Quero trabalhar
                </h2>
                <p className="text-gray-700 text-sm leading-relaxed">
                  Receba convites no celular, faça check-in no local e construa sua carteira portátil
                  com avaliações e comprovantes de renda.
                </p>
                <span className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-black bg-primary px-4 text-sm font-black uppercase text-white group-hover:bg-black transition-colors">
                  Criar conta de freela <ArrowRight size={18} aria-hidden="true" />
                </span>
              </button>
            </div>
          </div>
        </section>

        {/* Faixa Marquee Brutalista */}
        <div className="relative flex w-full items-center bg-accent border-y-2 border-black">
          <div className="min-w-0 flex-1 overflow-hidden py-3" aria-hidden="true">
            <div
              data-paused={marqueePaused}
              className="whitespace-nowrap animate-marquee flex gap-8 text-[#FFE14D] font-black text-sm uppercase tracking-widest"
            >
              {Array(16)
                .fill(
                  'WORKYN • SEU ELENCO DE CONFIANÇA • CHAMADO 1 PARA VÁRIOS • PRESENÇA COM QR E GPS • PLANILHA DE PIX PRONTA • RECIBO AUTOMÁTICO • ',
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
            {marqueePaused ? <Play size={20} /> : <Pause size={20} />}
          </IconButton>
        </div>

        {/* Antes x Depois: Dor Real de Operação */}
        <section className="px-4 sm:px-6 md:px-10 py-16 md:py-20 bg-white border-b-2 border-black">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-3xl mb-10">
              <span className="inline-block rounded-lg border-2 border-black bg-blue-100 text-blue-900 px-3 py-1 text-xs font-black uppercase tracking-wider mb-3">
                O que muda na prática
              </span>
              <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight">
                Do improviso no grupo para uma operação registrável
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {COMPARISON.map((row, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border-2 border-black bg-canvas p-5 sm:p-6 shadow-[4px_4px_0_0_#000] flex flex-col gap-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 border-black bg-red-100 text-red-700">
                      <X size={16} strokeWidth={3} aria-hidden="true" />
                    </span>
                    <p className="text-sm text-gray-700 line-through decoration-red-500/70">
                      {row.antes}
                    </p>
                  </div>
                  <div className="border-t-2 border-dashed border-black/20 pt-4 flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 border-black bg-primary text-white">
                      <Check size={16} strokeWidth={3} aria-hidden="true" />
                    </span>
                    <p className="text-sm sm:text-base font-bold text-accent">{row.depois}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Recursos Completos — Grid Neo-Brutalista */}
        <section id="recursos" className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-canvas border-b-2 border-black">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-3xl mb-12">
              <span className="inline-block rounded-lg border-2 border-black bg-[#FFE14D] text-black px-3 py-1 text-xs font-black uppercase tracking-wider mb-3 shadow-[2px_2px_0_0_#000]">
                Tudo no mesmo painel
              </span>
              <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight">
                Feito para quem toca turno todo dia
              </h2>
              <p className="mt-3 text-base sm:text-lg text-gray-700">
                Da criação do turno até a prestação de contas do financeiro, cada etapa fica gravada
                para a empresa e para o freela.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <article
                    key={f.title}
                    className="rounded-2xl border-2 border-black bg-white p-6 shadow-[5px_5px_0_0_#000] flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-5">
                        <div
                          className={`w-12 h-12 rounded-xl border-2 border-black flex items-center justify-center ${f.iconBg}`}
                        >
                          <Icon size={24} strokeWidth={2.5} aria-hidden="true" />
                        </div>
                        <span
                          className={`rounded-md border-2 border-black px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider ${f.tagClass}`}
                        >
                          {f.tag}
                        </span>
                      </div>
                      <h3 className="text-xl font-black uppercase tracking-tight mb-2">
                        {f.title}
                      </h3>
                      <p className="text-sm sm:text-base text-gray-700 leading-relaxed">
                        {f.description}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* Como Funciona — Dois Lados em Alto Contraste */}
        <section id="como-funciona" className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-white border-b-2 border-black">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-2xl mx-auto mb-12">
              <span className="inline-block rounded-lg border-2 border-black bg-[#D7F5E4] text-primary px-3 py-1 text-xs font-black uppercase tracking-wider mb-3">
                Em 3 passos
              </span>
              <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight">
                Como o Workyn funciona
              </h2>
              <p className="mt-3 text-base sm:text-lg text-gray-700">
                Sua empresa traz os freelas que já conhece, chama direto para cada turno e fecha o
                pagamento com recibo dos dois lados.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Para Empresas */}
              <div className="rounded-2xl border-2 border-black bg-canvas p-6 sm:p-8 shadow-[6px_6px_0_0_#2563EB]">
                <div className="flex items-center justify-between gap-2 mb-7 pb-4 border-b-2 border-black">
                  <h3 className="text-xl font-black uppercase flex items-center gap-2.5">
                    <Briefcase size={22} strokeWidth={2.5} className="text-blue-700" aria-hidden="true" />
                    Para empresas
                  </h3>
                  <span className="rounded-lg border-2 border-black bg-blue-600 text-white px-2.5 py-0.5 text-xs font-black uppercase">
                    Gestor e Encarregado
                  </span>
                </div>
                <ol className="space-y-6">
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-blue-600 text-white border-2 border-black rounded-xl flex items-center justify-center font-black shadow-[2px_2px_0_0_#000]">
                      <UserPlus size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-black uppercase text-sm">1. Monte seu Elenco</p>
                      <p className="text-sm text-gray-700 mt-0.5">
                        Compartilhe o link do seu Elenco com os freelas que já trabalham com você e
                        organize listas por função.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-blue-600 text-white border-2 border-black rounded-xl flex items-center justify-center font-black shadow-[2px_2px_0_0_#000]">
                      <CalendarCheck size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-black uppercase text-sm">2. Dispare o turno e acompanhe</p>
                      <p className="text-sm text-gray-700 mt-0.5">
                        Crie turnos avulsos, em série ou em lote. Chame vários freelas ao mesmo tempo
                        e confirme a chegada no local via QR.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-blue-600 text-white border-2 border-black rounded-xl flex items-center justify-center font-black shadow-[2px_2px_0_0_#000]">
                      <Receipt size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-black uppercase text-sm">3. Exporte a planilha de PIX</p>
                      <p className="text-sm text-gray-700 mt-0.5">
                        Pague por fora (PIX ou dinheiro), registre o pagamento e baixe o relatório
                        por loja, encarregado e freela.
                      </p>
                    </div>
                  </li>
                </ol>
              </div>

              {/* Para Freelas */}
              <div className="rounded-2xl border-2 border-black bg-accent text-white p-6 sm:p-8 shadow-[6px_6px_0_0_#00A651]">
                <div className="flex items-center justify-between gap-2 mb-7 pb-4 border-b-2 border-white/25">
                  <h3 className="text-xl font-black uppercase flex items-center gap-2.5 text-[#5EF0A3]">
                    <Users size={22} strokeWidth={2.5} aria-hidden="true" />
                    Para freelas
                  </h3>
                  <span className="rounded-lg border-2 border-white bg-primary text-white px-2.5 py-0.5 text-xs font-black uppercase">
                    Sua carreira
                  </span>
                </div>
                <ol className="space-y-6">
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-primary text-white border-2 border-white rounded-xl flex items-center justify-center font-black">
                      <UserPlus size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-black uppercase text-sm text-white">1. Aceite em um toque</p>
                      <p className="text-sm text-gray-300 mt-0.5">
                        Receba o aviso no celular e no e-mail quando uma empresa do seu Elenco abrir
                        um turno e garanta a vaga na hora.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-primary text-white border-2 border-white rounded-xl flex items-center justify-center font-black">
                      <QrCode size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-black uppercase text-sm text-white">2. Registre presença no local</p>
                      <p className="text-sm text-gray-300 mt-0.5">
                        Leia o QR do responsável na chegada e na saída para deixar suas horas
                        trabalhadas comprovadas.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 bg-primary text-white border-2 border-white rounded-xl flex items-center justify-center font-black">
                      <DollarSign size={18} strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-black uppercase text-sm text-white">3. Guarde recibos e reputação</p>
                      <p className="text-sm text-gray-300 mt-0.5">
                        Confirme cada pagamento recebido e leve seu histórico, notas e comprovantes
                        com você para qualquer empresa.
                      </p>
                    </div>
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Brutalista (SEO + Conversão) */}
        <section id="duvidas" className="px-4 sm:px-6 md:px-10 py-16 md:py-20 bg-canvas border-b-2 border-black">
          <div className="max-w-4xl mx-auto">
            <div className="mb-10">
              <span className="inline-block rounded-lg border-2 border-black bg-white px-3 py-1 text-xs font-black uppercase tracking-wider mb-3 shadow-[2px_2px_0_0_#000]">
                Perguntas frequentes
              </span>
              <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight">
                Dúvidas antes de começar
              </h2>
            </div>

            <div className="space-y-4">
              {FAQ_ITEMS.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-2xl border-2 border-black bg-white shadow-[4px_4px_0_0_#000] open:bg-[#FFFEF7]"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 font-black text-base sm:text-lg">
                    <span>{item.q}</span>
                    <ChevronDown
                      size={20}
                      className="shrink-0 transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="px-5 pb-5 pt-0 text-sm sm:text-base text-gray-700 leading-relaxed border-t-2 border-black/10">
                    <p className="pt-3">{item.a}</p>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Final Brutalista */}
        <section className="px-4 sm:px-6 md:px-10 py-16 md:py-24 bg-[#FFE14D] text-black text-center border-b-2 border-black">
          <div className="max-w-3xl mx-auto space-y-6">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight leading-tight">
              Organize seus turnos hoje em menos de 2 minutos
            </h2>
            <p className="text-base sm:text-lg md:text-xl font-bold text-black/80 max-w-xl mx-auto">
              Cadastro gratuito, sem cartão de crédito e pronto para usar no celular.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
              <Button
                variant="dark"
                size="lg"
                onClick={() => navigate('/login?type=hire&cadastro=1')}
                className="border-2 border-black shadow-[4px_4px_0_0_#000] font-black uppercase"
              >
                Criar conta de empresa
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => navigate('/login?type=work&cadastro=1')}
                className="border-2 border-black bg-white shadow-[4px_4px_0_0_#000] font-black uppercase"
              >
                Criar conta de freela
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer Completo */}
      <footer className="px-4 sm:px-6 md:px-10 py-10 bg-accent text-white">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-center md:text-left">
            <p className="text-xl font-black uppercase tracking-tight">Workyn.</p>
            <p className="text-xs text-gray-400 mt-1">
              &copy; {new Date().getFullYear()} Workyn. Gestão de turnos, presença e pagamentos para o trabalho freela.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-x-2 gap-y-1 text-sm font-bold">
            <button
              type="button"
              onClick={() => navigate('/sobre')}
              className="min-h-11 px-3 text-gray-300 hover:text-[#FFE14D] transition-colors"
            >
              Sobre
            </button>
            <button
              type="button"
              onClick={() => navigate('/termos')}
              className="min-h-11 px-3 text-gray-300 hover:text-[#FFE14D] transition-colors"
            >
              Termos de Uso
            </button>
            <button
              type="button"
              onClick={() => navigate('/privacidade')}
              className="min-h-11 px-3 text-gray-300 hover:text-[#FFE14D] transition-colors"
            >
              Privacidade
            </button>
            <button
              type="button"
              onClick={() => navigate('/licencas')}
              className="min-h-11 px-3 text-gray-300 hover:text-[#FFE14D] transition-colors"
            >
              Licenças
            </button>
            <button
              type="button"
              onClick={() => navigate('/ajuda')}
              className="min-h-11 px-3 text-gray-300 hover:text-[#FFE14D] transition-colors"
            >
              Ajuda
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
