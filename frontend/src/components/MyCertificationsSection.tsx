import { useEffect, useState, type FormEvent } from 'react';
import ErroDeCarga from './ErroDeCarga';
import { Award, Plus, Pencil, Trash2, X, Loader2, ShieldCheck, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { logError } from '../lib/logger';
import { isCertificationExpired, formatDateOnly } from '../lib/dateUtils';
import { CertificationService } from '../services/certificationService';
import type { WorkerCertification } from '../types';

// ---------------------------------------------------------------------------
// "Minhas Certificações" (F8) — o freela CADASTRA/EDITA/REMOVE a própria certificação
// externa (CREF, manipulação de alimentos, curso técnico). v1 SEM ARQUIVO (ADR-20260821,
// D1 do gate): nenhum input de arquivo, nenhuma promessa de anexo — só metadado +
// `registration_number` (o dado público/conferível na fonte, no lugar do PDF).
//
// Três coisas que a UI é OBRIGADA a honrar (não são só estética — o evaluator rejeita se
// faltar qualquer uma):
//  1. Editar o CONTEÚDO de uma certificação já CONFERIDA derruba a conferência da empresa
//     (trigger `enforce_certification_update_scope`, DS2). O aviso tem que aparecer ANTES
//     de salvar — descobrir isso só ao recarregar a tela é a pior versão do problema.
//  2. Auto-declarado ≠ verificado: a linha "Cadastrado pelo próprio profissional — não
//     conferido." é sempre visível quando não há conferência; nunca um selo genérico.
//  3. Vencida NUNCA é ocultada (R8, D2) — o predicado é `isCertificationExpired` (derivado,
//     nunca persistido).
// ---------------------------------------------------------------------------

interface CertificationFormState {
  title: string;
  issuer: string;
  registration_number: string;
  issued_at: string;
  expires_at: string;
}

const EMPTY_FORM: CertificationFormState = {
  title: '',
  issuer: '',
  registration_number: '',
  issued_at: '',
  expires_at: '',
};

function toFormState(cert: WorkerCertification): CertificationFormState {
  return {
    title: cert.title,
    issuer: cert.issuer ?? '',
    registration_number: cert.registration_number ?? '',
    issued_at: cert.issued_at ? cert.issued_at.split('T')[0] : '',
    expires_at: cert.expires_at ? cert.expires_at.split('T')[0] : '',
  };
}

/** Formata um timestamptz (`verified_at`) em `dd/MM/aaaa`. NÃO usar `formatDateOnly` aqui:
 * aquela função é para colunas `date` puras (issued_at/expires_at); `verified_at` é
 * timestamptz — precisa do `Date` real, não do truque de data-local por componentes. */
function formatTimestampBR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export default function MyCertificationsSection() {
  const { addToast } = useToast();
  const [certifications, setCertifications] = useState<WorkerCertification[]>([]);
  const [loading, setLoading] = useState(true);
  const [erroCarga, setErroCarga] = useState(false);
  // Nome de quem conferiu — resolvido em lote (mesmo padrão de `WorkerPublicProfile`/`reviews`):
  // `verified_by_company_id` é um uuid, a UI precisa nomear a empresa (D3 — conferência atribuída,
  // proibido selo genérico).
  const [verifierNames, setVerifierNames] = useState<Record<string, string>>({});

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CertificationFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  // DS2/D3: ao editar conteúdo de uma certificação JÁ conferida, o primeiro submit só ARMA o
  // aviso — só o segundo submit (usuário já viu e confirmou) de fato chama o service.
  const [pendingLossConfirm, setPendingLossConfirm] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    const list = await CertificationService.listMyCertifications();
    // null = fetch falhou. Cair no "Você ainda não cadastrou nenhuma certificação" aqui
    // mentiria e induziria recadastro duplicado (Nielsen #1/#9).
    if (list === null) {
      setErroCarga(true);
      setLoading(false);
      return;
    }
    setErroCarga(false);
    setCertifications(list);

    const companyIds = [
      ...new Set(
        list
          .map((c) => c.verified_by_company_id)
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    ];
    if (companyIds.length > 0) {
      const { data, error } = await supabase.from('companies').select('id, name').in('id', companyIds);
      if (error) {
        logError('MyCertificationsSection.load.verifiers', error);
      } else {
        const map: Record<string, string> = {};
        (data ?? []).forEach((c) => {
          map[c.id as string] = c.name as string;
        });
        setVerifierNames(map);
      }
    } else {
      setVerifierNames({});
    }
    setLoading(false);
  };

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setPendingLossConfirm(false);
    setFormOpen(true);
  };

  const openEdit = (cert: WorkerCertification) => {
    setEditingId(cert.id);
    setForm(toFormState(cert));
    setPendingLossConfirm(false);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setPendingLossConfirm(false);
  };

  const editingCert = editingId ? (certifications.find((c) => c.id === editingId) ?? null) : null;
  const editingWouldDropVerification = !!editingCert?.verified_by_company_id;
  const editingVerifierName = editingCert?.verified_by_company_id
    ? (verifierNames[editingCert.verified_by_company_id] ?? 'esta empresa')
    : null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedTitle = form.title.trim();
    if (!trimmedTitle) {
      addToast('Informe um título para a certificação.', 'error');
      return;
    }

    // Regra 1: avisar ANTES de salvar, nunca depois. Primeiro submit sobre uma certificação
    // conferida só arma o aviso; o botão de confirmação chama handleSubmit de novo com
    // `pendingLossConfirm=true` já setado.
    if (editingId && editingWouldDropVerification && !pendingLossConfirm) {
      setPendingLossConfirm(true);
      return;
    }

    setSaving(true);
    const input = {
      title: trimmedTitle,
      issuer: form.issuer.trim() || null,
      registration_number: form.registration_number.trim() || null,
      issued_at: form.issued_at || null,
      expires_at: form.expires_at || null,
    };

    if (editingId) {
      const result = await CertificationService.updateCertificationContent(editingId, input);
      setSaving(false);
      if (!result.success) {
        addToast(result.error ?? 'Não foi possível editar a certificação.', 'error');
        return;
      }
      addToast('Certificação atualizada.', 'success');
    } else {
      const result = await CertificationService.createCertification(input);
      setSaving(false);
      if (!result.certification) {
        addToast(result.error ?? 'Não foi possível cadastrar a certificação.', 'error');
        return;
      }
      addToast('Certificação cadastrada.', 'success');
    }

    closeForm();
    void load();
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    setDeleting(true);
    const result = await CertificationService.deleteCertification(deletingId);
    setDeleting(false);
    if (!result.success) {
      addToast(result.error ?? 'Não foi possível excluir a certificação.', 'error');
      return;
    }
    addToast('Certificação excluída.', 'success');
    setDeletingId(null);
    void load();
  };

  return (
    <div className="bg-white p-8 rounded-2xl border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,0.1)]">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xl font-black uppercase flex items-center gap-2">
          <Award size={20} /> Minhas Certificações
        </h3>
        <button
          type="button"
          onClick={openCreate}
          className="min-h-11 px-4 py-2 bg-primary hover:bg-black text-white rounded-xl font-black uppercase text-xs flex items-center gap-1.5 transition-colors"
        >
          <Plus size={16} /> Adicionar
        </button>
      </div>
      <p className="text-sm text-gray-500 font-medium mb-4">
        CREF, manipulação de alimentos, curso técnico. Não há upload de documento — o número de
        registro é o que uma empresa pode conferir na fonte.
      </p>

      {loading && (
        <div className="space-y-3 animate-pulse">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-200 rounded-xl" />
          ))}
        </div>
      )}

      {!loading && erroCarga && (
        <ErroDeCarga onRetry={load} mensagem="Suas certificações não sumiram — a carga falhou. Tente de novo antes de recadastrar." />
      )}

      {!loading && !erroCarga && certifications.length === 0 && (
        <div className="flex flex-col items-start gap-3 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-4">
          <p className="text-sm font-bold text-gray-500">
            Você ainda não cadastrou nenhuma certificação.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="min-h-11 bg-primary hover:bg-black text-white px-6 py-3 rounded-xl font-black uppercase text-sm transition-colors"
          >
            Cadastrar certificação
          </button>
        </div>
      )}

      {!loading && certifications.length > 0 && (
        <div className="space-y-3">
          {certifications.map((cert) => {
            const expired = isCertificationExpired(cert.expires_at);
            const verified = !!cert.verified_by_company_id && !!cert.verified_at;
            return (
              <div key={cert.id} className="bg-gray-50 border-2 border-gray-100 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-black text-sm">{cert.title}</h4>
                      {expired && (
                        <span className="bg-red-100 text-red-700 border border-red-300 rounded-pill px-2 py-0.5 text-[10px] font-black uppercase">
                          Vencida
                        </span>
                      )}
                    </div>
                    {cert.issuer && (
                      <p className="text-xs text-gray-500 font-bold mt-0.5">{cert.issuer}</p>
                    )}
                    {cert.registration_number && (
                      <p className="text-xs text-gray-500 font-medium">Nº {cert.registration_number}</p>
                    )}
                    <p className="text-xs text-gray-400 font-medium mt-1">
                      {cert.issued_at && <>Emitida em {formatDateOnly(cert.issued_at, 'dd/MM/yyyy')}</>}
                      {cert.issued_at && cert.expires_at && ' · '}
                      {cert.expires_at && <>Válida até {formatDateOnly(cert.expires_at, 'dd/MM/yyyy')}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(cert)}
                      aria-label={`Editar certificação ${cert.title}`}
                      className="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-gray-400 hover:text-black hover:bg-gray-100 transition-colors"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingId(cert.id)}
                      aria-label={`Excluir certificação ${cert.title}`}
                      className="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* D3 — auto-declarado ≠ verificado. Distinção visual obrigatória, cópia travada. */}
                {verified ? (
                  <p className="mt-3 flex items-start gap-1.5 text-xs font-bold text-primary bg-primary-light rounded-lg px-3 py-2">
                    <ShieldCheck size={14} className="flex-shrink-0 mt-0.5" />
                    Conferida por {verifierNames[cert.verified_by_company_id as string] ?? 'uma empresa'} em{' '}
                    {formatTimestampBR(cert.verified_at as string)} — a empresa confirma ter visto o
                    documento original. O Worki não verifica diplomas nem consulta conselhos
                    profissionais.
                  </p>
                ) : (
                  <p className="mt-3 text-xs font-bold text-gray-500 bg-white border border-gray-200 rounded-lg px-3 py-2">
                    Cadastrado pelo próprio profissional — não conferido.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de cadastro/edição */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) closeForm();
          }}
        >
          <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-black uppercase">
                {editingId ? 'Editar Certificação' : 'Nova Certificação'}
              </h3>
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                aria-label="Fechar"
                className="p-2 hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-50"
              >
                <X size={20} />
              </button>
            </div>

            {!pendingLossConfirm ? (
              <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
                <div>
                  <label htmlFor="cert-title" className="block text-xs font-bold uppercase mb-1">
                    Título *
                  </label>
                  <input
                    id="cert-title"
                    type="text"
                    required
                    maxLength={120}
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Ex: CREF, Manipulação de Alimentos"
                    className="w-full border-2 border-black rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="cert-issuer" className="block text-xs font-bold uppercase mb-1">
                    Emissor
                  </label>
                  <input
                    id="cert-issuer"
                    type="text"
                    maxLength={120}
                    value={form.issuer}
                    onChange={(e) => setForm({ ...form, issuer: e.target.value })}
                    placeholder="Ex: CREF-SP, Vigilância Sanitária"
                    className="w-full border-2 border-black rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="cert-regnum" className="block text-xs font-bold uppercase mb-1">
                    Número de registro
                  </label>
                  <input
                    id="cert-regnum"
                    type="text"
                    maxLength={60}
                    value={form.registration_number}
                    onChange={(e) => setForm({ ...form, registration_number: e.target.value })}
                    placeholder="Ex: 012345-G/SP"
                    className="w-full border-2 border-black rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary outline-none"
                  />
                  <p className="text-xs text-gray-400 font-medium mt-1">
                    Não guardamos o documento — este número é o que uma empresa pode conferir na
                    fonte (site do conselho).
                  </p>
                  {/* Defesa 4 de 5 do D5 (LGPD art. 5o, II): a unica que fala com a pessoa no
                      momento em que ela digita. As outras quatro (sem upload, tetos de char,
                      COMMENT ON TABLE, item em debitos-pre-piloto.md) protegem o banco; esta
                      protege contra a pessoa colar um ASO num campo de texto livre por nao saber
                      que nao deve. Nao remover sem reler o D5 do ddl-aprovado.md. */}
                  <p className="text-xs text-red-600 font-bold mt-2">
                    Não cadastre atestados, exames ou qualquer documento de saúde.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="cert-issued" className="block text-xs font-bold uppercase mb-1">
                      Emitida em
                    </label>
                    <input
                      id="cert-issued"
                      type="date"
                      value={form.issued_at}
                      onChange={(e) => setForm({ ...form, issued_at: e.target.value })}
                      className="w-full border-2 border-black rounded-xl px-3 py-3 focus:ring-2 focus:ring-primary outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="cert-expires" className="block text-xs font-bold uppercase mb-1">
                      Válida até
                    </label>
                    <input
                      id="cert-expires"
                      type="date"
                      value={form.expires_at}
                      onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
                      className="w-full border-2 border-black rounded-xl px-3 py-3 focus:ring-2 focus:ring-primary outline-none"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full min-h-11 bg-primary hover:bg-black text-white px-6 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 className="animate-spin" size={18} /> : null}
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </form>
            ) : (
              // Regra 1: aviso ANTES de salvar — editar conteúdo derruba a conferência (DS2).
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-3 rounded-xl border-2 border-yellow-300 bg-yellow-50">
                  <AlertTriangle size={20} className="text-yellow-700 flex-shrink-0 mt-0.5" />
                  <p className="text-sm font-bold text-yellow-800">
                    Editar esta certificação vai remover a conferência de {editingVerifierName}.
                    Você poderá pedir uma nova conferência depois. Deseja continuar?
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setPendingLossConfirm(false)}
                    disabled={saving}
                    className="flex-1 min-h-11 bg-gray-100 hover:bg-gray-200 text-black py-3 rounded-xl font-black uppercase text-xs transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={(e) => void handleSubmit(e as unknown as FormEvent)}
                    disabled={saving}
                    className="flex-1 min-h-11 bg-primary hover:bg-black text-white py-3 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="animate-spin" size={16} /> : null}
                    Continuar e salvar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de confirmação de exclusão */}
      {deletingId && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deleting) setDeletingId(null);
          }}
        >
          <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 border-2 border-red-300 text-red-600 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={24} />
            </div>
            <h3 className="text-xl font-black uppercase mb-2">Excluir Certificação?</h3>
            <p className="text-xs font-bold text-gray-400 mb-6">
              Esta ação não pode ser desfeita. Empresas com vínculo deixarão de ver este registro.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeletingId(null)}
                disabled={deleting}
                className="flex-1 min-h-11 bg-gray-100 hover:bg-gray-200 text-black py-3 rounded-xl font-black uppercase text-xs transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="flex-1 min-h-11 bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={14} />}
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
