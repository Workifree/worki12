/**
 * TruncatedBanner — A16 do PRD. Quando o service atinge `MAX_PAGES` numa coleta paginada, o
 * PostgREST já cortou a fonte em silêncio (limite de 1000 linhas por página) — a UI é OBRIGADA a
 * avisar que os números da tela podem ser parciais. Nunca omitir isto silenciosamente.
 */
import { AlertTriangle } from 'lucide-react';

export function TruncatedBanner() {
  return (
    <div
      role="alert"
      className="bg-yellow-50 border-2 border-black rounded-2xl p-4 flex items-start gap-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
    >
      <AlertTriangle size={22} className="text-yellow-700 shrink-0 mt-0.5" strokeWidth={3} />
      <div>
        <p className="font-black uppercase text-sm text-yellow-800">
          Período grande demais para calcular com precisão
        </p>
        <p className="text-xs font-bold text-yellow-700">
          Alguns números desta tela podem estar parciais — reduza o intervalo de datas para uma leitura exata.
        </p>
      </div>
    </div>
  );
}
