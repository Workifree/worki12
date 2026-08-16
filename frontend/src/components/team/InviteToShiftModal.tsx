import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Loader2, Send, CalendarX2, PlusCircle } from 'lucide-react';
import { useCompanyInvites } from '../../hooks/useShiftInvites';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/logger';
import { todayLocalDate } from '../../lib/dateUtils';
import type { TeamMember } from '../../types';
import { formatHistoryDate } from './utils';

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

        const { data: companyRow } = await supabase
          .from('companies')
          .select('id')
          .eq('owner_id', user.id)
          .maybeSingle();
        const companyId = companyRow?.id as string | undefined;
        if (!companyId) { if (active) { setJobs([]); setLoadingJobs(false); } return; }

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

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget && !isInviting) onClose(); }}
    >
      <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-black uppercase tracking-tight">Convidar para turno</h2>
          <button onClick={onClose} aria-label="Fechar" className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>
        <p className="text-sm font-bold text-gray-500 mb-5">
          Escolha um turno para convidar <span className="font-black text-black">{member.worker.full_name}</span>.
        </p>

        {loadingJobs && (
          <div className="space-y-3 animate-pulse">
            {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-200 rounded-xl" />)}
          </div>
        )}

        {!loadingJobs && jobs.length === 0 && (
          <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-2xl text-gray-400">
            <CalendarX2 size={32} className="mx-auto mb-2 opacity-30" />
            <p className="font-bold text-sm">Nenhum turno elegível para convidar agora.</p>
            <p className="text-xs mt-1">Crie um turno aberto (sem esse freela atrelado e com data futura) para poder convidar.</p>
            <button
              onClick={() => { onClose(); navigate('/company/create'); }}
              className="mt-4 bg-black hover:bg-blue-600 text-white px-4 py-2 rounded-xl font-black uppercase text-xs transition-colors inline-flex items-center gap-2"
            >
              <PlusCircle size={16} /> Criar turno
            </button>
          </div>
        )}

        {!loadingJobs && jobs.length > 0 && (
          <>
            <div className="space-y-2 max-h-72 overflow-y-auto mb-5">
              {jobs.map((job) => {
                const selected = selectedJobId === job.id;
                return (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => setSelectedJobId(job.id)}
                    disabled={isInviting}
                    className={`w-full text-left p-3 rounded-xl border-2 transition-all disabled:opacity-50 ${
                      selected ? 'border-black bg-primary-light' : 'border-gray-100 hover:border-black'
                    }`}
                  >
                    <p className="font-black uppercase text-sm truncate">{job.title}</p>
                    <div className="flex flex-wrap gap-2 mt-1 text-xs font-bold text-gray-500">
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
            <button
              onClick={() => { void handleConfirmInvite(); }}
              disabled={!selectedJobId || isInviting}
              className="w-full bg-black hover:bg-blue-600 text-white px-6 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isInviting ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
              {isInviting ? 'Enviando convite...' : 'Confirmar convite'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
