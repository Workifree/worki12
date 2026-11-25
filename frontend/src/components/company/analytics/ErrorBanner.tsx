/**
 * ErrorBanner — falha em alguma fonte (`hasError`). A tela mostra SÓ isto: número parcial ou zerado
 * ao lado de um aviso de erro continua sendo lido como dado verdadeiro.
 */
import { ErrorState } from '../../ui';

export function ErrorBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <ErrorState
      onRetry={onRetry}
      title="Não foi possível carregar os dados deste período"
      message="Isto não significa que não houve operação. Verifique sua conexão e tente de novo."
    />
  );
}
