import { useState } from 'react';
import { X, CreditCard, Lock, ShieldCheck, Loader2 } from 'lucide-react';
import { PaymentMethodService } from '../services/paymentMethodService';
import type { SaveCardInput } from '../services/paymentMethodService';
import { useToast } from '../contexts/ToastContext';
import { logError } from '../lib/logger';

interface AddCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormState {
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
  holderName: string;
  holderInfoName: string;
  holderInfoEmail: string;
  holderInfoCpfCnpj: string;
  holderInfoPostalCode: string;
  holderInfoAddressNumber: string;
  holderInfoPhone: string;
}

const EMPTY_FORM: FormState = {
  number: '',
  expiryMonth: '',
  expiryYear: '',
  ccv: '',
  holderName: '',
  holderInfoName: '',
  holderInfoEmail: '',
  holderInfoCpfCnpj: '',
  holderInfoPostalCode: '',
  holderInfoAddressNumber: '',
  holderInfoPhone: '',
};

function formatCardNumber(value: string): string {
  return value
    .replace(/\D/g, '')
    .slice(0, 16)
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

function formatCpfCnpj(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return digits
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3').trim();
  }
  return digits.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3').trim();
}

function formatCep(value: string): string {
  return value.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d{0,3})/, '$1-$2').trim();
}

export default function AddCardModal({ isOpen, onClose, onSuccess }: AddCardModalProps) {
  const { addToast } = useToast();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  if (!isOpen) return null;

  const handleChange = (field: keyof FormState, raw: string) => {
    let value = raw;
    if (field === 'number') value = formatCardNumber(raw);
    if (field === 'holderInfoCpfCnpj') value = formatCpfCnpj(raw);
    if (field === 'holderInfoPhone') value = formatPhone(raw);
    if (field === 'holderInfoPostalCode') value = formatCep(raw);
    if (field === 'expiryMonth') value = raw.replace(/\D/g, '').slice(0, 2);
    if (field === 'expiryYear') value = raw.replace(/\D/g, '').slice(0, 4);
    if (field === 'ccv') value = raw.replace(/\D/g, '').slice(0, 4);
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FormState, string>> = {};
    const digits = form.number.replace(/\s/g, '');
    if (digits.length < 13 || digits.length > 16) newErrors.number = 'Numero invalido (13-16 digitos)';
    const month = parseInt(form.expiryMonth, 10);
    if (!form.expiryMonth || month < 1 || month > 12) newErrors.expiryMonth = 'Mes invalido (01-12)';
    if (!form.expiryYear || form.expiryYear.length < 4) newErrors.expiryYear = 'Ano invalido (AAAA)';
    if (!form.ccv || form.ccv.length < 3) newErrors.ccv = 'CVV invalido';
    if (!form.holderName.trim()) newErrors.holderName = 'Nome do titular obrigatorio';
    if (!form.holderInfoName.trim()) newErrors.holderInfoName = 'Nome completo obrigatorio';
    if (!form.holderInfoEmail.trim() || !form.holderInfoEmail.includes('@')) newErrors.holderInfoEmail = 'E-mail invalido';
    const cpfCnpjDigits = form.holderInfoCpfCnpj.replace(/\D/g, '');
    if (cpfCnpjDigits.length !== 11 && cpfCnpjDigits.length !== 14) newErrors.holderInfoCpfCnpj = 'CPF (11 digitos) ou CNPJ (14 digitos)';
    const cepDigits = form.holderInfoPostalCode.replace(/\D/g, '');
    if (cepDigits.length !== 8) newErrors.holderInfoPostalCode = 'CEP invalido (8 digitos)';
    if (!form.holderInfoAddressNumber.trim()) newErrors.holderInfoAddressNumber = 'Numero do endereco obrigatorio';
    const phoneDigits = form.holderInfoPhone.replace(/\D/g, '');
    if (phoneDigits.length < 10) newErrors.holderInfoPhone = 'Telefone invalido';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);

    const input: SaveCardInput = {
      holderName: form.holderName.trim(),
      number: form.number.replace(/\s/g, ''),
      expiryMonth: form.expiryMonth,
      expiryYear: form.expiryYear,
      ccv: form.ccv,
      holderInfo: {
        name: form.holderInfoName.trim(),
        email: form.holderInfoEmail.trim(),
        cpfCnpj: form.holderInfoCpfCnpj.replace(/\D/g, ''),
        postalCode: form.holderInfoPostalCode.replace(/\D/g, ''),
        addressNumber: form.holderInfoAddressNumber.trim(),
        phone: form.holderInfoPhone.replace(/\D/g, ''),
      },
    };

    try {
      const result = await PaymentMethodService.savePaymentMethod(input);
      if (!result.success) {
        addToast(result.error || 'Erro ao salvar cartao. Verifique os dados.', 'error');
        return;
      }
      addToast('Cartao adicionado com sucesso!', 'success');
      setForm(EMPTY_FORM);
      setErrors({});
      onSuccess();
      onClose();
    } catch (err: unknown) {
      logError('AddCardModal.handleSubmit', err);
      addToast('Erro inesperado ao salvar cartao.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOverlayClick = () => {
    if (!loading) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={handleOverlayClick}
    >
      <div
        className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center">
              <CreditCard size={20} className="text-white" />
            </div>
            <h2 className="text-xl font-black uppercase tracking-tight">Adicionar Cartao</h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            aria-label="Fechar modal"
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Security notice */}
        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 mb-6 flex gap-3 items-start">
          <ShieldCheck size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-black uppercase text-blue-700 mb-0.5">Pagamento Postpago — Sem cobranca antecipada</p>
            <p className="text-xs text-blue-600 font-medium">
              Seu cartao sera cobrado <strong>apenas na conclusao do turno</strong>. Os dados do cartao sao enviados
              diretamente ao Asaas (certificacao PCI DSS) e <strong>nao ficam armazenados no Worki</strong>.
            </p>
          </div>
        </div>

        {/* Card details */}
        <section className="mb-6">
          <h3 className="text-sm font-black uppercase tracking-wide mb-4 flex items-center gap-2">
            <CreditCard size={16} /> Dados do Cartao
          </h3>

          <div className="space-y-4">
            {/* Card number */}
            <div>
              <label htmlFor="card-number" className="block text-xs font-black uppercase mb-1.5 text-gray-700">
                Numero do Cartao
              </label>
              <input
                id="card-number"
                type="text"
                inputMode="numeric"
                autoComplete="cc-number"
                placeholder="0000 0000 0000 0000"
                value={form.number}
                onChange={(e) => handleChange('number', e.target.value)}
                className={`w-full border-2 rounded-xl px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${errors.number ? 'border-red-500' : 'border-black'}`}
              />
              {errors.number && <p className="text-xs text-red-500 mt-1 font-medium">{errors.number}</p>}
            </div>

            {/* Expiry + CVV */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="expiry-month" className="block text-xs font-black uppercase mb-1.5 text-gray-700">
                  Mes
                </label>
                <input
                  id="expiry-month"
                  type="text"
                  inputMode="numeric"
                  autoComplete="cc-exp-month"
                  placeholder="MM"
                  value={form.expiryMonth}
                  onChange={(e) => handleChange('expiryMonth', e.target.value)}
                  className={`w-full border-2 rounded-xl px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${errors.expiryMonth ? 'border-red-500' : 'border-black'}`}
                />
                {errors.expiryMonth && <p className="text-xs text-red-500 mt-1 font-medium">{errors.expiryMonth}</p>}
              </div>
              <div>
                <label htmlFor="expiry-year" className="block text-xs font-black uppercase mb-1.5 text-gray-700">
                  Ano
                </label>
                <input
                  id="expiry-year"
                  type="text"
                  inputMode="numeric"
                  autoComplete="cc-exp-year"
                  placeholder="AAAA"
                  value={form.expiryYear}
                  onChange={(e) => handleChange('expiryYear', e.target.value)}
                  className={`w-full border-2 rounded-xl px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${errors.expiryYear ? 'border-red-500' : 'border-black'}`}
                />
                {errors.expiryYear && <p className="text-xs text-red-500 mt-1 font-medium">{errors.expiryYear}</p>}
              </div>
              <div>
                <label htmlFor="ccv" className="block text-xs font-black uppercase mb-1.5 text-gray-700">
                  CVV
                </label>
                <input
                  id="ccv"
                  type="password"
                  inputMode="numeric"
                  autoComplete="cc-csc"
                  placeholder="•••"
                  value={form.ccv}
                  onChange={(e) => handleChange('ccv', e.target.value)}
                  className={`w-full border-2 rounded-xl px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${errors.ccv ? 'border-red-500' : 'border-black'}`}
                />
                {errors.ccv && <p className="text-xs text-red-500 mt-1 font-medium">{errors.ccv}</p>}
              </div>
            </div>

            {/* Holder name on card */}
            <div>
              <label htmlFor="holder-name" className="block text-xs font-black uppercase mb-1.5 text-gray-700">
                Nome no Cartao
              </label>
              <input
                id="holder-name"
                type="text"
                autoComplete="cc-name"
                placeholder="Como impresso no cartao"
                value={form.holderName}
                onChange={(e) => handleChange('holderName', e.target.value)}
                className={`w-full border-2 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${errors.holderName ? 'border-red-500' : 'border-black'}`}
              />
              {errors.holderName && <p className="text-xs text-red-500 mt-1 font-medium">{errors.holderName}</p>}
            </div>
          </div>
        </section>

        {/* Divider */}
        <div className="border-t-2 border-gray-100 mb-6" />

        {/* Holder info */}
        <section className="mb-6">
          <h3 className="text-sm font-black uppercase tracking-wide mb-4 flex items-center gap-2">
            <Lock size={16} /> Dados do Titular (Antifraude)
          </h3>

          <div className="space-y-4">
            <div>
              <label htmlFor="holder-full-name" className="block text-xs font-black uppercase mb-1.5 text-gray-700">
                Nome Completo
              </label>
              <input
                id="holder-full-name"
                type="text"
                autoComplete="name"
                placeholder="Nome completo do titular"
                value={form.holderInfoName}
                onChange={(e) => handleChange('holderInfoName', e.target.value)}
                className={`w-full border-2 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${errors.holderInfoName ? 'border-red-500' : 'border-black'}`}
              />
              {errors.holderInfoName && <p className="text-xs text-red-500 mt-1 font-medium">{errors.holderInfoName}</p>}
            </div>

            <div>
              <label htmlFor="holder-email" className="block text-xs font-black uppercase mb-1.5 text-gray-700">
                E-mail
              </label>
              <input
                id="holder-email"
                type="email"
                autoComplete="email"
                placeholder="email@empresa.com"
                value={form.holderInfoEmail}
                onChange={(e) => handleChange('holderInfoEmail', e.target.value)}
                className={`w-full border-2 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${errors.holderInfoEmail ? 'border-red-500' : 'border-black'}`}
              />
              {errors.holderInfoEmail && <p className="text-xs text-red-500 mt-1 font-medium">{errors.holderInfoEmail}</p>}
            </div>

            <div>
              <label htmlFor="holder-cpf-cnpj" className="block text-xs font-black uppercase mb-1.5 text-gray-700">
                CPF / CNPJ
              </label>
              <input
                id="holder-cpf-cnpj"
                type="text"
                inputMode="numeric"
                placeholder="000.000.000-00 ou 00.000.000/0001-00"
                value={form.holderInfoCpfCnpj}
                onChange={(e) => handleChange('holderInfoCpfCnpj', e.target.value)}
                className={`w-full border-2 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${errors.holderInfoCpfCnpj ? 'border-red-500' : 'border-black'}`}
              />
              {errors.holderInfoCpfCnpj && <p className="text-xs text-red-500 mt-1 font-medium">{errors.holderInfoCpfCnpj}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="holder-cep" className="block text-xs font-black uppercase mb-1.5 text-gray-700">
                  CEP
                </label>
                <input
                  id="holder-cep"
                  type="text"
                  inputMode="numeric"
                  placeholder="00000-000"
                  value={form.holderInfoPostalCode}
                  onChange={(e) => handleChange('holderInfoPostalCode', e.target.value)}
                  className={`w-full border-2 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${errors.holderInfoPostalCode ? 'border-red-500' : 'border-black'}`}
                />
                {errors.holderInfoPostalCode && <p className="text-xs text-red-500 mt-1 font-medium">{errors.holderInfoPostalCode}</p>}
              </div>
              <div>
                <label htmlFor="holder-address-number" className="block text-xs font-black uppercase mb-1.5 text-gray-700">
                  Numero
                </label>
                <input
                  id="holder-address-number"
                  type="text"
                  placeholder="Ex: 123"
                  value={form.holderInfoAddressNumber}
                  onChange={(e) => handleChange('holderInfoAddressNumber', e.target.value)}
                  className={`w-full border-2 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${errors.holderInfoAddressNumber ? 'border-red-500' : 'border-black'}`}
                />
                {errors.holderInfoAddressNumber && <p className="text-xs text-red-500 mt-1 font-medium">{errors.holderInfoAddressNumber}</p>}
              </div>
            </div>

            <div>
              <label htmlFor="holder-phone" className="block text-xs font-black uppercase mb-1.5 text-gray-700">
                Telefone
              </label>
              <input
                id="holder-phone"
                type="text"
                inputMode="tel"
                autoComplete="tel"
                placeholder="(00) 00000-0000"
                value={form.holderInfoPhone}
                onChange={(e) => handleChange('holderInfoPhone', e.target.value)}
                className={`w-full border-2 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${errors.holderInfoPhone ? 'border-red-500' : 'border-black'}`}
              />
              {errors.holderInfoPhone && <p className="text-xs text-red-500 mt-1 font-medium">{errors.holderInfoPhone}</p>}
            </div>
          </div>
        </section>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-3 border-2 border-black rounded-xl font-black uppercase hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 py-3 bg-black text-white rounded-xl font-black uppercase shadow-[4px_4px_0px_0px_rgba(37,99,235,1)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Salvando...
              </>
            ) : (
              <>
                <Lock size={18} /> Salvar Cartao
              </>
            )}
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4 font-medium">
          Protegido por criptografia SSL. Processado pelo Asaas (PCI DSS Level 1).
        </p>
      </div>
    </div>
  );
}
