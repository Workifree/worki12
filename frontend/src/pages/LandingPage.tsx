import { useNavigate } from 'react-router-dom'
import { Shield, Zap, Users, UserPlus, CreditCard, Clock } from 'lucide-react'
import PageMeta from '../components/PageMeta'

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-[#F4F4F0]">
      <PageMeta
        title="Confiança e registro para o trabalho freela"
        description="Empresa organiza e registra sua equipe de freelas de confiança. Freela constrói uma carreira que é sua — histórico, avaliação e comprovante de renda. Sem vínculo, sem bagunça."
      />

      {/* Navigation Bar */}
      <nav className="sticky top-0 z-50 bg-[#F4F4F0]/95 backdrop-blur-sm border-b-2 border-black/10 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <button onClick={() => navigate('/')} className="text-2xl font-black uppercase tracking-tighter hover:text-primary transition-colors">
            Worki
          </button>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/login?type=work')} className="px-4 py-2 font-bold text-sm uppercase hover:text-primary transition-colors">
              Quero Trabalhar
            </button>
            <button onClick={() => navigate('/login?type=hire')} className="px-4 py-2 bg-blue-600 text-white font-bold text-sm uppercase rounded-lg border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 transition-all">
              Quero Contratar
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden px-4 py-20 md:py-32">
        <div className="max-w-6xl mx-auto text-center">
          <h1 className="text-5xl md:text-7xl font-black uppercase tracking-tighter mb-6">
            O trabalho freela, com a segurança que faltava
          </h1>
          <p className="text-xl md:text-2xl text-gray-600 max-w-3xl mx-auto mb-12 font-medium">
            A empresa organiza e registra sua equipe de freelas. O freela constrói uma carreira que é
            sua. Sem vínculo, sem calote, sem bagunça.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => navigate('/login?type=work&cadastro=1')}
              className="px-8 py-4 bg-primary text-white font-black uppercase text-lg rounded-xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all"
            >
              Cadastrar como Profissional
            </button>
            <button
              onClick={() => navigate('/login?type=hire&cadastro=1')}
              className="px-8 py-4 bg-blue-600 text-white font-black uppercase text-lg rounded-xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all"
            >
              Cadastrar como Empresa
            </button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="px-4 py-16 md:py-24 bg-white">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tight text-center mb-16">
            Por que escolher o Worki?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: <Shield className="w-10 h-10 text-primary" />,
                title: 'Sem Calote, Sem Sumiço',
                description: 'Comprovante e histórico de cada turno registrado — você tem prova do pagamento e do trabalho feito, dos dois lados.'
              },
              {
                icon: <Zap className="w-10 h-10 text-blue-600" />,
                title: 'Do Seu Jeito de Pagar',
                description: 'Você paga o freela por fora (PIX ou dinheiro) e registra no Worki — recibo automático pros dois lados.'
              },
              {
                icon: <Users className="w-10 h-10 text-primary" />,
                title: 'Seu Elenco de Confiança',
                description: 'Só quem você já conhece e testou — sem depender de estranho de plataforma.'
              },
              {
                icon: <UserPlus className="w-10 h-10 text-blue-600" />,
                title: 'Convite em Segundos',
                description: 'Chame o freela direto pro seu elenco — sem grupo de WhatsApp, sem renegociar tudo de novo.'
              },
              {
                icon: <CreditCard className="w-10 h-10 text-primary" />,
                title: 'Sem Mensalidade',
                description: 'Comece de graça — organizar sua operação de freelas não custa nada.'
              },
              {
                icon: <Clock className="w-10 h-10 text-blue-600" />,
                title: 'Comprovante Que É Seu',
                description: 'Renda, avaliação e histórico portáteis — registrados a cada turno, que ninguém tira de você.'
              },
            ].map((feature, i) => (
              <div
                key={i}
                className="p-6 bg-white border-2 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all"
              >
                <div className="mb-4">{feature.icon}</div>
                <h3 className="text-xl font-black uppercase tracking-tight mb-2">{feature.title}</h3>
                <p className="text-gray-600 font-medium">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Como Funciona Section */}
      <section className="px-4 py-16 md:py-24">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tight text-center mb-16">
            Como funciona
          </h2>

          {/* Para Empresas */}
          <div className="mb-16">
            <h3 className="text-2xl font-black uppercase tracking-tight text-blue-600 mb-8 text-center">
              Para Empresas
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                { step: '1', title: 'Monte seu Elenco', desc: 'Convide os freelas que você já confia por link ou telefone. Depois de aceitar, eles ficam na sua lista pra sempre.' },
                { step: '2', title: 'Convide pra um Turno', desc: 'Defina data, horário e valor, e envie o convite direto pro freela do seu elenco — sem esperar candidatura de estranho.' },
                { step: '3', title: 'Pague e Registre', desc: 'Confirme o turno, pague o freela direto (PIX ou dinheiro) e registre no Worki — recibo automático pra seu controle.' },
              ].map((item) => (
                <div key={item.step} className="flex flex-col items-center text-center">
                  <div className="w-16 h-16 bg-blue-600 text-white rounded-full border-2 border-black flex items-center justify-center text-2xl font-black mb-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    {item.step}
                  </div>
                  <h4 className="text-lg font-black uppercase tracking-tight mb-2">{item.title}</h4>
                  <p className="text-gray-600 font-medium">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Para Freelas */}
          <div>
            <h3 className="text-2xl font-black uppercase tracking-tight text-primary mb-8 text-center">
              Para Freelas
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                { step: '1', title: 'Aceite o Convite', desc: 'Receba o convite de empresas que já confiam em você e aceite em um toque. Sem cadastro complicado.' },
                { step: '2', title: 'Trabalhe', desc: 'Faça check-in e check-out no turno combinado. Simples, sem burocracia extra.' },
                { step: '3', title: 'Construa sua Reputação', desc: 'Cada turno vira histórico, avaliação e recibo — sua carteira de trabalho portátil, que ninguém tira.' },
              ].map((item) => (
                <div key={item.step} className="flex flex-col items-center text-center">
                  <div className="w-16 h-16 bg-primary text-white rounded-full border-2 border-black flex items-center justify-center text-2xl font-black mb-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    {item.step}
                  </div>
                  <h4 className="text-lg font-black uppercase tracking-tight mb-2">{item.title}</h4>
                  <p className="text-gray-600 font-medium">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Final */}
      <section className="px-4 py-16 md:py-24 bg-black text-white">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter mb-6">
            Comece agora — leva menos de 2 minutos
          </h2>
          <p className="text-xl text-gray-300 mb-12 font-medium">
            A empresa organiza e registra sua equipe. O freela constrói uma carreira que é sua.
            Cadastro gratuito, sem compromisso.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => navigate('/login?type=work')}
              className="px-8 py-4 bg-primary text-white font-black uppercase text-lg rounded-xl border-2 border-primary shadow-[8px_8px_0px_0px_rgba(0,166,81,0.3)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all"
            >
              Quero Trabalhar
            </button>
            <button
              onClick={() => navigate('/login?type=hire')}
              className="px-8 py-4 bg-blue-600 text-white font-black uppercase text-lg rounded-xl border-2 border-blue-600 shadow-[8px_8px_0px_0px_rgba(37,99,235,0.3)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all"
            >
              Quero Contratar
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-4 py-8 bg-gray-100 text-center text-sm text-gray-500 font-medium">
        <p>&copy; {new Date().getFullYear()} Worki — Confiança e registro para o trabalho freela. Todos os direitos reservados.</p>
        <div className="flex gap-4 justify-center mt-4">
          <button onClick={() => navigate('/termos')} className="hover:text-black transition-colors">Termos de Uso</button>
          <button onClick={() => navigate('/privacidade')} className="hover:text-black transition-colors">Política de Privacidade</button>
          <button onClick={() => navigate('/ajuda')} className="hover:text-black transition-colors">Ajuda</button>
        </div>
      </footer>
    </div>
  )
}
