
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Briefcase, Users, DollarSign, UserPlus, CalendarCheck, Receipt } from 'lucide-react';

export default function Onboarding() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#F4F4F0] font-sans text-accent overflow-hidden flex flex-col">

      {/* Header / Nav */}
      <nav className="flex items-center justify-between p-6 md:px-12 z-10 border-b-2 border-black/5">
        <div className="flex items-center gap-2">
          <img src="/worki.icon.png" alt="Worki Logo" className="w-8 h-8 object-contain" />
          <span className="text-2xl font-black tracking-tighter uppercase">Worki.</span>
        </div>
        <div className="flex items-center gap-6">
          <button
            onClick={() => navigate('/sobre')}
            className="min-h-11 px-2 -mx-2 inline-flex items-center justify-center font-bold text-gray-500 hover:text-black transition-colors"
          >
            Sobre
          </button>
          <button
            onClick={() => navigate('/login')}
            className="min-h-11 px-2 -mx-2 inline-flex items-center justify-center font-bold underline decoration-2 underline-offset-4 hover:decoration-primary transition-all"
          >
            Login
          </button>
        </div>
      </nav>

      {/* Hero Marquee - Abstract Representation without external lib */}
      <div className="relative w-full overflow-hidden bg-accent py-3 rotate-[-1deg] scale-105 my-8 shadow-float">
        <div className="whitespace-nowrap animate-marquee flex gap-8 text-white font-black text-xl uppercase tracking-widest">
          {Array(20).fill("WORKI • SEU ELENCO DE CONFIANÇA • CONVIDE PRO TURNO • PAGUE E REGISTRE • ").map((text, i) => (
            <span key={i}>{text}</span>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col md:flex-row items-center justify-center p-6 gap-8 max-w-7xl mx-auto w-full">

        {/* Left: Value Prop */}
        <div className="flex-1 space-y-8 max-w-xl">
          <h1 className="text-6xl md:text-8xl font-black leading-[0.9] tracking-tighter">
            O JEITO CERTO DE TRABALHAR <br />
            <span className="text-primary text-stroke-black">COM QUEM VOCÊ JÁ CONFIA.</span>
          </h1>
          <p className="text-xl font-medium text-gray-600 max-w-md border-l-4 border-primary pl-4">
            Empresa e freela que já trabalham juntos — agora com contrato, comprovante e reputação.
            Sem virar vínculo, sem bagunça de WhatsApp.
          </p>

          <div className="flex items-center gap-2 text-sm font-bold text-gray-500">
            <Users size={18} className="text-primary" strokeWidth={2.5} />
            Feito pra quem já trabalha junto — não pra estranhos.
          </div>
        </div>

        {/* Right: Action Cards (Neo-Brutalist) */}
        <div className="flex-1 grid gap-6 w-full max-w-md">

          {/* Card: I want to Work */}
          <button
            onClick={() => navigate('/login?type=work')}
            className="group relative bg-white border-2 border-black rounded-2xl p-8 text-left transition-all hover:-translate-y-1 hover:shadow-[8px_8px_0px_0px_rgba(0,166,81,1)]"
          >
            <div className="absolute top-4 right-4 bg-primary text-white text-xs font-bold px-2 py-1 rounded-sm uppercase">
              Para Freelancers
            </div>
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4 group-hover:bg-primary group-hover:text-white transition-colors border-2 border-black">
              <DollarSign size={24} strokeWidth={3} />
            </div>
            <h3 className="text-2xl font-black uppercase mb-1">Quero Trabalhar</h3>
            <p className="text-gray-500 font-medium text-sm">Seja dono do seu trabalho. Seu histórico, sua avaliação e seu comprovante de renda — que ninguém tira de você.</p>
            <ArrowRight className="absolute bottom-8 right-8 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>

          {/* Card: I want to Hire */}
          <button
            onClick={() => navigate('/login?type=hire')}
            className="group relative bg-accent text-white border-2 border-black rounded-2xl p-8 text-left transition-all hover:-translate-y-1 hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,0.3)]"
          >
            <div className="absolute top-4 right-4 bg-white text-black text-xs font-bold px-2 py-1 rounded-sm uppercase">
              Para Empresas
            </div>
            <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center mb-4 group-hover:bg-white group-hover:text-black transition-colors border-2 border-white">
              <Briefcase size={24} strokeWidth={3} />
            </div>
            <h3 className="text-2xl font-black uppercase mb-1">Quero Contratar</h3>
            <p className="text-gray-400 font-medium text-sm">Monte seu elenco de freelas de confiança. Contrate direto, registre cada turno e controle o gasto — tudo num lugar só.</p>
            <ArrowRight className="absolute bottom-8 right-8 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>

        </div>

      </main>

      {/* Como Funciona — honesto, sem números inventados (piloto: convite push) */}
      <section className="py-20 px-6 bg-[#F4F4F0] border-y-2 border-black/10">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black uppercase mb-4">Como Funciona</h2>
            <p className="text-xl text-gray-600 font-medium max-w-2xl mx-auto">
              Sem feed de vagas públicas: a empresa monta o próprio elenco de freelas de confiança e convida
              direto pra cada turno.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Para Empresas */}
            <div className="bg-white border-2 border-black rounded-2xl p-8">
              <h3 className="text-xl font-black uppercase mb-6 flex items-center gap-2">
                <Briefcase size={22} strokeWidth={2.5} /> Para Empresas
              </h3>
              <ol className="space-y-5">
                <li className="flex items-start gap-4">
                  <div className="w-9 h-9 shrink-0 bg-black text-white rounded-full flex items-center justify-center">
                    <UserPlus size={18} strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="font-bold">Monte seu elenco</p>
                    <p className="text-sm text-gray-500 font-medium">Convide os freelas com quem você já trabalha pra sua carteira de clientes.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <div className="w-9 h-9 shrink-0 bg-black text-white rounded-full flex items-center justify-center">
                    <CalendarCheck size={18} strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="font-bold">Convide pra cada turno</p>
                    <p className="text-sm text-gray-500 font-medium">Sem re-negociar de novo: convide direto quem já faz parte da equipe.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <div className="w-9 h-9 shrink-0 bg-black text-white rounded-full flex items-center justify-center">
                    <Receipt size={18} strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="font-bold">Pague e registre</p>
                    <p className="text-sm text-gray-500 font-medium">Pague como preferir (PIX, dinheiro) e mantenha o registro de pagamento organizado.</p>
                  </div>
                </li>
              </ol>
            </div>

            {/* Para Freelas */}
            <div className="bg-accent text-white border-2 border-black rounded-2xl p-8">
              <h3 className="text-xl font-black uppercase mb-6 flex items-center gap-2 text-primary">
                <Users size={22} strokeWidth={2.5} /> Para Freelas
              </h3>
              <ol className="space-y-5">
                <li className="flex items-start gap-4">
                  <div className="w-9 h-9 shrink-0 bg-primary text-white rounded-full flex items-center justify-center">
                    <UserPlus size={18} strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="font-bold text-white">Aceite o convite</p>
                    <p className="text-sm text-gray-400 font-medium">Entre na equipe de uma empresa que já te chamou pra trabalhar.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <div className="w-9 h-9 shrink-0 bg-primary text-white rounded-full flex items-center justify-center">
                    <CalendarCheck size={18} strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="font-bold text-white">Trabalhe</p>
                    <p className="text-sm text-gray-400 font-medium">Faça check-in e checkout direto pelo app quando o turno acontecer.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <div className="w-9 h-9 shrink-0 bg-primary text-white rounded-full flex items-center justify-center">
                    <DollarSign size={18} strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="font-bold text-white">Construa sua reputação</p>
                    <p className="text-sm text-gray-400 font-medium">Cada turno vira histórico, avaliação e recibo — sua carteira de trabalho.</p>
                  </div>
                </li>
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 px-6 bg-primary text-white text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
        <div className="relative z-10 max-w-3xl mx-auto space-y-8">
          <h2 className="text-5xl md:text-7xl font-black uppercase tracking-tighter">Pronto para começar?</h2>
          <p className="text-2xl font-medium max-w-xl mx-auto">Monte sua equipe de confiança ou entre pra uma — leva menos de 2 minutos.</p>

          <div className="flex flex-col md:flex-row justify-center gap-4 mt-8">
            <button
              onClick={() => navigate('/login?type=work&cadastro=1')}
              className="bg-black text-white px-8 py-4 rounded-xl font-black uppercase text-lg hover:scale-105 transition-transform shadow-[6px_6px_0px_0px_rgba(255,255,255,0.3)]"
            >
              Cadastrar como Trabalhador
            </button>
            <button
              onClick={() => navigate('/login?type=hire&cadastro=1')}
              className="bg-white text-black px-8 py-4 rounded-xl font-black uppercase text-lg hover:scale-105 transition-transform"
            >
              Cadastrar como Empresa
            </button>
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
        .text-stroke-black {
          -webkit-text-stroke: 1px black;
        }
      `}</style>
    </div>
  );
}
