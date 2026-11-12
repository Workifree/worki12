import { useEffect, useState, type FormEvent } from 'react';
import {
  Award,
  GraduationCap,
  ShieldCheck,
  ShieldOff,
  Plus,
  Ban,
  X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { logError } from '../../lib/logger';
import { isCertificationExpired, formatDateOnly, todayLocalDate } from '../../lib/dateUtils';
import { CertificationService } from '../../services/certificationService';
import type { WorkerCertification, WorkerTraining } from '../../types';
import { Button, Card, Field } from '../ui';

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
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
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
          <p className="text-gray-600 text-sm">
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
                <Card key={cert.id} padding="sm" className="border-gray-200">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold text-sm">{cert.title}</h4>
                    {expired && (
                      <span className="bg-red-100 text-red-700 border border-red-300 rounded-pill px-2 py-0.5 text-[11px] font-bold">
                        Vencida
                      </span>
                    )}
                  </div>
                  {cert.issuer && <p className="text-xs text-gray-600 mt-0.5">{cert.issuer}</p>}
                  {cert.registration_number && (
                    <p className="text-xs text-gray-600">Nº {cert.registration_number}</p>
                  )}
                  <p className="text-xs text-gray-600 mt-1">
                    {cert.issued_at && <>Emitida em {formatDateOnly(cert.issued_at, 'dd/MM/yyyy')}</>}
                    {cert.issued_at && cert.expires_at && ' · '}
                    {cert.expires_at && <>Válida até {formatDateOnly(cert.expires_at, 'dd/MM/yyyy')}</>}
                  </p>

                  {/* D3 — nunca um selo genérico; sempre nomear quem conferiu. */}
                  {verified ? (
                    <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-green-800 bg-green-50 rounded-xl px-3 py-2">
                      <ShieldCheck size={14} className="flex-shrink-0 mt-0.5" />
                      Conferida por {verifierNames[cert.verified_by_company_id as string] ?? 'uma empresa'} em{' '}
                      {formatTimestampBR(cert.verified_at as string)} — confirma ter visto o documento
                      original. O Worki não verifica diplomas nem consulta conselhos profissionais.
                    </p>
                  ) : (
                    <p className="mt-2 text-xs font-semibold text-gray-600 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                      Cadastrado pelo próprio profissional — não conferido.
                    </p>
                  )}

                  <div className="mt-2">
                    {!verified && (
                      <Button
                        variant="dark"
                        onClick={() => void handleVerify(cert)}
                        loading={verifyingId === cert.id}
                        iconLeft={<ShieldCheck size={14} />}
                      >
                        Marcar como conferida
                      </Button>
                    )}
                    {verified && verifiedByThisCompany && (
                      <Button
                        variant="secondary"
                        onClick={() => void handleUnverify(cert)}
                        loading={unverifyingId === cert.id}
                        iconLeft={<ShieldOff size={14} />}
                      >
                        Desfazer conferência
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Treinamentos — registro operacional da própria empresa sobre o freela (não é o freela quem escreve) */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <GraduationCap size={20} /> Treinamentos
          </h3>
          <Button variant="dark" onClick={openTrainingForm} iconLeft={<Plus size={14} />}>
            Registrar
          </Button>
        </div>

        {trainingsLoading && (
          <div className="space-y-3 animate-pulse">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 rounded-xl" />
            ))}
          </div>
        )}

        {!trainingsLoading && trainings.length === 0 && (
          <p className="text-gray-600 text-sm">
            Sua empresa ainda não registrou nenhum treinamento para este freela.
          </p>
        )}

        {!trainingsLoading && trainings.length > 0 && (
          <div className="space-y-3">
            {trainings.map((training) => {
              const revoked = !!training.revoked_at;
              return (
                <Card
                  key={training.id}
                  padding="sm"
                  className={revoked ? 'border-gray-200 opacity-60' : 'border-gray-200'}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-bold text-sm">{training.title}</h4>
                    {revoked && (
                      <span className="bg-gray-100 text-gray-700 border border-gray-300 rounded-pill px-2 py-0.5 text-[11px] font-bold flex-shrink-0">
                        Revogado
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 mt-1">
                    Concluído em {formatDateOnly(training.completed_at, 'dd/MM/yyyy')}
                  </p>
                  {training.note && <p className="text-xs text-gray-600 mt-1">{training.note}</p>}
                  {revoked && training.revoked_reason && (
                    <p className="text-xs text-gray-600 mt-1 italic">
                      Motivo da revogação: {training.revoked_reason}
                    </p>
                  )}
                  {!revoked && (
                    <Button
                      variant="secondary"
                      className="mt-2"
                      onClick={() => {
                        setRevokingId(training.id);
                        setRevokeReason('');
                      }}
                      iconLeft={<Ban size={14} />}
                    >
                      Revogar
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal — registrar treinamento */}
      {trainingFormOpen && (
        <div
          className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget && !trainingSaving) setTrainingFormOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="training-form-title"
            className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-md p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 id="training-form-title" className="text-lg font-bold">Registrar Treinamento</h3>
              <button
                type="button"
                onClick={() => setTrainingFormOpen(false)}
                disabled={trainingSaving}
                aria-label="Fechar"
                className="h-11 w-11 -mr-2 flex items-center justify-center hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={(e) => void handleRegisterTraining(e)} className="space-y-4">
              <Field label="Título *">
                <input
                  id="training-title"
                  type="text"
                  required
                  maxLength={120}
                  value={trainingTitle}
                  onChange={(e) => setTrainingTitle(e.target.value)}
                  placeholder="Ex: Boas práticas RDC 216"
                />
              </Field>
              <Field label="Concluído em *">
                <input
                  id="training-completed"
                  type="date"
                  required
                  max={todayLocalDate()}
                  value={trainingCompletedAt}
                  onChange={(e) => setTrainingCompletedAt(e.target.value)}
                />
              </Field>
              <Field label="Observação">
                <textarea
                  id="training-note"
                  maxLength={500}
                  value={trainingNote}
                  onChange={(e) => setTrainingNote(e.target.value)}
                  className="!h-auto min-h-20 resize-none py-3"
                  placeholder="Ex: treinamento presencial de 2h com o gerente da unidade"
                />
              </Field>
              <Button type="submit" variant="dark" size="lg" fullWidth loading={trainingSaving}>
                {trainingSaving ? 'Salvando...' : 'Registrar'}
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* Modal — revogar treinamento */}
      {revokingId && (
        <div
          className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget && !revoking) setRevokingId(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="revoke-training-title"
            className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-sm p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
          >
            <h3 id="revoke-training-title" className="text-lg font-bold mb-2">Revogar Treinamento?</h3>
            <p className="text-sm text-gray-600 mb-4">
              Esta ação é definitiva — o registro fica marcado como revogado, nunca é apagado.
            </p>
            <Field label="Motivo *" className="mb-4">
              <textarea
                id="revoke-reason"
                maxLength={300}
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                className="!h-auto min-h-20 resize-none py-3"
                placeholder="Ex: registrado por engano, treinamento duplicado"
              />
            </Field>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setRevokingId(null)}
                disabled={revoking}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => void handleRevoke()}
                loading={revoking}
                iconLeft={revoking ? undefined : <Ban size={14} />}
              >
                Revogar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
