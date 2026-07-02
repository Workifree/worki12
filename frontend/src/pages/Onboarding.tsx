
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Briefcase, Users, Star, DollarSign } from 'lucide-react';

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
            className="font-bold text-gray-500 hover:text-black transition-colors"
          >
            Sobre
          </button>
          <button
            onClick={() => navigate('/login')}
            className="font-bold underline decoration-2 underline-offset-4 hover:decoration-primary transition-all"
          >
            Login
          </button>
        </div>
      </nav>

      {/* Hero Marquee - Abstract Representation without external lib */}
      <div className="relative w-full overflow-hidden bg-accent py-3 rotate-[-1deg] scale-105 my-8 shadow-float">
        <div className="whitespace-nowrap animate-marquee flex gap-8 text-white font-black text-xl uppercase tracking-widest">
          {Array(20).fill("WORKI • INSTANT SHIFTS • GET PAID • HIRE PROS • ").map((text, i) => (
            <span key={i}>{text}</span>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col md:flex-row items-center justify-center p-6 gap-8 max-w-7xl mx-auto w-full">

        {/* Left: Value Prop */}
        <div className="flex-1 space-y-8 max-w-xl">
          <h1 className="text-6xl md:text-8xl font-black leading-[0.9] tracking-tighter">
            CONFIANÇA <br />
            <span className="text-primary text-stroke-black">DE VERDADE.</span>
          </h1>
          <p className="text-xl font-medium text-gray-600 max-w-md border-l-4 border-primary pl-4">
            A camada de confiança e pagamento entre empresas e freelas que já trabalham juntos.
            Contrate, pague e registre tudo num só lugar — sem virar vínculo, sem bagunça de WhatsApp.
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
              Para Freelas
            </div>
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4 group-hover:bg-primary group-hover:text-white transition-colors border-2 border-black">
              <DollarSign size={24} strokeWidth={3} />
            </div>
            <h3 className="text-2xl font-black uppercase mb-1">Quero Trabalhar</h3>
            <p className="text-gray-500 font-medium text-sm">Sua carteira de trabalho portátil: histórico, avaliação e recebimento — seus, em qualquer job.</p>
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
            <p className="text-gray-400 font-medium text-sm">Centralize sua equipe de freelas de confiança: contrate, pague e registre tudo num só lugar.</p>
            <ArrowRight className="absolute bottom-8 right-8 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>

        </div>

      </main>

      {/* --- NEW SECTIONS BELOW --- */}

      {/* 1. Stats Section */}
      <section className="bg-black text-white py-16 border-y-4 border-black">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { label: 'Trabalhadores', value: '15k+' },
            { label: 'Empresas', value: '2k+' },
            { label: 'Jobs Completos', value: '50k+' },
            { label: 'Vagas Agora', value: '+5.000' },
          ].map((stat, i) => (
            <div key={i} className="flex flex-col items-center">
              <span className="text-4xl md:text-6xl font-black tracking-tighter text-primary">{stat.value}</span>
              <span className="text-xl font-bold uppercase mt-2">{stat.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Detailed Search Section */}
      <section className="py-20 px-6 bg-[#F4F4F0]">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <h2 className="text-4xl md:text-5xl font-black uppercase tracking-tight">
            +5.000 vagas disponíveis <span className="bg-primary px-2 text-white transform -rotate-2 inline-block">agora</span>
          </h2>
          <p className="text-xl font-medium text-gray-600">Trabalho presencial na palma da sua mão. Conectamos empresas a trabalhadores qualificados.</p>

          <div className="bg-white border-2 border-black p-4 rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col md:flex-row gap-4">
            <div className="flex-1 flex items-center bg-gray-100 rounded-xl px-4 border-2 border-transparent focus-within:border-black transition-all">
              <Briefcase size={20} className="text-gray-400" />
              <input type="text" placeholder="Buscar por tipo de trabalho..." className="w-full bg-transparent p-3 outline-none font-bold" />
            </div>
            <div className="flex-1 flex items-center bg-gray-100 rounded-xl px-4 border-2 border-transparent focus-within:border-black transition-all">
              <ArrowRight size={20} className="text-gray-400" />
              <input type="text" placeholder="Cidade ou bairro" className="w-full bg-transparent p-3 outline-none font-bold" />
            </div>
            <button className="bg-black text-white font-black uppercase px-8 py-3 rounded-xl hover:bg-primary transition-colors">
              Buscar Vagas
            </button>
          </div>

          <div className="flex flex-wrap justify-center gap-2 text-sm font-bold">
            <span className="text-gray-500 uppercase">Popular:</span>
            {['Garçom', 'Atendente', 'Promotor', 'Balconista', 'Auxiliar'].map(tag => (
              <span key={tag} className="bg-white border border-black px-3 py-1 rounded-full cursor-pointer hover:bg-primary hover:text-white transition-colors">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* 3. Categories Grid */}
      <section className="py-16 px-6 bg-white border-y-2 border-black/10">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-end mb-12">
            <div>
              <h2 className="text-3xl md:text-4xl font-black uppercase mb-2">Explore por Categoria</h2>
              <p className="text-gray-500 font-medium max-w-lg">Encontre oportunidades de trabalho presencial em diversas áreas. Trabalhos flexíveis de curta duração.</p>
            </div>
            <button className="hidden md:block font-bold underline decoration-2 hover:text-primary">Ver todas as categorias →</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { name: 'Garçom', count: '850+ vagas', icon: '🍷' },
              { name: 'Atendente', count: '620+ vagas', icon: '👋' },
              { name: 'Promotor', count: '340+ vagas', icon: '📢' },
              { name: 'Peão de Obra', count: '280+ vagas', icon: '🏗️' },
              { name: 'Balconista', count: '450+ vagas', icon: '🏪' },
              { name: 'Cozinheiro', count: '180+ vagas', icon: '🍳' },
              { name: 'Motorista', count: '210+ vagas', icon: '🚚' },
              { name: 'Limpeza', count: '390+ vagas', icon: '🧹' },
            ].map((cat, i) => (
              <div key={i} className="group bg-[#F9F9F9] hover:bg-white border-2 border-transparent hover:border-black p-6 rounded-2xl cursor-pointer transition-all hover:shadow-float">
                <div className="text-4xl mb-3">{cat.icon}</div>
                <h3 className="font-black text-lg">{cat.name}</h3>
                <p className="text-sm font-bold text-gray-400 group-hover:text-primary transition-colors">{cat.count}</p>
              </div>
            ))}
          </div>
          <button className="md:hidden mt-8 w-full font-bold underline decoration-2 hover:text-primary">Ver todas as categorias →</button>
        </div>
      </section>

      {/* 4. How It Works */}
      <section className="py-20 px-6 bg-[#F4F4F0]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black uppercase mb-4">Como Funciona</h2>
            <p className="text-xl text-gray-600 font-medium">Simples, rápido e seguro. Conectamos empresas e trabalhadores em poucos passos.</p>

            <div className="flex justify-center gap-4 mt-8">
              <button className="bg-black text-white px-8 py-3 rounded-xl font-bold uppercase hover:-translate-y-1 transition-transform border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)]">
                Sou Trabalhador
              </button>
              <button className="bg-white text-black px-8 py-3 rounded-xl font-bold uppercase hover:-translate-y-1 transition-transform border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)]">
                Sou Empresa
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-4 gap-8">
            {[
              { step: '01', title: 'Crie seu perfil', desc: 'Cadastre-se gratuitamente e adicione suas habilidades, experiência e disponibilidade.' },
              { step: '02', title: 'Encontre vagas', desc: 'Explore oportunidades de trabalho presencial próximas a você que combinam com seu perfil.' },
              { step: '03', title: 'Candidate-se', desc: 'Aplique para as vagas com um clique. As empresas analisam e confirmam rapidamente.' },
              { step: '04', title: 'Trabalhe e receba', desc: 'Realize o trabalho e receba seu pagamento de forma rápida e segura.' },
            ].map((item, i) => (
              <div key={i} className="relative p-6 border-l-4 border-black md:border-l-0 md:border-t-4">
                <span className="text-7xl font-black text-primary/30 absolute -top-4 right-4 md:left-4 md:-top-14 z-0 pointer-events-none select-none">{item.step}</span>
                <div className="relative z-10">
                  <h3 className="text-xl font-black uppercase mb-2">{item.title}</h3>
                  <p className="text-gray-600 font-medium">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. Testimonials */}
      <section className="py-20 px-6 bg-accent text-white overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row gap-12 items-center">
            <div className="md:w-1/3">
              <div className="flex items-center gap-2 mb-4 text-primary">
                <Star fill="currentColor" size={24} />
                <Star fill="currentColor" size={24} />
                <Star fill="currentColor" size={24} />
                <Star fill="currentColor" size={24} />
                <Star fill="currentColor" size={24} />
              </div>
              <h2 className="text-4xl font-black uppercase leading-tight mb-4">O que dizem sobre nós</h2>
              <p className="text-gray-400 text-lg font-medium mb-8">Milhares de trabalhadores e empresas já transformaram sua forma de trabalhar com o Worki.</p>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/10 p-4 rounded-xl">
                  <span className="block text-3xl font-black text-primary">4.9/5</span>
                  <span className="text-sm font-bold text-gray-400">de avaliação</span>
                </div>
                <div className="bg-white/10 p-4 rounded-xl">
                  <span className="block text-3xl font-black text-primary">+98%</span>
                  <span className="text-sm font-bold text-gray-400">de satisfação</span>
                </div>
              </div>
            </div>

            <div className="md:w-2/3 flex gap-6 overflow-x-auto pb-8 snap-x">
              {[
                { quote: "Com o Worki consegui flexibilidade total. Trabalho quando quero e ainda complemento minha renda. Já fiz mais de 50 jobs pela plataforma!", name: "Carlos Silva", role: "Garçom • São Paulo, SP", initial: "CS" },
                { quote: "Antes era difícil encontrar trabalhos extras. Agora tenho várias oportunidades por semana. O pagamento é rápido e seguro.", name: "Maria Santos", role: "Atendente • Rio de Janeiro, RJ", initial: "MS" },
                { quote: "Encontramos trabalhadores qualificados em menos de 24h. Perfeito para eventos e dias de maior movimento. Recomendo demais!", name: "Restaurante Bella Vista", role: "Empresa • Belo Horizonte, MG", initial: "RB" },
              ].map((t, i) => (
                <div key={i} className="min-w-[300px] md:min-w-[350px] bg-white text-black p-8 rounded-2xl md:skew-x-[-3deg] snap-center">
                  <div className="md:skew-x-[3deg]">
                    <p className="text-lg font-medium italic mb-6">"{t.quote}"</p>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-black text-white rounded-full flex items-center justify-center font-bold">{t.initial}</div>
                      <div>
                        <p className="font-bold">{t.name}</p>
                        <p className="text-xs text-gray-500 font-bold uppercase">{t.role}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Objection Handling / Why Worki */}
          <div className="mt-20 pt-16 border-t border-white/10">
            <h3 className="text-3xl font-black uppercase text-center mb-12">Segurança em Primeiro Lugar</h3>

            <div className="grid md:grid-cols-2 gap-8">
              {/* For Workers */}
              <div className="bg-white/5 p-8 rounded-2xl border border-white/10">
                <h4 className="text-xl font-bold text-primary mb-6 flex items-center gap-2">
                  <Users size={24} /> Para Trabalhadores
                </h4>
                <ul className="space-y-4">
                  <li className="flex items-start gap-4">
                    <div className="bg-green-500/20 p-2 rounded-lg text-green-400 font-bold">01</div>
                    <div>
                      <p className="font-bold text-white">Garantia de Recebimento</p>
                      <p className="text-sm text-gray-400">O valor do job é reservado antes de você começar. Seu pagamento está protegido e garantido.</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="bg-green-500/20 p-2 rounded-lg text-green-400 font-bold">02</div>
                    <div>
                      <p className="font-bold text-white">Receba Sem Dor de Cabeça</p>
                      <p className="text-sm text-gray-400">Finalizou o trabalho? O dinheiro é liberado automaticamente para sua conta. Simples assim.</p>
                    </div>
                  </li>
                </ul>
              </div>

              {/* For Companies */}
              <div className="bg-white/5 p-8 rounded-2xl border border-white/10">
                <h4 className="text-xl font-bold text-blue-400 mb-6 flex items-center gap-2">
                  <Briefcase size={24} /> Para Empresas
                </h4>
                <ul className="space-y-4">
                  <li className="flex items-start gap-4">
                    <div className="bg-blue-500/20 p-2 rounded-lg text-blue-400 font-bold">01</div>
                    <div>
                      <p className="font-bold text-white">Satisfação Garantida</p>
                      <p className="text-sm text-gray-400">O pagamento só é liberado ao trabalhador após você aprovar o serviço realizado.</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="bg-blue-500/20 p-2 rounded-lg text-blue-400 font-bold">02</div>
                    <div>
                      <p className="font-bold text-white">Proteção Total</p>
                      <p className="text-sm text-gray-400">Mantemos o valor seguro até a conclusão do job. Se algo der errado, você é reembolsado.</p>
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Final CTA */}
      <section className="py-24 px-6 bg-primary text-white text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
        <div className="relative z-10 max-w-3xl mx-auto space-y-8">
          <h2 className="text-5xl md:text-7xl font-black uppercase tracking-tighter">Pronto para começar?</h2>
          <p className="text-2xl font-medium max-w-xl mx-auto">Junte-se a milhares de trabalhadores e empresas que já estão conectando através do Worki.</p>

          <div className="flex flex-col md:flex-row justify-center gap-4 mt-8">
            <button
              onClick={() => navigate('/login?type=work')}
              className="bg-black text-white px-8 py-4 rounded-xl font-black uppercase text-lg hover:scale-105 transition-transform shadow-[6px_6px_0px_0px_rgba(255,255,255,0.3)]"
            >
              Cadastrar como Trabalhador
            </button>
            <button
              onClick={() => navigate('/login?type=hire')}
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
