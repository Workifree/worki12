import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Card, PageHeader } from '../components/ui'
import {
  BONUS_RULES_FOOTER,
  BONUS_RULES_INTRO,
  BONUS_RULES_MILESTONE_GROUPS,
  BONUS_RULES_SECTIONS,
  BONUS_RULES_TITLE,
  BONUS_RULES_UPDATED_AT,
  BONUS_RULES_VERSION,
} from '../lib/bonusRules'

/** Regulamento público da Trilha (rota fora do ProtectedRoute: dá para ler antes de aceitar). */
export default function BonusRules() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 sm:py-10">
      <div className="max-w-3xl mx-auto">
        <Button variant="ghost" onClick={() => navigate(-1)} iconLeft={<ArrowLeft size={18} />} className="-ml-3 mb-2">
          Voltar
        </Button>
        <PageHeader
          title={BONUS_RULES_TITLE}
          subtitle={`Versão ${BONUS_RULES_VERSION} · atualizado em ${BONUS_RULES_UPDATED_AT}`}
        />
        <Card padding="lg" className="space-y-4 text-sm sm:text-base leading-relaxed text-gray-800">
          <p>{BONUS_RULES_INTRO}</p>

          {BONUS_RULES_SECTIONS.map((section) => (
            <section key={section.id} aria-labelledby={`regra-${section.id}`} className="space-y-2">
              <h2 id={`regra-${section.id}`} className="text-lg font-black mt-6">
                {section.title}
              </h2>
              {section.paragraphs.map((text) => (
                <p key={text}>{text}</p>
              ))}
            </section>
          ))}

          <section aria-labelledby="regra-marcos" className="space-y-3">
            <h2 id="regra-marcos" className="text-lg font-black mt-6">
              Os marcos e os valores
            </h2>
            {BONUS_RULES_MILESTONE_GROUPS.map((group) => (
              <div key={group.name}>
                <h3 className="text-sm font-black uppercase tracking-wide text-gray-600">{group.name}</h3>
                <ul className="mt-1 divide-y divide-gray-200 border-2 border-black rounded-xl">
                  {group.items.map((item) => (
                    <li key={item.title} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span>{item.title}</span>
                      <span className="font-bold tabular-nums whitespace-nowrap">{item.reais}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <p className="text-sm text-gray-600 pt-2">{BONUS_RULES_FOOTER}</p>
          <p className="text-sm">
            <Link to="/termos" className="underline font-semibold">
              Termos de Uso
            </Link>
          </p>
        </Card>
      </div>
    </div>
  )
}
