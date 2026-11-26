import { useState } from 'react';
import type { InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
    /** 0 = vazio. */
    value: number;
    onValue: (value: number) => void;
};

/** Número com o texto digitado preservado ("0,5" não some no meio da digitação). */
export function NumberInput({ value, onValue, ...rest }: Props) {
    const [typed, setTyped] = useState({ text: value ? String(value) : '', value });
    // Mudou por fora ("aplicar a todas"): o texto acompanha o valor.
    const text = Object.is(typed.value, value) ? typed.text : value ? String(value) : '';
    return (
        <input
            {...rest}
            type="number"
            min={0}
            value={text}
            onChange={(e) => {
                const next = e.target.value === '' ? 0 : Number(e.target.value);
                setTyped({ text: e.target.value, value: next });
                onValue(next);
            }}
        />
    );
}
