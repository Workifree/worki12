import { ErrorState } from './ui/ErrorState';

/** Nome legado. Código novo usa `ErrorState` de `components/ui`. */
export default function ErroDeCarga({ onRetry, mensagem, title }: { onRetry: () => void; mensagem?: string; title?: string }) {
    return <ErrorState onRetry={onRetry} message={mensagem} title={title} />;
}
