import { useLayoutEffect, type RefObject } from 'react';

/** 1 linha = 44px (alvo de toque); cresce até 5 linhas de 24px + respiro e borda. */
const MAX_HEIGHT = 140;

/** Teclado de toque não tem Shift+Enter: nele o Enter quebra linha e o envio é pelo botão. */
function isTouchKeyboard(): boolean {
    return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
}

interface ChatComposerFieldProps {
    value: string;
    onChange: (value: string) => void;
    inputRef: RefObject<HTMLTextAreaElement | null>;
}

/** Campo de mensagem dos dois chats. Precisa estar dentro do `<form>` de envio. */
export default function ChatComposerField({ value, onChange, inputRef }: ChatComposerFieldProps) {
    const touch = isTouchKeyboard();

    useLayoutEffect(() => {
        const field = inputRef.current;
        if (!field) return;
        field.style.height = 'auto';
        const wanted = field.scrollHeight + (field.offsetHeight - field.clientHeight);
        // scrollHeight 0 = sem layout (campo oculto): fica na altura mínima do CSS.
        field.style.height = field.scrollHeight ? `${Math.min(wanted, MAX_HEIGHT)}px` : '';
        field.style.overflowY = wanted > MAX_HEIGHT ? 'auto' : 'hidden';
    }, [value, inputRef]);

    return (
        <textarea
            ref={inputRef}
            rows={1}
            name="message"
            aria-label="Mensagem"
            autoComplete="off"
            enterKeyHint={touch ? 'enter' : 'send'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
                // Enter que confirma a composição (IME/teclado preditivo) não envia.
                if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || touch) return;
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
            }}
            placeholder="Digite sua mensagem..."
            className="flex-1 min-w-0 min-h-11 resize-none rounded-xl border-2 border-black bg-white px-3 py-2 text-base leading-6 focus:outline-none focus:ring-2 focus:ring-black"
        />
    );
}
