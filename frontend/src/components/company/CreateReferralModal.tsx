import { useState, useEffect, type FormEvent } from 'react';
import { useModalDismiss } from '../../hooks/useModalDismiss';
import { X, Search, Building2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/logger';
import { useToast } from '../../contexts/ToastContext';
import { ReferralService } from '../../services/referralService';
import type { TeamMember } from '../../types';
import { Button, Field, FIELD_CONTROL_CLASS } from '../ui';

// ---------------------------------------------------------------------------
// "Indicar freela para outra empresa" (F10) — empresa indicadora (B).
//
// Vocabulário é requisito: chamamos isto de "indicar"/"indicação" na UI inteira. NUNCA
// "trocar", "emprestar", "ceder", "transferir" (ADR-20260821 D1) — a tela precisa deixar
// claro que B está APRESENTANDO o freela, não entregando-o: quem decide é o freela.
//
// `create_worker_referral` colapsa TODO motivo privado do freela (veto contra a empresa
// destino, opt-out, já conectado, teto de indicações abertas) em `not_available` com
// UMA mensagem genérica (LM-3 do ddl-aprovado.md) — nunca tentamos adivinhar o motivo aqui.
//
// Busca de empresa destino (DS-BUSCA — `.harness/spec/troca-freelas/ddl-aprovado.md` §6,
// `ADR-20260821-busca-de-empresas-acoplada-ao-debito-10.md`): esta tela é a PRIMEIRA e
// ÚNICA do frontend que depende de `companies` ser `SELECT USING (true)` (débito #10) —
// todo outro `from('companies')` (Sidebar, CompanyMessages, etc.) lê a PRÓPRIA linha via
// `.eq('id', user.id)`, o que não é o mesmo padrão. A leitura direta aqui é aprovada
// **acoplada** ao débito #10: no dia em que `companies` deixar de ser `USING (true)`, esta
// busca precisa virar RPC (`search_companies_for_referral`, contrato já escrito no ADR §D2)
// NA MESMA migration — senão o campo "Empresa destino" passa a devolver 0 linhas em
// silêncio (RLS que não casa não dá erro) e a F10 fica inoperante sem aviso nenhum.
// Endurecimentos obrigatórios já aplicados (DS-BUSCA-1/2/3): termo sanitizado (remove
// `% _ * \`, nunca escapa — remoção não depende da semântica de ESCAPE nem da tradução
// `*`→`%` do PostgREST), mínimo de 3 caracteres, debounce de ~300ms. Projeção
// `id, name, logo_url` + `limit(8)` + `neq(referringCompanyId)` são normativos
// (DS-BUSCA-4): proibido `select('*')`, proibido acrescentar `cnpj`/`email`/`address`.
// ---------------------------------------------------------------------------

const COMPANY_SEARCH_MIN_LENGTH = 3;
const COMPANY_SEARCH_DEBOUNCE_MS = 300;

// DS-BUSCA-1: remoção, não escape. `%`/`_` são metacaracteres de LIKE; `*` é traduzido
// para `%` pelo PostgREST; `\` é o caractere de escape do LIKE. Nenhum é significativo
// num nome de empresa — removê-los evita que `%%` (ou `**`) vire um padrão que casa tudo.
function sanitizeCompanySearchTerm(raw: string): string {
  return raw.trim().replace(/[%_*\\]/g, '');
}

interface CompanySearchResult {
  id: string;
  name: string;
  logo_url?: string | null;
}

interface CreateReferralModalProps {
  open: boolean;
  onClose: () => void;
  referringCompanyId: string;
  teamMembers: TeamMember[];
  onCreated: () => void;
}

export default function CreateReferralModal({
  open,
  onClose,
  referringCompanyId,
  teamMembers,
  onCreated,
}: CreateReferralModalProps) {
    // Hooks primeiro, SEMPRE — ha early-returns abaixo (rules-of-hooks).
    const fecharPeloFundo = useModalDismiss(onClose);
  const { addToast } = useToast();
  const [workerId, setWorkerId] = useState('');
  const [message, setMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<CompanySearchResult[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<CompanySearchResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // DS-BUSCA-3: debounce ~300ms. `onChange` cru dispararia uma query por tecla, e `ilike`
  // com curinga à esquerda sobre coluna sem índice é seq scan em `companies` a cada
  // digitação. O guard `selectedCompany?.name === searchTerm` evita reabrir a busca quando
  // é o próprio clique de seleção que reescreve `searchTerm` para o nome escolhido.
  useEffect(() => {
    if (selectedCompany && selectedCompany.name === searchTerm) {
      return;
    }

    // DS-BUSCA-1 + DS-BUSCA-2: sanitiza ANTES de medir o comprimento. `%%` (ou `**`) vira
    // string vazia após a remoção — cai no ramo "abaixo do mínimo", sem query nenhuma.
    const term = sanitizeCompanySearchTerm(searchTerm);
    if (term.length < COMPANY_SEARCH_MIN_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    let active = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { data, error } = await supabase
            .from('companies')
            .select('id, name, logo_url')
            .ilike('name', `%${term}%`)
            .neq('id', referringCompanyId)
            .limit(8);

          if (!active) return;

          if (error) {
            logError('CreateReferralModal.handleSearch', error);
            setResults([]);
            return;
          }
          setResults((data ?? []) as CompanySearchResult[]);
        } catch (err) {
          if (!active) return;
          logError('CreateReferralModal.handleSearch', err);
          setResults([]);
        } finally {
          if (active) setSearching(false);
        }
      })();
    }, COMPANY_SEARCH_DEBOUNCE_MS);


    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchTerm, selectedCompany, referringCompanyId]);

  if (!open) return null;

  const handleClose = () => {
    if (submitting) return;
    setWorkerId('');
    setMessage('');
    setSearchTerm('');
    setResults([]);
    setSelectedCompany(null);
    onClose();
  };

  const handleSearchTermChange = (term: string) => {
    setSearchTerm(term);
    setSelectedCompany(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!workerId || !selectedCompany || submitting) return;

    setSubmitting(true);
    const result = await ReferralService.createReferral(
      workerId,
      referringCompanyId,
      selectedCompany.id,
      message.trim() || undefined,
    );
    setSubmitting(false);

    if (result.outcome === 'created') {
      addToast('Indicação enviada. O freela vai decidir se aceita.', 'success');
      onCreated();
      handleClose();
      return;
    }

    // NUNCA distinguir o motivo aqui: `not_available` cobre veto/opt-out/já-conectado/teto
    // do freela — a mensagem genérica que o service já traduziu é a única correta.
    addToast(result.error ?? 'Não foi possível concluir a indicação.', 'error');
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={fecharPeloFundo}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-referral-title"
        className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-md p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="create-referral-title" className="text-lg font-bold tracking-tight">Indicar Freela</h2>
          <button
            type="button"
            aria-label="Fechar"
            onClick={handleClose}
            className="h-11 w-11 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
          >
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Apresente um freela do seu elenco a outra empresa. Quem decide se a conexão acontece é
          sempre o freela.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Freela do seu elenco">
            <select
              id="referral-worker"
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
              required
            >
              <option value="">Selecione um freela</option>
              {teamMembers.map((m) => (
                <option key={m.worker.id} value={m.worker.id}>
                  {m.worker.full_name}
                </option>
              ))}
            </select>
          </Field>

          <div>
            <label htmlFor="referral-company-search" className="block text-sm font-bold text-black mb-1.5">
              Empresa destino
            </label>
            <div className="relative">
              <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="referral-company-search"
                type="text"
                value={searchTerm}
                onChange={(e) => handleSearchTermChange(e.target.value)}
                placeholder="Buscar empresa pelo nome"
                className={`${FIELD_CONTROL_CLASS} pl-9`}
              />
            </div>

            {searching && <p className="text-xs text-gray-600 mt-2">Buscando...</p>}

            {!selectedCompany && results.length > 0 && (
              <ul className="mt-2 border-2 border-black rounded-xl divide-y divide-gray-200 max-h-40 overflow-y-auto">
                {results.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCompany(c);
                        setSearchTerm(c.name);
                        setResults([]);
                      }}
                      className="w-full text-left px-4 py-3 min-h-11 flex items-center gap-2 hover:bg-gray-50 text-sm font-bold focus-visible:outline-none focus-visible:bg-gray-100"
                    >
                      <Building2 size={16} /> {c.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selectedCompany && (
              <p className="text-xs text-primary-dark font-bold mt-2 flex items-center gap-1">
                <Building2 size={14} /> {selectedCompany.name} selecionada
              </p>
            )}
          </div>

          <Field label="Recado (opcional)">
            <textarea
              id="referral-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Ex.: A Ana é ótima no salão, trabalhou aqui várias vezes."
              className="!h-auto resize-none py-3"
            />
          </Field>

          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={handleClose} disabled={submitting} className="flex-1">
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="dark"
              disabled={!workerId || !selectedCompany}
              loading={submitting}
              className="flex-1"
            >
              Indicar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
