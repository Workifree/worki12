import { useState, useEffect } from 'react';
import { useModalDismiss } from '../../hooks/useModalDismiss';
import { useNavigate } from 'react-router-dom';
import { Send, CalendarX2, PlusCircle } from 'lucide-react';
import { useCompanyInvites } from '../../hooks/useShiftInvites';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/logger';
import { todayLocalDate } from '../../lib/dateUtils';
import type { TeamMember } from '../../types';
import { formatHistoryDate } from './utils';
import { getAuthenticatedCompanyId } from '../../services/companyScopeService';
import { ModalShell } from './ModalShell';
import { Button } from '../ui';

// ---------------------------------------------------------------------------
// Subcomponent: modal "Convidar para turno" — a partir de um freela do elenco,
// escolhe um turno elegível (open/paused, sem esse freela já atrelado, data
// futura ou sem data) e dispara o convite via useCompanyInvites.
//
// Data de hoje em horário LOCAL (`todayLocalDate()`, `lib/dateUtils.ts`) — evita
// off-by-one de fuso que `toISOString()` (UTC) causaria à noite em BRT (das 21h
// às 23:59, `todayStr` UTC já vira amanhã e descartaria o turno de hoje como
// "passado").
// ---------------------------------------------------------------------------

interface EligibleJob {
  id: string;
  title: string;
  start_date: string | null;
  work_start_time: string | null;
  work_end_time: string | null;
  location: string | null;
  budget: number | null;
}

export interface InviteToShiftModalProps {
  member: TeamMember;
  onClose: () => void;
  onInvited: () => void;
}

export function InviteToShiftModal({ member, onClose, onInvited }: InviteToShiftModalProps) {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<EligibleJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const { invite, invitingWorkerId } = useCompanyInvites(selectedJobId);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoadingJobs(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { if (active) setLoadingJobs(false); return; }

        // `owner_id` sozinho e a ancora antiga: nao cobre gerente de unidade.
        let companyId: string;
        try {
          companyId = await getAuthenticatedCompanyId();
        } catch {
          if (active) { setJobs([]); setLoadingJobs(false); }
          return;
        }

        // Turnos abertos/pausados desta empresa — candidatos a convite.
        const { data: jobsData, error: jobsErr } = await supabase
          .from('jobs')
          .select('id, title, start_date, work_start_time, work_end_time, location, budget')
          .eq('company_id', companyId)
          .in('status', ['open', 'paused'])
          .order('start_date', { ascending: true });

        if (jobsErr) {
          logError('CompanyTeam.InviteToShiftModal.fetchJobs', jobsErr);
          if (active) { setJobs([]); setLoadingJobs(false); }
          return;
        }

        const todayStr = todayLocalDate();
        // Data futura (ou hoje) ou sem data — convidar para turno de ontem não faz sentido.
        const futureOrUndated = (jobsData ?? []).filter(
          (j) => !j.start_date || j.start_date >= todayStr,
        );

        const jobIds = futureOrUndated.map((j) => j.id);
        let excludeSet = new Set<string>();
        if (jobIds.length > 0) {
          const { data: apps, error: appsErr } = await supabase
            .from('applications')
            .select('job_id')
            .eq('worker_id', member.worker.id)
            .in('job_id', jobIds);
          if (appsErr) {
            logError('CompanyTeam.InviteToShiftModal.fetchApps', appsErr);
          } else {
            excludeSet = new Set((apps ?? []).map((a) => a.job_id as string));
          }
        }

        const eligible = futureOrUndated.filter((j) => !excludeSet.has(j.id));
        if (active) setJobs(eligible);
      } catch (err) {
        logError('CompanyTeam.InviteToShiftModal', err);
        if (active) setJobs([]);
      } finally {
        if (active) setLoadingJobs(false);
      }
    })();

    return () => { active = false; };
  }, [member.worker.id]);

  const handleConfirmInvite = async () => {
    if (!selectedJobId) return;
    const ok = await invite(member.worker.id);
    if (ok) {
      onInvited();
      onClose();
    }
  };

  const isInviting = invitingWorkerId === member.worker.id;
  // ESC com a mesma guarda do clique no fundo: nao fechar no meio do convite.
  useModalDismiss(() => { if (!isInviting) onClose(); });

  return (
    <ModalShell
      title="Convidar para turno"
      subtitle={
        <>
          Escolha um turno para convidar <span className="font-bold text-black">{member.worker.full_name}</span>.
        </>
      }
      onClose={onClose}
      locked={isInviting}
      footer={
        !loadingJobs && jobs.length > 0 ? (
          <Button
            variant="dark"
            size="lg"
            fullWidth
            onClick={() => { void handleConfirmInvite(); }}
            disabled={!selectedJobId}
            loading={isInviting}
            iconLeft={<Send size={18} />}
          >
            {isInviting ? 'Enviando convite...' : 'Confirmar convite'}
          </Button>
        ) : undefined
      }
    >
      {loadingJobs && (
        <div className="space-y-3 animate-pulse">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-200 rounded-xl" />)}
        </div>
      )}

      {!loadingJobs && jobs.length === 0 && (
        <div className="text-center py-8 px-4 border-2 border-dashed border-gray-300 rounded-2xl text-gray-600">
          <CalendarX2 size={32} className="mx-auto mb-2 text-gray-400" />
          <p className="font-semibold text-sm">Nenhum turno elegível para convidar agora.</p>
          <p className="text-xs mt-1">Crie um turno aberto (sem esse freela atrelado e com data futura) para poder convidar.</p>
          <Button
            variant="dark"
            className="mt-4"
            onClick={() => { onClose(); navigate('/company/create'); }}
            iconLeft={<PlusCircle size={16} />}
          >
            Criar turno
          </Button>
        </div>
      )}

      {!loadingJobs && jobs.length > 0 && (
        <div className="space-y-2" role="group" aria-label="Turnos elegíveis">
          {jobs.map((job) => {
            const selected = selectedJobId === job.id;
            return (
              <button
                key={job.id}
                type="button"
                onClick={() => setSelectedJobId(job.id)}
                disabled={isInviting}
                aria-pressed={selected}
                className={`w-full text-left min-h-11 p-3 rounded-xl border-2 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 ${
                  selected ? 'border-black bg-primary-light' : 'border-gray-200 hover:border-black'
                }`}
              >
                <p className="font-bold text-sm truncate">{job.title}</p>
                <div className="flex flex-wrap gap-x-2 mt-1 text-xs text-gray-600">
                  {job.start_date ? (
                    <span>{formatHistoryDate(job.start_date)}</span>
                  ) : (
                    <span>Sem data definida</span>
                  )}
                  {job.work_start_time && <span>· {job.work_start_time.slice(0, 5)}{job.work_end_time ? `–${job.work_end_time.slice(0, 5)}` : ''}</span>}
                  {typeof job.budget === 'number' && <span>· R$ {job.budget.toFixed(2).replace('.', ',')}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </ModalShell>
  );
}
