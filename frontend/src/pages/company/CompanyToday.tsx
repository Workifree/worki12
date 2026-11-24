/**
 * CompanyToday — a tela "Hoje" (E5/R25). Rota: /company/hoje.
 *
 * Mostra os turnos de hoje e dos próximos dias, com o RESPONSÁVEL em cada turno.
 *  - Gestor: vê todos, com filtro por pessoa e por etiqueta (chips grandes). Fonte: RPC
 *    `list_jobs_by_responsible` (responsável efetivo resolvido no banco, R19).
 *  - Encarregado: vê só os dele e os que está cobrindo (a UI nunca consulta turno alheio, R9).
 * Ações opcionais: "Passar para...", "Cobrir" e "Cancelar turno". Divulgação progressiva (R23):
 * sem equipe (dono único), não existem filtros de pessoa, nem "Passar"/"Cobrir", nem etiqueta de
 * responsável — só os turnos e o cancelamento.
 * Toda autorização real mora nas RPCs; esta tela é UX.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, LayoutDashboard, Plus, Repeat, Users, X, XCircle } from 'lucide-react';
import PageMeta from '../../components/PageMeta';
import PassJobsModal, { type PassDestination } from '../../components/company/PassJobsModal';
import CoverageModal, { type CoveragePerson } from '../../components/company/CoverageModal';
import CancelJobModal from '../../components/company/CancelJobModal';
import { Button, Card, PageHeader } from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';
import { useCurrentCompanyState } from '../../hooks/useCurrentCompany';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/logger';
import { todayInBrazil } from '../../lib/dateUtils';
import {
  TODAY_RANGE_DAYS,
  addDaysTo,
  canCancelJob,
  canPassJob,
  groupByDay,
  responsibleLine,
} from '../../lib/todayView';
import { isGestor as isGestorRole } from '../../services/companyScopeService';
import { listMembers } from '../../services/teamMembersService';
import {
  cancelJobMessage,
  endCoverage,
  listActiveCoveragesChecked,
  listCompanyOperators,
  listJobsByResponsible,
  listOwnJobs,
  listTagsChecked,
  type ActiveCoverage,
  type CancelJobResult,
  type CompanyOperator,
  type CompanyTag,
  type TodayJob,
} from '../../services/shiftOperationService';

interface Person {
  userId: string;
  label: string;
}

const CHIP_BASE = 'min-h-12 rounded-xl border-2 px-5 text-base font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2';

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`${CHIP_BASE} ${active ? 'border-black bg-black text-white' : 'border-gray-300 bg-white text-black hover:border-black'}`}
    >
      {children}
    </button>
  );
}

function br(dateOnly: string): string {
  const [, m, d] = dateOnly.split('-');
  return `${d}/${m}`;
}

/** Nomes repetidos ganham numeração ("Ana (1)", "Ana (2)") para a pessoa saber qual escolher. */
function disambiguate<T extends { label: string }>(items: T[]): T[] {
  const count = new Map<string, number>();
  items.forEach((i) => count.set(i.label, (count.get(i.label) ?? 0) + 1));
  const seen = new Map<string, number>();
  return items.map((i) => {
    if ((count.get(i.label) ?? 0) < 2) return i;
    const n = (seen.get(i.label) ?? 0) + 1;
    seen.set(i.label, n);
    return { ...i, label: `${i.label} (${n})` };
  });
}

export default function CompanyToday() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { company, resolved } = useCurrentCompanyState();

  // undefined = ainda resolvendo; null = sem sessão
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [people, setPeople] = useState<Person[]>([]);
  const [operators, setOperators] = useState<CompanyOperator[]>([]);
  const [operatorsFailed, setOperatorsFailed] = useState(false);
  const [tags, setTags] = useState<CompanyTag[]>([]);
  const [sideFailed, setSideFailed] = useState(false);
  const [coverages, setCoverages] = useState<ActiveCoverage[]>([]);
  const [jobs, setJobs] = useState<TodayJob[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [passIds, setPassIds] = useState<string[] | null>(null);
  const [coverOpen, setCoverOpen] = useState(false);
  const [cancelling, setCancelling] = useState<TodayJob | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);

  const today = useMemo(() => todayInBrazil(), []);
  const companyId = company?.company_id ?? null;
  const gestor = isGestorRole(company);
  const teamEnabled = company?.team_enabled === true || company?.role === 'encarregado';
  const noCompany = resolved && company === null;

  // quem sou eu (a UI do encarregado e os rótulos "Para mim"/"Você" dependem disto)
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (active) setUserId(data.user?.id ?? null);
      } catch (error) {
        logError('CompanyToday.getUser', error);
        if (active) setUserId(null);
      }
    })();
    return () => { active = false; };
  }, []);

  // sem sessão não há o que mostrar: volta ao login
  useEffect(() => {
    if (userId === null) navigate('/login', { replace: true });
  }, [userId, navigate]);

  // pessoas (só o Gestor lista a equipe), operadores, etiquetas e coberturas vigentes
  useEffect(() => {
    if (!companyId || !company) return;
    let active = true;
    void (async () => {
      const [tagList, coverageList, members, ops] = await Promise.all([
        teamEnabled ? listTagsChecked(companyId) : Promise.resolve({ ok: true, items: [] as CompanyTag[] }),
        teamEnabled ? listActiveCoveragesChecked(companyId, today) : Promise.resolve({ ok: true, items: [] as ActiveCoverage[] }),
        gestor && teamEnabled ? listMembers(companyId) : Promise.resolve(null),
        teamEnabled ? listCompanyOperators(companyId) : Promise.resolve({ ok: true, items: [] as CompanyOperator[] }),
      ]);
      if (!active) return;
      setTags(tagList.items);
      setCoverages(coverageList.items);
      setSideFailed(!tagList.ok || !coverageList.ok);
      setOperators(ops.items);
      setOperatorsFailed(!ops.ok);
      if (members && members.outcome === 'ok') {
        setPeople(
          members.items
            .filter((m) => m.state === 'active' && m.userId)
            .map((m): Person => ({ userId: m.userId as string, label: m.displayName?.trim() || 'Sem nome' })),
        );
      } else {
        setPeople([]);
      }
    })();
    return () => { active = false; };
  }, [companyId, company, gestor, teamEnabled, today, reloadKey]);

  // turnos da janela — o `finally` SEMPRE encerra o carregamento
  useEffect(() => {
    if (!companyId || !company) return;
    if (!gestor && !userId) return; // encarregado precisa saber quem é (sem sessão: o login cuida)
    let active = true;
    const from = today;
    const to = addDaysTo(today, TODAY_RANGE_DAYS - 1);
    void (async () => {
      try {
        if (gestor) {
          const result = await listJobsByResponsible({
            companyId,
            from,
            to,
            responsibleId: personFilter,
            tagId: tagFilter,
          });
          if (!active) return;
          if (result.outcome !== 'ok') {
            setLoadError(true);
            setJobs([]);
          } else {
            setLoadError(false);
            setJobs(result.items);
            setTruncated(result.truncated);
          }
        } else {
          const result = await listOwnJobs({ companyId, userId: userId as string, from, to, tagId: tagFilter });
          if (!active) return;
          setLoadError(result.outcome !== 'ok');
          setJobs(result.items);
          setTruncated(false);
        }
      } catch (error) {
        logError('CompanyToday.load', error);
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [companyId, company, gestor, userId, today, personFilter, tagFilter, reloadKey]);

  const reload = useCallback(() => {
    setSelected(new Set());
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  /** Trocar filtro mostra o esqueleto e zera a seleção (não dá para passar o que não está na tela). */
  const changeFilters = (person: string | null, tag: string | null) => {
    setPersonFilter(person);
    setTagFilter(tag);
    setSelected(new Set());
    setLoading(true);
  };

  // pessoas do filtro: equipe ativa + o próprio Gestor ("Eu") quando ele não tem linha na equipe
  const everyone = useMemo<Person[]>(() => {
    if (!gestor || !userId) return people;
    return people.some((p) => p.userId === userId) ? people : [{ userId, label: 'Eu' }, ...people];
  }, [gestor, userId, people]);

  // Destinos de "Passar para...": o Gestor também pode passar "para mim"; o encarregado não passa a si.
  const destinations = useMemo<PassDestination[]>(() => {
    const list = operators
      .filter((o) => (gestor ? true : o.userId !== userId))
      .map((o) => ({ userId: o.userId, label: o.userId === userId ? 'Para mim' : o.label }));
    return disambiguate(list);
  }, [operators, gestor, userId]);

  // Cobertura é só entre encarregados (papel vem da lista de operadores).
  const encarregados = useMemo<CoveragePerson[]>(
    () =>
      disambiguate(
        operators
          .filter((o) => o.role === 'encarregado')
          .map((o) => ({ userId: o.userId, label: !gestor && o.userId === userId ? 'Você' : o.label })),
      ),
    [operators, gestor, userId],
  );

  const perms = { isGestor: gestor, teamEnabled, hasDestinations: destinations.length > 0 && !operatorsFailed };
  const othersEncarregados = encarregados.filter((p) => p.userId !== userId).length;
  const canCover =
    teamEnabled && !operatorsFailed && (gestor ? encarregados.length >= 2 : othersEncarregados > 0);
  const showFilters = teamEnabled && (gestor ? everyone.length > 1 || tags.length > 0 : tags.length > 0);
  const filtered = personFilter !== null || tagFilter !== null;

  const groups = useMemo(() => groupByDay(jobs, today), [jobs, today]);
  const visibleIds = useMemo(() => new Set(jobs.map((j) => j.jobId)), [jobs]);
  const selectedVisible = useMemo(() => [...selected].filter((id) => visibleIds.has(id)), [selected, visibleIds]);
  const labelOf = useCallback(
    (id: string) => operators.find((o) => o.userId === id)?.label ?? people.find((p) => p.userId === id)?.label ?? (id === userId ? 'você' : 'um colega'),
    [operators, people, userId],
  );

  const toggleSelected = (jobId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });

  const handleEndCoverage = async (coverage: ActiveCoverage) => {
    setEndingId(coverage.id);
    const result = await endCoverage(coverage.id);
    setEndingId(null);
    const ok = result.outcome === 'ended' || result.outcome === 'already_ended';
    addToast(ok ? 'Cobertura encerrada.' : 'Não foi possível encerrar a cobertura agora.', ok ? 'success' : 'error');
    reload();
  };

  const handleCancelled = (result: CancelJobResult) => {
    addToast(
      cancelJobMessage(result, gestor ? 'gestor' : 'encarregado'),
      result.outcome === 'cancelled' || result.outcome === 'already_cancelled' ? 'success' : 'info',
    );
    setCancelling(null);
    reload();
  };

  const subtitle = gestor
    ? 'Os turnos de hoje e dos próximos dias, com quem responde por cada um.'
    : 'Os seus turnos de hoje e dos próximos dias.';

  if (noCompany) {
    return (
      <div className="max-w-3xl mx-auto pb-24">
        <PageMeta title="Hoje" description="Turnos de hoje e dos próximos dias." />
        <PageHeader title="Hoje" subtitle={subtitle} />
        <Card className="text-center">
          <h2 className="text-xl font-black">Não encontramos uma empresa nesta conta</h2>
          <p className="mb-4 mt-1 text-sm text-gray-700">
            Pode ser uma falha de conexão ou a conta ainda não está ligada a uma empresa. Tente de novo ou entre com outra conta.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button variant="dark" size="lg" onClick={() => window.location.reload()}>Tentar de novo</Button>
            <Button variant="secondary" size="lg" onClick={() => navigate('/login')}>Ir para o login</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className={`max-w-3xl mx-auto animate-in fade-in duration-300 ${selectedVisible.length > 0 ? 'pb-44' : 'pb-24'}`}>
      <PageMeta title="Hoje" description="Turnos de hoje e dos próximos dias." />
      <PageHeader
        title="Hoje"
        subtitle={subtitle}
        action={
          canCover ? (
            <Button variant="secondary" size="lg" iconLeft={<Repeat size={18} />} onClick={() => setCoverOpen(true)}>
              {gestor ? 'Cobrir alguém' : 'Cobrir meus turnos'}
            </Button>
          ) : undefined
        }
      />

      {teamEnabled && operatorsFailed && (
        <p role="alert" className="mb-4 rounded-xl border-2 border-black bg-yellow-50 p-3 text-sm font-semibold">
          Não foi possível carregar quem pode receber turnos. "Passar para..." e "Cobrir" ficam indisponíveis por enquanto.
        </p>
      )}
      {teamEnabled && sideFailed && (
        <p role="alert" className="mb-4 rounded-xl border-2 border-black bg-yellow-50 p-3 text-sm font-semibold">
          Não foi possível carregar as etiquetas ou as coberturas agora. Os turnos abaixo estão corretos.{' '}
          <button type="button" className="font-black underline" onClick={reload}>Tentar de novo</button>
        </p>
      )}

      {showFilters && (
        <section aria-label="Filtros" className="mb-6 space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Pessoas">
            <Chip active={!filtered} onClick={() => changeFilters(null, null)}>Todos</Chip>
            {gestor &&
              everyone.map((p) => (
                <Chip
                  key={p.userId}
                  active={personFilter === p.userId}
                  onClick={() => changeFilters(personFilter === p.userId ? null : p.userId, tagFilter)}
                >
                  {p.label}
                </Chip>
              ))}
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Etiquetas">
              {tags.map((t) => (
                <Chip key={t.id} active={tagFilter === t.id} onClick={() => changeFilters(personFilter, tagFilter === t.id ? null : t.id)}>
                  {t.name}
                </Chip>
              ))}
            </div>
          )}
        </section>
      )}

      {coverages.length > 0 && (
        <section aria-label="Coberturas em andamento" className="mb-6 space-y-2">
          <h2 className="text-lg font-black">Coberturas em andamento</h2>
          {coverages.map((c) => {
            const canEnd = gestor || c.fromUserId === userId || c.toUserId === userId;
            const text = gestor
              ? `${labelOf(c.toUserId)} cobre ${labelOf(c.fromUserId)} de ${br(c.startsOn)} a ${br(c.endsOn)}`
              : c.toUserId === userId
                ? `Você cobre um colega de ${br(c.startsOn)} a ${br(c.endsOn)}`
                : `Um colega cobre os seus turnos de ${br(c.startsOn)} a ${br(c.endsOn)}`;
            return (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-black bg-blue-50 p-3">
                <p className="min-w-0 flex-1 text-sm font-bold">{text}. Termina sozinha em {br(c.endsOn)}.</p>
                {canEnd && (
                  <Button variant="secondary" size="md" loading={endingId === c.id} iconLeft={<X size={16} />} onClick={() => { void handleEndCoverage(c); }}>
                    Encerrar
                  </Button>
                )}
              </div>
            );
          })}
        </section>
      )}

      {loading && (
        <div className="space-y-4" role="status" aria-label="Carregando os turnos">
          <div className="h-28 animate-pulse rounded-xl bg-gray-200" />
          <div className="h-28 animate-pulse rounded-xl bg-gray-200" />
        </div>
      )}

      {!loading && loadError && (
        <Card className="text-center">
          <p className="mb-3 font-bold">Não foi possível carregar os turnos.</p>
          <Button variant="dark" size="lg" onClick={reload}>Tentar de novo</Button>
        </Card>
      )}

      {!loading && !loadError && jobs.length === 0 && (
        <Card className="text-center">
          <CalendarClock size={32} className="mx-auto mb-2 text-gray-500" aria-hidden="true" />
          {filtered ? (
            <>
              <h2 className="text-xl font-black">Nenhum turno com esse filtro</h2>
              <p className="mb-4 mt-1 text-sm text-gray-700">Não há turnos nos próximos {TODAY_RANGE_DAYS} dias para essa escolha.</p>
              <Button variant="dark" size="lg" onClick={() => changeFilters(null, null)}>Ver todos os turnos</Button>
            </>
          ) : gestor ? (
            <>
              <h2 className="text-xl font-black">Nenhum turno nos próximos {TODAY_RANGE_DAYS} dias</h2>
              <p className="mb-4 mt-1 text-sm text-gray-700">Crie um turno e convide quem está no seu Elenco.</p>
              <Button variant="dark" size="lg" iconLeft={<Plus size={18} />} onClick={() => navigate('/company/create')}>Criar turno</Button>
            </>
          ) : (
            <>
              <h2 className="text-xl font-black">Você não tem turnos nos próximos {TODAY_RANGE_DAYS} dias</h2>
              <p className="mt-1 text-sm text-gray-700">
                Quando você criar um turno ou o Gestor passar um para você, ele aparece aqui.
              </p>
              <Button variant="dark" size="lg" className="mt-4" iconLeft={<Plus size={18} />} onClick={() => navigate('/company/create')}>Criar turno</Button>
            </>
          )}
        </Card>
      )}

      {!loading && !loadError && groups.map((group) => (
        <section key={group.date} aria-label={group.label} className="mb-8">
          <h2 className="mb-3 text-xl font-black capitalize">{group.label}</h2>
          <ul className="space-y-3">
            {group.jobs.map((job) => {
              const passable = canPassJob(job, perms);
              const cancellable = canCancelJob(job, perms);
              const isSelected = selected.has(job.jobId);
              const line = responsibleLine(job);
              return (
                <li key={job.jobId}>
                  <Card>
                    <div className="flex items-start gap-1">
                      {passable && (
                        <label className="-ml-2 -mt-1 flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelected(job.jobId)}
                            aria-label={`Selecionar ${job.title} para passar`}
                            className="h-6 w-6 accent-black"
                          />
                        </label>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-lg font-black">{job.title}</p>
                        <p className="mt-0.5 text-sm text-gray-700">
                          {job.startTime ?? 'Sem horário'}
                          {job.slots !== null && (
                            <>
                              {' · '}
                              {job.filled !== null ? `${job.filled} de ${job.slots}` : `${job.slots}`} {job.slots === 1 ? 'vaga' : 'vagas'}
                              {job.filled !== null ? ' preenchida' + (job.filled === 1 ? '' : 's') : ''}
                            </>
                          )}
                        </p>
                        {teamEnabled && (
                          <span
                            title={line}
                            className="mt-2 inline-flex max-w-full items-start gap-1.5 rounded-xl bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700"
                          >
                            <Users size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                            <span className="break-words">{line}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <Button variant="dark" size="lg" onClick={() => navigate(`/company/jobs/${job.jobId}/candidates`)}>
                        Abrir turno
                      </Button>
                      {passable && (
                        <Button variant="secondary" size="lg" iconLeft={<Repeat size={16} />} onClick={() => setPassIds([job.jobId])}>
                          Passar para...
                        </Button>
                      )}
                      {cancellable && (
                        <Button variant="secondary" size="lg" iconLeft={<XCircle size={16} />} onClick={() => setCancelling(job)}>
                          Cancelar turno
                        </Button>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {truncated && (
        <p className="text-center text-sm text-gray-600">Mostrando os primeiros 500 turnos. Use os filtros para ver o resto.</p>
      )}

      {gestor && !loading && (
        <div className="mt-2 text-center">
          <Button variant="ghost" size="lg" iconLeft={<LayoutDashboard size={18} />} onClick={() => navigate('/company/dashboard')}>
            Ver o painel da empresa
          </Button>
        </div>
      )}

      {selectedVisible.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 px-4 md:bottom-6 md:left-auto md:right-6 md:w-auto md:px-0">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-black bg-white p-3 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
            <p className="text-sm font-bold">{selectedVisible.length} {selectedVisible.length === 1 ? 'turno' : 'turnos'}</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="lg" onClick={() => setSelected(new Set())}>Limpar seleção</Button>
              <Button variant="dark" size="lg" iconLeft={<Repeat size={16} />} onClick={() => setPassIds(selectedVisible)}>
                Passar para...
              </Button>
            </div>
          </div>
        </div>
      )}

      {passIds && (
        <PassJobsModal
          jobIds={passIds}
          destinations={destinations}
          onClose={() => setPassIds(null)}
          onDone={(message) => {
            addToast(message, 'success');
            setPassIds(null);
            reload();
          }}
        />
      )}

      {coverOpen && companyId && (
        <CoverageModal
          companyId={companyId}
          people={encarregados}
          fixedFromUserId={gestor ? undefined : (userId ?? undefined)}
          onClose={() => setCoverOpen(false)}
          onDone={(message) => {
            addToast(message, 'success');
            setCoverOpen(false);
            reload();
          }}
        />
      )}

      {cancelling && (
        <CancelJobModal
          job={{ id: cancelling.jobId, title: cancelling.title, dateLabel: br(cancelling.date) }}
          role={gestor ? 'gestor' : 'encarregado'}
          onClose={() => setCancelling(null)}
          onCancelled={handleCancelled}
        />
      )}
    </div>
  );
}
