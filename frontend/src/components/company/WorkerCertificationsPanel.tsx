import { useEffect, useState, type FormEvent } from 'react';
import {
  Award,
  GraduationCap,
  ShieldCheck,
  ShieldOff,
  Plus,
  Loader2,
  Ban,
  X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { logError } from '../../lib/logger';
import { isCertificationExpired, formatDateOnly, todayLocalDate } from '../../lib/dateUtils';
import { CertificationService } from '../../services/certificationService';
import type { WorkerCertification, WorkerTraining } from '../../types';

// ---------------------------------------------------------------------------
// F8 (empresa) — o que a empresa vê no perfil de um freela do seu elenco: as certificações
// EXTERNAS que ele auto-declarou (CREF, manipulação de alimentos) e os treinamentos INTERNOS
// que a própria empresa já registrou. v1 SEM ARQUIVO (ADR-20260821, D1): não há documento pra
// abrir aqui — a "conferência" é a empresa confirmando que VIU o original fora do Worki.
//
// D3 é uma regra de produto, não de estilo: proibido "Verificado" isolado ou selo sem empresa
// nomeada. `verified_by_company_id` é sempre exibido nomeado; e só a MESMA empresa que conferiu
// pode desfazer (gate de UI — a policy do banco é mais permissiva, mas a UI não abre esse botão
// pra quem não foi quem conferiu).
// ---------------------------------------------------------------------------

interface Props {
  workerId: string;
}

/** Formata um timestamptz (`verified_at`) em `dd/MM/aaaa` — ver mesma nota em `MyCertificationsSection`. */
function formatTimestampBR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export default function WorkerCertificationsPanel({ workerId }: Props) {
  const { addToast } = useToast();
  const [companyId, setCompanyId] = useState<string | null>(null);

  const [certifications, setCertifications] = useState<WorkerCertification[]>([]);
  const [certLoading, setCertLoading] = useState(true);
  const [verifierNames, setVerifierNames] = useState<Record<string, string>>({});
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [unverifyingId, setUnverifyingId] = useState<string | null>(null);

  const [trainings, setTrainings] = useState<WorkerTraining[]>([]);
  const [trainingsLoading, setTrainingsLoading] = useState(true);
  const [trainingFormOpen, setTrainingFormOpen] = useState(false);
  const [trainingTitle, setTrainingTitle] = useState('');
  const [trainingCompletedAt, setTrainingCompletedAt] = useState(todayLocalDate());
  const [trainingNote, setTrainingNote] = useState('');
  const [trainingSaving, setTrainingSaving] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revoking, setRevoking] = useState(false);

  const loadCertifications = async () => {
    setCertLoading(true);
    const list = await CertificationService.listWorkerCertifications(workerId);
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
        logError('WorkerCertificationsPanel.loadCertifications.verifiers', error);
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
    setCertLoading(false);
  };

  const loadTrainings = async () => {
    setTrainingsLoading(true);
    const list = await CertificationService.listCompanyTrainings(workerId);
    setTrainings(list);
    setTrainingsLoading(false);
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (active) setCompanyId(user?.id ?? null);
    })();
    void loadCertifications();
    void loadTrainings();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só precisa re-rodar quando o worker muda
  }, [workerId]);

  const handleVerify = async (cert: WorkerCertification) => {
    setVerifyingId(cert.id);
    const result = await CertificationService.verifyCertification(cert.id);
    setVerifyingId(null);
    if (!result.success) {
      addToast(result.error ?? 'Não foi possível conferir a certificação.', 'error');
      return;
    }
    addToast('Certificação marcada como conferida.', 'success');
    void loadCertifications();
  };

  const handleUnverify = async (cert: WorkerCertification) => {
    setUnverifyingId(cert.id);
    const result = await CertificationService.unverifyCertification(cert.id);
    setUnverifyingId(null);
    if (!result.success) {
      addToast(result.error ?? 'Não foi possível desfazer a conferência.', 'error');
      return;
    }
    addToast('Conferência desfeita.', 'success');
    void loadCertifications();
  };

  const openTrainingForm = () => {
    setTrainingTitle('');
    setTrainingCompletedAt(todayLocalDate());
    setTrainingNote('');
    setTrainingFormOpen(true);
  };

  const handleRegisterTraining = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = trainingTitle.trim();
    if (!trimmed) {
      addToast('Informe um título para o treinamento.', 'error');
      return;
    }
    setTrainingSaving(true);
    const result = await CertificationService.registerTraining(
      workerId,
      trimmed,
      trainingCompletedAt,
      trainingNote,
    );
    setTrainingSaving(false);
    if (!result.training) {
      addToast(result.error ?? 'Não foi possível registrar o treinamento.', 'error');
      return;
    }
    addToast('Treinamento registrado.', 'success');
    setTrainingFormOpen(false);
    void loadTrainings();
  };

  const handleRevoke = async () => {
    if (!revokingId) return;
    const trimmedReason = revokeReason.trim();
    if (!trimmedReason) {
      addToast('Informe o motivo da revogação.', 'error');
      return;
    }
    setRevoking(true);
    const result = await CertificationService.revokeTraining(revokingId, trimmedReason);
    setRevoking(false);
    if (!result.success) {
      addToast(result.error ?? 'Não foi possível revogar o treinamento.', 'error');
      return;
    }
    addToast('Treinamento revogado.', 'success');
    setRevokingId(null);
    setRevokeReason('');
    void loadTrainings();
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
      {/* Certificações — auto-declaradas pelo freela, conferência atribuída (D3) */}
      <div>
        <h3 className="text-xl font-black uppercase mb-4 flex items-center gap-2">
          <Award size={20} /> Certificações
        </h3>

        {certLoading && (
          <div className="space-y-3 animate-pulse">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-20 bg-gray-200 rounded-xl" />
            ))}
          </div>
        )}

        {!certLoading && certifications.length === 0 && (
          <p className="text-gray-400 italic font-medium text-sm">
            Este freela ainda não cadastrou certificações.
          </p>
        )}

        {!certLoading && certifications.length > 0 && (
          <div className="space-y-3">
            {certifications.map((cert) => {
              const expired = isCertificationExpired(cert.expires_at);
              const verified = !!cert.verified_by_company_id && !!cert.verified_at;
              const verifiedByThisCompany = cert.verified_by_company_id === companyId;
              return (
                <div key={cert.id} className="bg-white p-4 rounded-xl border-2 border-gray-100">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-black text-sm">{cert.title}</h4>
                    {expired && (
                      <span className="bg-red-100 text-red-700 border border-red-300 rounded-pill px-2 py-0.5 text-[10px] font-black uppercase">
                        Vencida
                      </span>
                    )}
                  </div>
                  {cert.issuer && <p className="text-xs text-gray-500 font-bold mt-0.5">{cert.issuer}</p>}
                  {cert.registration_number && (
                    <p className="text-xs text-gray-500 font-medium">Nº {cert.registration_number}</p>
                  )}
                  <p className="text-xs text-gray-400 font-medium mt-1">
                    {cert.issued_at && <>Emitida em {formatDateOnly(cert.issued_at, 'dd/MM/yyyy')}</>}
                    {cert.issued_at && cert.expires_at && ' · '}
                    {cert.expires_at && <>Válida até {formatDateOnly(cert.expires_at, 'dd/MM/yyyy')}</>}
                  </p>

                  {/* D3 — nunca um selo genérico; sempre nomear quem conferiu. */}
                  {verified ? (
                    <p className="mt-2 flex items-start gap-1.5 text-xs font-bold text-green-700 bg-green-50 rounded-lg px-3 py-2">
                      <ShieldCheck size={14} className="flex-shrink-0 mt-0.5" />
                      Conferida por {verifierNames[cert.verified_by_company_id as string] ?? 'uma empresa'} em{' '}
                      {formatTimestampBR(cert.verified_at as string)} — confirma ter visto o documento
                      original. O Worki não verifica diplomas nem consulta conselhos profissionais.
                    </p>
                  ) : (
                    <p className="mt-2 text-xs font-bold text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      Cadastrado pelo próprio profissional — não conferido.
                    </p>
                  )}

                  <div className="mt-2">
                    {!verified && (
                      <button
                        type="button"
                        onClick={() => void handleVerify(cert)}
                        disabled={verifyingId === cert.id}
                        className="min-h-11 px-4 py-2 bg-black hover:bg-blue-600 text-white rounded-xl font-black uppercase text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        {verifyingId === cert.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <ShieldCheck size={14} />
                        )}
                        Marcar como conferida
                      </button>
                    )}
                    {verified && verifiedByThisCompany && (
                      <button
                        type="button"
                        onClick={() => void handleUnverify(cert)}
                        disabled={unverifyingId === cert.id}
                        className="min-h-11 px-4 py-2 border-2 border-black hover:bg-gray-50 rounded-xl font-black uppercase text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        {unverifyingId === cert.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <ShieldOff size={14} />
                        )}
                        Desfazer conferência
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Treinamentos — registro operacional da própria empresa sobre o freela (não é o freela quem escreve) */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-black uppercase flex items-center gap-2">
            <GraduationCap size={20} /> Treinamentos
          </h3>
          <button
            type="button"
            onClick={openTrainingForm}
            className="min-h-11 px-4 py-2 bg-black hover:bg-blue-600 text-white rounded-xl font-black uppercase text-xs flex items-center gap-1.5 transition-colors"
          >
            <Plus size={14} /> Registrar
          </button>
        </div>

        {trainingsLoading && (
          <div className="space-y-3 animate-pulse">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 rounded-xl" />
            ))}
          </div>
        )}

        {!trainingsLoading && trainings.length === 0 && (
          <p className="text-gray-400 italic font-medium text-sm">
            Sua empresa ainda não registrou nenhum treinamento para este freela.
          </p>
        )}

        {!trainingsLoading && trainings.length > 0 && (
          <div className="space-y-3">
            {trainings.map((training) => {
              const revoked = !!training.revoked_at;
              return (
                <div
                  key={training.id}
                  className={`bg-white p-4 rounded-xl border-2 ${revoked ? 'border-gray-100 opacity-60' : 'border-gray-100'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-black text-sm">{training.title}</h4>
                    {revoked && (
                      <span className="bg-gray-100 text-gray-500 border border-gray-300 rounded-pill px-2 py-0.5 text-[10px] font-black uppercase flex-shrink-0">
                        Revogado
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 font-medium mt-1">
                    Concluído em {formatDateOnly(training.completed_at, 'dd/MM/yyyy')}
                  </p>
                  {training.note && <p className="text-xs text-gray-500 font-medium mt-1">{training.note}</p>}
                  {revoked && training.revoked_reason && (
                    <p className="text-xs text-gray-400 font-medium mt-1 italic">
                      Motivo da revogação: {training.revoked_reason}
                    </p>
                  )}
                  {!revoked && (
                    <button
                      type="button"
                      onClick={() => {
                        setRevokingId(training.id);
                        setRevokeReason('');
                      }}
                      className="mt-2 min-h-11 px-4 py-2 border-2 border-black hover:bg-gray-50 rounded-xl font-black uppercase text-xs flex items-center gap-1.5 transition-colors"
                    >
                      <Ban size={14} /> Revogar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal — registrar treinamento */}
      {trainingFormOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget && !trainingSaving) setTrainingFormOpen(false);
          }}
        >
          <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-black uppercase">Registrar Treinamento</h3>
              <button
                type="button"
                onClick={() => setTrainingFormOpen(false)}
                disabled={trainingSaving}
                aria-label="Fechar"
                className="p-2 hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-50"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={(e) => void handleRegisterTraining(e)} className="space-y-3">
              <div>
                <label htmlFor="training-title" className="block text-xs font-bold uppercase mb-1">
                  Título *
                </label>
                <input
                  id="training-title"
                  type="text"
                  required
                  maxLength={120}
                  value={trainingTitle}
                  onChange={(e) => setTrainingTitle(e.target.value)}
                  placeholder="Ex: Boas práticas RDC 216"
                  className="w-full border-2 border-black rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-600 outline-none"
                />
              </div>
              <div>
                <label htmlFor="training-completed" className="block text-xs font-bold uppercase mb-1">
                  Concluído em *
                </label>
                <input
                  id="training-completed"
                  type="date"
                  required
                  max={todayLocalDate()}
                  value={trainingCompletedAt}
                  onChange={(e) => setTrainingCompletedAt(e.target.value)}
                  className="w-full border-2 border-black rounded-xl px-3 py-3 focus:ring-2 focus:ring-blue-600 outline-none"
                />
              </div>
              <div>
                <label htmlFor="training-note" className="block text-xs font-bold uppercase mb-1">
                  Observação
                </label>
                <textarea
                  id="training-note"
                  maxLength={500}
                  value={trainingNote}
                  onChange={(e) => setTrainingNote(e.target.value)}
                  className="w-full h-20 border-2 border-black rounded-xl p-3 focus:ring-2 focus:ring-blue-600 outline-none resize-none"
                  placeholder="Ex: treinamento presencial de 2h com o gerente da unidade"
                />
              </div>
              <button
                type="submit"
                disabled={trainingSaving}
                className="w-full min-h-11 bg-black hover:bg-blue-600 text-white px-6 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {trainingSaving ? <Loader2 className="animate-spin" size={18} /> : null}
                {trainingSaving ? 'Salvando...' : 'Registrar'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal — revogar treinamento */}
      {revokingId && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget && !revoking) setRevokingId(null);
          }}
        >
          <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-sm p-6">
            <h3 className="text-xl font-black uppercase mb-2">Revogar Treinamento?</h3>
            <p className="text-xs font-bold text-gray-400 mb-4">
              Esta ação é definitiva — o registro fica marcado como revogado, nunca é apagado.
            </p>
            <label htmlFor="revoke-reason" className="block text-xs font-bold uppercase mb-1">
              Motivo *
            </label>
            <textarea
              id="revoke-reason"
              maxLength={300}
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              className="w-full h-20 border-2 border-black rounded-xl p-3 focus:ring-2 focus:ring-blue-600 outline-none resize-none mb-4"
              placeholder="Ex: registrado por engano, treinamento duplicado"
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setRevokingId(null)}
                disabled={revoking}
                className="flex-1 min-h-11 bg-gray-100 hover:bg-gray-200 text-black py-3 rounded-xl font-black uppercase text-xs transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleRevoke()}
                disabled={revoking}
                className="flex-1 min-h-11 bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {revoking ? <Loader2 className="animate-spin" size={16} /> : <Ban size={14} />}
                Revogar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
