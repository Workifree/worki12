import { Check } from 'lucide-react'

interface Step {
  label: string
  status: 'complete' | 'active' | 'pending'
}

interface JobLifecycleStepperProps {
  steps: Step[]
}

export default function JobLifecycleStepper({ steps }: JobLifecycleStepperProps) {
  if (steps.length === 0) return null

  const getStepClass = (status: Step['status']): string => {
    switch (status) {
      case 'complete':
        return 'bg-primary text-white border-black'
      case 'active':
        return 'bg-black text-white border-black animate-pulse'
      case 'pending':
        return 'bg-white text-gray-300 border-gray-200'
    }
  }

  return (
    <ol className="flex flex-col sm:flex-row items-center justify-between gap-3 w-full">
      {steps.map((step, index) => (
        <li
          key={index}
          aria-current={step.status === 'active' ? 'step' : undefined}
          className="flex items-center flex-1 w-full"
        >
          <div className="flex flex-col items-center flex-shrink-0">
            <div
              className={`w-8 h-8 rounded-full border-2 flex items-center justify-center ${getStepClass(step.status)}`}
            >
              {step.status === 'complete' ? (
                <Check size={16} strokeWidth={3} />
              ) : (
                <span className="w-2 h-2 rounded-full bg-current" />
              )}
            </div>
            <span
              className={`text-xs text-center mt-1.5 max-w-20 ${
                step.status === 'pending' ? 'font-medium text-gray-500' : 'font-semibold text-black'
              }`}
            >
              {step.label}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div
              className={`border-t-2 flex-1 hidden sm:block mx-2 ${
                step.status === 'complete' ? 'border-black' : 'border-gray-200'
              }`}
            />
          )}
        </li>
      ))}
    </ol>
  )
}
