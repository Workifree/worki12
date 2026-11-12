import { useNavigate } from 'react-router-dom'
import { Shield, Zap, Users, UserPlus, CreditCard, Clock } from 'lucide-react'
import PageMeta from '../components/PageMeta'
import { Button, Card } from '../components/ui'

const FEATURES = [
  {
    icon: <Shield className="w-8 h-8 text-primary" aria-hidden="true" />,
    title: 'Sem calote, sem sumiço',
    description: 'Comprovante e histórico de cada turno registrado — você tem prova do pagamento e do trabalho feito, dos dois lados.',
  },
  {
    icon: <Zap className="w-8 h-8 text-blue-600" aria-hidden="true" />,
    title: 'Do seu jeito de pagar',
    description: 'Você paga o freela por fora (PIX ou dinheiro) e registra no Worki — recibo automático pros dois lados.',
  },
  {
    icon: <Users className="w-8 h-8 text-primary" aria-hidden="true" />,
    title: 'Seu elenco de confiança',
    description: 'Só quem você já conhece e testou — sem depender de estranho de plataforma.',
  },
  {
    icon: <UserPlus className="w-8 h-8 text-blue-600" aria-hidden="true" />,
    title: 'Convite em segundos',
    description: 'Chame o freela direto pro seu elenco — sem grupo de WhatsApp, sem renegociar tudo de novo.',
  },
  {
    icon: <CreditCard className="w-8 h-8 text-primary" aria-hidden="true" />,
    title: 'Sem mensalidade',
    description: 'Comece de graça — organizar sua operação de freelas não custa nada.',
  },
  {
    icon: <Clock className="w-8 h-8 text-blue-600" aria-hidden="true" />,
    title: 'Comprovante que é seu',
    description: 'Renda, avaliação e histórico portáteis — registrados a cada turno, que ninguém tira de você.',
  },
]

const STEPS_COMPANY = [
  { step: '1', title: 'Monte seu elenco', desc: 'Convide os freelas que você já confia por link ou telefone. Depois de aceitar, eles ficam na sua lista pra sempre.' },
  { step: '2', title: 'Convide pra um turno', desc: 'Defina data, horário e valor, e envie o convite direto pro freela do seu elenco — sem esperar candidatura de estranho.' },
  { step: '3', title: 'Pague e registre', desc: 'Confirme o turno, pague o freela direto (PIX ou dinheiro) e registre no Worki — recibo automático pra seu controle.' },
]

const STEPS_WORKER = [
  { step: '1', title: 'Aceite o convite', desc: 'Receba o convite de empresas que já confiam em você e aceite em um toque. Sem cadastro complicado.' },
  { step: '2', title: 'Trabalhe', desc: 'Faça check-in e check-out no turno combinado. Simples, sem burocracia extra.' },
  { step: '3', title: 'Construa sua reputação', desc: 'Cada turno vira histórico, avaliação e recibo — sua carteira de trabalho portátil, que ninguém tira.' },
]

interface StepsProps {
  steps: { step: string; title: string; desc: string }[]
  circleClass: string
}

function Steps({ steps, circleClass }: StepsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
      {steps.map((item) => (
        <div key={item.step} className="flex flex-col items-center text-center">
          <div
            className={`w-12 h-12 text-white rounded-full border-2 border-black flex items-center justify-center text-lg font-bold mb-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] ${circleClass}`}
          >
            {item.step}
          </div>
          <h4 className="text-lg font-bold tracking-tight mb-2">{item.title}</h4>
          <p className="text-sm sm:text-base text-gray-600">{item.desc}</p>
        </div>
      ))}
    </div>
  )
}

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
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center min-h-11 pr-3 text-2xl font-black tracking-tighter hover:text-primary transition-colors"
          >
            Worki
          </button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="md" className="px-3 sm:px-5" onClick={() => navigate('/login?type=work')}>
              <span className="hidden sm:inline">Quero </span>Trabalhar
            </Button>
            <Button variant="dark" size="md" className="px-3 sm:px-5" onClick={() => navigate('/login?type=hire')}>
              <span className="hidden sm:inline">Quero </span>Contratar
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden px-4 py-16 md:py-28">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-6">
            O trabalho freela, com a segurança que faltava
          </h1>
          <p className="text-lg md:text-xl text-gray-600 max-w-2xl mx-auto mb-10">
            A empresa organiza e registra sua equipe de freelas. O freela constrói uma carreira que é
            sua. Sem vínculo, sem calote, sem bagunça.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button variant="dark" size="lg" onClick={() => navigate('/login?type=hire&cadastro=1')}>
              Cadastrar como Empresa
            </Button>
            <Button variant="secondary" size="lg" onClick={() => navigate('/login?type=work&cadastro=1')}>
              Cadastrar como Profissional
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="px-4 py-16 md:py-24 bg-white">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-12">
            Por que escolher o Worki?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            {FEATURES.map((feature) => (
              <Card key={feature.title} interactive>
                <div className="mb-3">{feature.icon}</div>
                <h3 className="text-lg font-bold tracking-tight mb-1">{feature.title}</h3>
                <p className="text-sm sm:text-base text-gray-600">{feature.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Como Funciona Section */}
      <section className="px-4 py-16 md:py-24">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-12">
            Como funciona
          </h2>

          {/* Para Empresas */}
          <div className="mb-14">
            <h3 className="text-xl font-bold tracking-tight text-blue-600 mb-8 text-center">
              Para empresas
            </h3>
            <Steps steps={STEPS_COMPANY} circleClass="bg-blue-600" />
          </div>

          {/* Para Freelas */}
          <div>
            <h3 className="text-xl font-bold tracking-tight text-primary-dark mb-8 text-center">
              Para freelas
            </h3>
            <Steps steps={STEPS_WORKER} circleClass="bg-primary-dark" />
          </div>
        </div>
      </section>

      {/* CTA Final */}
      <section className="px-4 py-16 md:py-24 bg-black text-white">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            Comece agora — leva menos de 2 minutos
          </h2>
          <p className="text-lg text-gray-300 mb-10">
            A empresa organiza e registra sua equipe. O freela constrói uma carreira que é sua.
            Cadastro gratuito, sem compromisso.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button variant="secondary" size="lg" onClick={() => navigate('/login?type=hire')}>
              Quero Contratar
            </Button>
            <Button variant="primary" size="lg" onClick={() => navigate('/login?type=work')}>
              Quero Trabalhar
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-4 py-8 bg-gray-100 text-center text-sm text-gray-600">
        <p>&copy; {new Date().getFullYear()} Worki — Confiança e registro para o trabalho freela. Todos os direitos reservados.</p>
        <div className="flex flex-wrap gap-x-2 justify-center mt-3">
          <button onClick={() => navigate('/termos')} className="min-h-11 px-3 hover:text-black hover:underline transition-colors">Termos de Uso</button>
          <button onClick={() => navigate('/privacidade')} className="min-h-11 px-3 hover:text-black hover:underline transition-colors">Política de Privacidade</button>
          <button onClick={() => navigate('/ajuda')} className="min-h-11 px-3 hover:text-black hover:underline transition-colors">Ajuda</button>
        </div>
      </footer>
    </div>
  )
}
