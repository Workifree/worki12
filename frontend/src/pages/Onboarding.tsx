
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Briefcase, Users, DollarSign, UserPlus, CalendarCheck, Receipt } from 'lucide-react';
import { Button } from '../components/ui';

export default function Onboarding() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#F4F4F0] font-sans text-accent overflow-hidden flex flex-col">

      {/* Header / Nav */}
      <nav className="flex items-center justify-between p-6 md:px-12 z-10 border-b-2 border-black/5">
        <div className="flex items-center gap-2">
          <img src="/worki.icon.png" alt="Worki Logo" className="w-8 h-8 object-contain" />
          <span className="text-2xl font-bold tracking-tight">Worki.</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/sobre')}
            className="min-h-11 px-3 inline-flex items-center justify-center rounded-xl text-sm font-semibold text-gray-600 hover:text-black hover:bg-black/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
          >
            Sobre
          </button>
          <Button variant="secondary" size="md" onClick={() => navigate('/login')}>
            Login
          </Button>
        </div>
      </nav>

      {/* Faixa de marca — discreta, sem rotação */}
      <div className="relative w-full overflow-hidden bg-accent py-2.5 my-8" aria-hidden="true">
        <div className="whitespace-nowrap animate-marquee flex gap-8 text-white font-semibold text-sm uppercase tracking-widest">
          {Array(20).fill("WORKI • SEU ELENCO DE CONFIANÇA • CONVIDE PRO TURNO • PAGUE E REGISTRE • ").map((text, i) => (
            <span key={i}>{text}</span>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col md:flex-row items-center justify-center p-6 gap-10 max-w-7xl mx-auto w-full">

        {/* Left: Value Prop */}
        <div className="flex-1 space-y-6 max-w-xl">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.05] tracking-tight">
            O jeito certo de trabalhar <br />
            <span className="text-primary">com quem você já confia.</span>
          </h1>
          <p className="text-lg text-gray-600 max-w-md border-l-4 border-primary pl-4">
            Empresa e freela que já trabalham juntos — agora com contrato, comprovante e reputação.
            Sem virar vínculo, sem bagunça de WhatsApp.
          </p>

          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Users size={18} className="text-primary" strokeWidth={2.5} aria-hidden="true" />
            Feito pra quem já trabalha junto — não pra estranhos.
          </div>
        </div>

        {/* Right: Action Cards (Neo-Brutalist) */}
        <div className="flex-1 grid gap-4 w-full max-w-md">

          {/* Card: I want to Work */}
          <button
            onClick={() => navigate('/login?type=work')}
            className="group relative bg-white border-2 border-black rounded-2xl p-6 sm:p-8 text-left transition-all hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_0px_rgba(0,166,81,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
          >
            <div className="absolute top-4 right-4 bg-primary-dark text-white text-xs font-semibold px-2.5 py-1 rounded-full">
              Para freelancers
            </div>
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4 group-hover:bg-primary group-hover:text-white transition-colors border-2 border-black">
              <DollarSign size={22} strokeWidth={2.5} aria-hidden="true" />
            </div>
            <h3 className="text-xl font-bold mb-1">Quero trabalhar</h3>
            <p className="text-gray-600 text-sm pr-8">Seja dono do seu trabalho. Seu histórico, sua avaliação e seu comprovante de renda — que ninguém tira de você.</p>
            <ArrowRight className="absolute bottom-6 right-6 sm:bottom-8 sm:right-8 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
          </button>

          {/* Card: I want to Hire */}
          <button
            onClick={() => navigate('/login?type=hire')}
            className="group relative bg-accent text-white border-2 border-black rounded-2xl p-6 sm:p-8 text-left transition-all hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
          >
            <div className="absolute top-4 right-4 bg-white text-black text-xs font-semibold px-2.5 py-1 rounded-full">
              Para empresas
            </div>
            <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center mb-4 group-hover:bg-white group-hover:text-black transition-colors border-2 border-white">
              <Briefcase size={22} strokeWidth={2.5} aria-hidden="true" />
            </div>
            <h3 className="text-xl font-bold mb-1">Quero contratar</h3>
            <p className="text-gray-300 text-sm pr-8">Monte seu elenco de freelas de confiança. Contrate direto, registre cada turno e controle o gasto — tudo num lugar só.</p>
            <ArrowRight className="absolute bottom-6 right-6 sm:bottom-8 sm:right-8 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
          </button>

        </div>

      </main>

      {/* Como Funciona — honesto, sem números inventados (piloto: convite push) */}
      <section className="py-16 sm:py-20 px-6 bg-[#F4F4F0] border-y-2 border-black/10">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">Como funciona</h2>
            <p className="text-base sm:text-lg text-gray-600 max-w-2xl mx-auto">
              Sem feed de vagas públicas: a empresa monta o próprio elenco de freelas de confiança e convida
              direto pra cada turno.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Para Empresas */}
            <div className="bg-white border-2 border-black rounded-2xl p-6 sm:p-8">
              <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                <Briefcase size={20} strokeWidth={2.5} aria-hidden="true" /> Para empresas
              </h3>
              <ol className="space-y-5">
                <li className="flex items-start gap-4">
                  <div className="w-9 h-9 shrink-0 bg-black text-white rounded-full flex items-center justify-center">
                    <UserPlus size={18} strokeWidth={2.5} aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-bold text-sm">Monte seu elenco</p>
                    <p className="text-sm text-gray-600">Convide pelo link os freelas com quem você já trabalha.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <div className="w-9 h-9 shrink-0 bg-black text-white rounded-full flex items-center justify-center">
                    <CalendarCheck size={18} strokeWidth={2.5} aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-bold text-sm">Convide pra cada turno</p>
                    <p className="text-sm text-gray-600">Sem re-negociar de novo: convide direto quem já faz parte da equipe.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <div className="w-9 h-9 shrink-0 bg-black text-white rounded-full flex items-center justify-center">
                    <Receipt size={18} strokeWidth={2.5} aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-bold text-sm">Pague e registre</p>
                    <p className="text-sm text-gray-600">Pague como preferir (PIX, dinheiro) e mantenha o registro de pagamento organizado.</p>
                  </div>
                </li>
              </ol>
            </div>

            {/* Para Freelas */}
            <div className="bg-accent text-white border-2 border-black rounded-2xl p-6 sm:p-8">
              <h3 className="text-lg font-bold mb-6 flex items-center gap-2 text-primary">
                <Users size={20} strokeWidth={2.5} aria-hidden="true" /> Para freelas
              </h3>
              <ol className="space-y-5">
                <li className="flex items-start gap-4">
                  <div className="w-9 h-9 shrink-0 bg-primary text-white rounded-full flex items-center justify-center">
                    <UserPlus size={18} strokeWidth={2.5} aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-bold text-sm text-white">Aceite o convite</p>
                    <p className="text-sm text-gray-300">Entre na equipe de uma empresa que já te chamou pra trabalhar.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <div className="w-9 h-9 shrink-0 bg-primary text-white rounded-full flex items-center justify-center">
                    <CalendarCheck size={18} strokeWidth={2.5} aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-bold text-sm text-white">Trabalhe</p>
                    <p className="text-sm text-gray-300">Faça check-in e checkout direto pelo app quando o turno acontecer.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <div className="w-9 h-9 shrink-0 bg-primary text-white rounded-full flex items-center justify-center">
                    <DollarSign size={18} strokeWidth={2.5} aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-bold text-sm text-white">Construa sua reputação</p>
                    <p className="text-sm text-gray-300">Cada turno vira histórico, avaliação e recibo — sua carteira de trabalho.</p>
                  </div>
                </li>
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-16 sm:py-20 px-6 bg-primary text-white text-center relative overflow-hidden">
        <div className="relative z-10 max-w-3xl mx-auto space-y-6">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight">Pronto para começar?</h2>
          <p className="text-lg sm:text-xl max-w-xl mx-auto">Monte sua equipe de confiança ou entre pra uma — leva menos de 2 minutos.</p>

          <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
            <Button variant="dark" size="lg" onClick={() => navigate('/login?type=work&cadastro=1')}>
              Cadastrar como Trabalhador
            </Button>
            <Button variant="secondary" size="lg" onClick={() => navigate('/login?type=hire&cadastro=1')}>
              Cadastrar como Empresa
            </Button>
          </div>
        </div>
      </section>

      {/* Simple Marquee Animation Style */}
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          animation: marquee 20s linear infinite;
        }
      `}</style>
    </div>
  );
}
