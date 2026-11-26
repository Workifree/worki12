interface WorkerSwitchProps {
    checked: boolean;
    /** Nome acessível do controle. */
    label: string;
    /** Texto visível ao lado: sempre positivo, descreve o que está ligado. */
    text: string;
    onToggle: () => void;
    disabled?: boolean;
    'data-copilot'?: string;
}

/** Único padrão de liga/desliga das telas do freela: linha inteira tocável (44px). */
export default function WorkerSwitch({ checked, label, text, onToggle, disabled = false, ...rest }: WorkerSwitchProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            data-copilot={rest['data-copilot']}
            data-copilot-risk="D"
            disabled={disabled}
            onClick={onToggle}
            className="flex min-h-14 w-full items-center justify-between gap-4 rounded-xl border-2 border-black bg-white px-4 py-3 text-left transition-colors duration-fast active:bg-gray-100 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
        >
            <span className="min-w-0 text-sm font-bold">{text}</span>
            <span
                aria-hidden="true"
                className={`relative h-7 w-12 shrink-0 rounded-pill border-2 border-black ${checked ? 'bg-primary-dark' : 'bg-gray-200'}`}
            >
                <span
                    className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full border-2 border-black bg-white transition-transform duration-fast motion-reduce:transition-none ${checked ? 'translate-x-5' : ''}`}
                />
            </span>
        </button>
    );
}
