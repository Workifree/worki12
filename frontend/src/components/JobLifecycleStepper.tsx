import { Check } from 'lucide-react'

interface Step {
  label: string
  status: 'complete' | 'active' | 'pending'
}

const STEP_CLASS: Record<Step['status'], string> = {
  complete: 'bg-primary text-white border-black',
  active: 'bg-black text-white border-black animate-pulse motion-reduce:animate-none',
  pending: 'bg-white text-gray-400 border-gray-200',
}

interface JobLifecycleStepperProps {
  steps: Step[]
}

export default function JobLifecycleStepper({ steps }: JobLifecycleStepperProps) {
  if (steps.length === 0) return null

  // Sempre em linha (cerca de 56px): em coluna virava uma escada desalinhada no celular.
  return (
    <ol className="grid w-full grid-flow-col auto-cols-fr">
      {steps.map((step, index) => (
        <li key={index} aria-current={step.status === 'active' ? 'step' : undefined} className="relative flex min-w-0 flex-col items-center">
          {index > 0 && (
            <span
              aria-hidden="true"
              className={`absolute right-1/2 top-3 mr-3 w-[calc(100%-1.5rem)] border-t-2 ${steps[index - 1].status === 'complete' ? 'border-black' : 'border-gray-200'}`}
            />
          )}
          <span className={`flex h-6 w-6 items-center justify-center rounded-full border-ink ${STEP_CLASS[step.status]}`}>
            {step.status === 'complete' ? <Check size={14} strokeWidth={3} /> : <span className="h-2 w-2 rounded-full bg-current" />}
          </span>
          <span className={`mt-1 text-center text-xs ${step.status === 'pending' ? 'font-medium text-gray-600' : 'font-semibold text-black'}`}>
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  )
}
