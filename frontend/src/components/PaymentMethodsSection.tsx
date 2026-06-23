import { useState, useEffect, useCallback } from 'react';
import { CreditCard, Plus, Star, AlertCircle } from 'lucide-react';
import { PaymentMethodService } from '../services/paymentMethodService';
import type { PaymentMethod } from '../types';
import { logError } from '../lib/logger';
import AddCardModal from './AddCardModal';

const BRAND_LABELS: Record<string, string> = {
  VISA: 'Visa',
  MASTERCARD: 'Mastercard',
  AMEX: 'American Express',
  ELO: 'Elo',
  HIPERCARD: 'Hipercard',
  DINERS: 'Diners',
};

function getBrandLabel(brand?: string | null): string {
  if (!brand) return 'Cartao';
  return BRAND_LABELS[brand.toUpperCase()] ?? brand;
}

function getBrandColor(brand?: string | null): string {
  const b = brand?.toUpperCase();
  if (b === 'VISA') return 'bg-blue-600';
  if (b === 'MASTERCARD') return 'bg-orange-500';
  if (b === 'ELO') return 'bg-yellow-500';
  if (b === 'AMEX') return 'bg-blue-800';
  return 'bg-gray-700';
}

export default function PaymentMethodsSection() {
  const [cards, setCards] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      const data = await PaymentMethodService.listPaymentMethods();
      setCards(data);
    } catch (err: unknown) {
      logError('PaymentMethodsSection.fetchCards', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  const handleSaveSuccess = () => {
    fetchCards();
  };

  return (
    <section className="bg-white border-2 border-black rounded-2xl p-6">
      {/* Section header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-black rounded-xl flex items-center justify-center">
            <CreditCard size={18} className="text-white" />
          </div>
          <div>
            <h3 className="text-lg font-black uppercase tracking-tight">Cartoes de Credito</h3>
            <p className="text-xs text-gray-500 font-medium">Para pagamento postpago de turnos</p>
          </div>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 bg-black hover:bg-blue-600 text-white px-4 py-2 rounded-xl font-black uppercase text-xs transition-colors shadow-[3px_3px_0px_0px_rgba(37,99,235,1)] hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5"
        >
          <Plus size={16} />
          Adicionar
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-200 rounded-xl" />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
          <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center border-2 border-gray-200">
            <AlertCircle size={26} className="text-gray-400" />
          </div>
          <div>
            <p className="font-black uppercase text-sm text-gray-700">Nenhum cartao cadastrado</p>
            <p className="text-xs text-gray-400 font-medium mt-1 max-w-xs">
              Cadastre um cartao para pagar os turnos. A cobranca so ocorre apos a conclusao.
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-2 flex items-center gap-2 bg-black hover:bg-blue-600 text-white px-5 py-2.5 rounded-xl font-black uppercase text-xs transition-colors"
          >
            <Plus size={14} /> Adicionar cartao
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {cards.map((card) => (
            <CardRow key={card.id} card={card} />
          ))}
        </div>
      )}

      {/* Postpaid info */}
      {cards.length > 0 && (
        <div className="mt-5 bg-blue-50 border-2 border-blue-200 rounded-xl px-4 py-3 flex gap-2 items-start">
          <AlertCircle size={15} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 font-medium">
            O cartao padrao sera cobrado apenas quando voce confirmar a conclusao de um turno postpago.
            Dados do cartao nao ficam armazenados no Worki.
          </p>
        </div>
      )}

      <AddCardModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={handleSaveSuccess}
      />
    </section>
  );
}

interface CardRowProps {
  card: PaymentMethod;
}

function CardRow({ card }: CardRowProps) {
  return (
    <div className="flex items-center gap-4 bg-white border-2 border-black rounded-xl px-4 py-3 hover:shadow-[4px_4px_0px_0px_rgba(37,99,235,1)] hover:-translate-y-0.5 transition-all">
      {/* Brand badge */}
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${getBrandColor(card.brand)}`}>
        <CreditCard size={18} className="text-white" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-black text-sm uppercase tracking-tight">
            {getBrandLabel(card.brand)}
          </span>
          <span className="font-mono text-sm text-gray-600">
            •••• {card.last4 ?? '????'}
          </span>
          {card.is_default && (
            <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border-2 border-blue-200 text-[10px] font-black uppercase px-2 py-0.5 rounded-full">
              <Star size={10} className="fill-blue-600 text-blue-600" /> Padrao
            </span>
          )}
        </div>
        {card.holder_name && (
          <p className="text-xs text-gray-400 font-medium truncate mt-0.5">{card.holder_name}</p>
        )}
      </div>

      {/* Postpaid indicator */}
      <span className="text-[10px] font-black uppercase bg-gray-100 text-gray-600 px-2 py-1 rounded-xl flex-shrink-0">
        Postpago
      </span>
    </div>
  );
}

// Re-export for convenience if needed elsewhere
export { CardRow };
export type { CardRowProps };

// Loading spinner for inline use
export function CardsSectionSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-8 bg-gray-200 rounded-xl w-1/3" />
      {[...Array(2)].map((_, i) => (
        <div key={i} className="h-16 bg-gray-200 rounded-xl" />
      ))}
    </div>
  );
}
