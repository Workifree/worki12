/**
 * ErrorBanner — C-ANALYTICS-ERRO-VIRA-VAZIO. Quando alguma fonte falha (rede/RLS/coluna
 * inexistente) durante a coleta, o service devolve `hasError: true` em vez de mascarar a falha
 * como `sem-fonte` em todos os blocos. A UI é OBRIGADA a mostrar esta faixa — nunca deixar a tela
 * afirmar "nenhum turno criado" quando na verdade a leitura falhou. Falhar visível, nunca vazio.
 */
import { XCircle } from 'lucide-react';

export function ErrorBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="bg-red-50 border-2 border-black rounded-2xl p-4 flex items-start gap-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
    >
      <XCircle size={22} className="text-red-700 shrink-0 mt-0.5" strokeWidth={3} />
      <div className="flex flex-col gap-2">
        <div>
          <p className="font-black uppercase text-sm text-red-800">
            Não foi possível carregar os dados deste período
          </p>
          <p className="text-xs font-bold text-red-700">
            Houve uma falha ao buscar as métricas — os números abaixo podem estar incompletos ou
            ausentes. Isto NÃO significa que não houve operação neste período.
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="self-start px-4 py-2 rounded-xl border-2 border-black bg-black text-white font-black uppercase text-xs hover:bg-primary transition-all min-h-[36px]"
        >
          Tentar de novo
        </button>
      </div>
    </div>
  );
}
