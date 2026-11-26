/**
 * CompanyToday — a tela "Hoje" (E5/R25). Rota: /company/hoje.
 *
 * Mostra os turnos de hoje e dos próximos dias, com o RESPONSÁVEL em cada turno.
 *  - Gestor: vê todos, com filtro por pessoa e por etiqueta (chips grandes). Fonte: RPC
 *    `list_jobs_by_responsible` (responsável efetivo resolvido no banco, R19).
 *  - Encarregado: vê só os dele e os que está cobrindo (a UI nunca consulta turno alheio, R9).
 * Ações opcionais: "Passar para...", "Cobrir" e "Cancelar turno". Divulgação progressiva (R23):
 * sem equipe (dono único), não existem filtros de pessoa, nem "Passar"/"Cobrir"/"Cancelar turno",
 * nem etiqueta de responsável — só os turnos.
 * Toda autorização real mora nas RPCs; esta tela é UX.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, LayoutDashboard, Megaphone, Plus, Repeat, Users, X, XCircle } from 'lucide-react';
import PageMeta from '../../components/PageMeta';
import PassJobsModal, { type PassDestination } from '../../components/company/PassJobsModal';
import CoverageModal, { type CoveragePerson } from '../../components/company/CoverageModal';
import CancelJobModal from '../../components/company/CancelJobModal';
import { useCancelJobAvailable } from '../../hooks/useCancelJobAvailable';
import {
  ActionBar, Alert, Button, Card, EmptyState, ErrorState, FilterChip, Menu, PageHeader, SkeletonList, SlotBadge, StatusBadge,
} from '../../components/ui';
import { occupancy } from '../../lib/nextAction';
import CreateShiftLink from '../../components/company/CreateShiftLink';
import SectionTabs from '../../components/SectionTabs';
import BatchList from '../../components/company/BatchList';
import { useBatchLabels } from '../../components/company/useBatchLabels';
import { GuideChecklist } from '../../components/guide/GuideChecklist';
import TrailShortcutCard from '../../components/company/TrailShortcutCard';
import { useToast } from '../../contexts/ToastContext';
import { useCurrentCompanyState } from '../../hooks/useCurrentCompany';
import { logError } from '../../lib/logger';
import { checkSession } from '../../lib/authSession';
import ErroDeVerificacao from '../../components/ErroDeVerificacao';
import { todayInBrazil } from '../../lib/dateUtils';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { useLatestResponse } from '../../hooks/useLatestResponse';
import { useAnyDialogOpen } from '../../hooks/useModalDismiss';
import { companyShiftSources } from '../../lib/realtime/liveSources';
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

  // "Hoje" NÃO congela no mount: aba aberta de um dia para o outro mostraria o dia errado. Recalcula
  // no reload, ao voltar à aba (visibilitychange) e num timer até a meia-noite de São Paulo.
  const [today, setToday] = useState<string>(() => todayInBrazil());
  const syncToday = useCallback(() => {
    const now = todayInBrazil();
    setToday((prev) => {
      if (prev === now) return prev;
      setLoading(true);
      return now;
    });
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncToday();
    };
    document.addEventListener('visibilitychange', onVisible);
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const nextMidnight = Date.parse(`${addDaysTo(todayInBrazil(), 1)}T00:00:00-03:00`);
      // +1s de folga; piso de 1s evita laço apertado se o relógio estiver estranho
      const wait = Math.max(1000, nextMidnight - Date.now() + 1000);
      timer = setTimeout(() => {
        syncToday();
        schedule();
      }, wait);
    };
    schedule();
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(timer);
    };
  }, [syncToday]);
  const companyId = company?.company_id ?? null;
  const gestor = isGestorRole(company);
  const teamEnabled = company?.team_enabled === true || company?.role === 'encarregado';
  const noCompany = resolved && company === null;
  const cancelAvailable = useCancelJobAvailable(teamEnabled);

  // quem sou eu (a UI do encarregado e os rótulos "Para mim"/"Você" dependem disto)
  const [sessionFailed, setSessionFailed] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void (async () => {
      const session = await checkSession();
      if (!active) return;
      if (session.status === 'unavailable') {
        // Rede fora não é logout: fica na tela, com "Tentar de novo".
        logError('CompanyToday.session', session.error);
        setSessionFailed(true);
        return;
      }
      setSessionFailed(false);
      setUserId(session.status === 'ok' ? session.user.id : null);
    })();
    return () => { active = false; };
  }, [sessionAttempt]);

  // sem sessão não há o que mostrar: volta ao login
  useEffect(() => {
    if (userId === null) navigate('/login', { replace: true });
  }, [userId, navigate]);

  // pessoas (só o Gestor lista a equipe), operadores, etiquetas e coberturas vigentes.
  // `silent` (ao vivo): o que falhar fica como está na tela.
  const beginSide = useLatestResponse();
  const loadSide = useCallback(
    async (isActive: () => boolean, silent = false) => {
      if (!companyId || !company) return;
      const claim = beginSide();
      const [tagList, coverageList, members, ops] = await Promise.all([
        teamEnabled ? listTagsChecked(companyId) : Promise.resolve({ ok: true, items: [] as CompanyTag[] }),
        teamEnabled ? listActiveCoveragesChecked(companyId, today) : Promise.resolve({ ok: true, items: [] as ActiveCoverage[] }),
        gestor && teamEnabled ? listMembers(companyId) : Promise.resolve(null),
        teamEnabled ? listCompanyOperators(companyId) : Promise.resolve({ ok: true, items: [] as CompanyOperator[] }),
      ]);
      if (!isActive() || !claim()) return;
      if (!silent || tagList.ok) setTags(tagList.items);
      if (!silent || coverageList.ok) setCoverages(coverageList.items);
      if (!silent) setSideFailed(!tagList.ok || !coverageList.ok);
      if (!silent || ops.ok) setOperators(ops.items);
      if (!silent) setOperatorsFailed(!ops.ok);
      if (members && members.outcome === 'ok') {
        setPeople(
          members.items
            .filter((m) => m.state === 'active' && m.userId)
            .map((m): Person => ({ userId: m.userId as string, label: m.displayName?.trim() || 'Sem nome' })),
        );
      } else if (!silent) {
        setPeople([]);
      }
    },
    [companyId, company, gestor, teamEnabled, today, beginSide],
  );

  useEffect(() => {
    let active = true;
    void loadSide(() => active);
    return () => { active = false; };
  }, [loadSide, reloadKey]);

  // turnos da janela — fora do modo silencioso, o `finally` SEMPRE encerra o carregamento
  const beginTurnos = useLatestResponse();
  const loadJobs = useCallback(
    async (isActive: () => boolean, silent = false) => {
      if (!companyId || !company) return;
      if (!gestor && !userId) return; // encarregado precisa saber quem é (sem sessão: o login cuida)
      const claim = beginTurnos();
      const from = today;
      const to = addDaysTo(today, TODAY_RANGE_DAYS - 1);
      try {
        if (gestor) {
          const result = await listJobsByResponsible({
            companyId,
            from,
            to,
            responsibleId: personFilter,
            tagId: tagFilter,
          });
          if (!isActive() || (silent && result.outcome !== 'ok') || !claim()) return;
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
          if (!isActive() || (silent && result.outcome !== 'ok') || !claim()) return;
          setLoadError(result.outcome !== 'ok');
          setJobs(result.items);
          setTruncated(false);
        }
      } catch (error) {
        logError('CompanyToday.load', error);
        if (!silent && isActive() && claim()) setLoadError(true);
      } finally {
        if (!silent && isActive()) setLoading(false);
      }
    },
    [companyId, company, gestor, userId, today, personFilter, tagFilter, beginTurnos],
  );

  useEffect(() => {
    let active = true;
    void loadJobs(() => active);
    return () => { active = false; };
  }, [loadJobs, reloadKey]);

  const dialogOpen = useAnyDialogOpen();
  useLiveRefresh({
    sources: companyId ? companyShiftSources(companyId) : [],
    onRefresh: (ctx) => Promise.all([loadJobs(ctx.isCurrent, true), loadSide(ctx.isCurrent, true)]),
    paused: loading || dialogOpen || !!passIds || coverOpen || !!cancelling || !!endingId,
  });

  const reload = useCallback(() => {
    syncToday();
    setSelected(new Set());
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, [syncToday]);

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
  const { labels: lotes, batchOf } = useBatchLabels(jobs.map((j) => j.jobId));
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

  // O subtítulo só promete o responsável quando a linha dele aparece (com equipe).
  const subtitle = !gestor
    ? 'Os seus turnos de hoje e dos próximos dias.'
    : teamEnabled
      ? 'Os turnos de hoje e dos próximos dias, com quem responde por cada um.'
      : 'Os turnos de hoje e dos próximos dias.';

  // Uma ação primária por tela: só o primeiro turno que ainda precisa de gente.
  const firstNeedingPeople = groups
    .flatMap((g) => g.jobs)
    .find((j) => occupancy(j.slots, j.filled).needsPeople)?.jobId;

  if (sessionFailed) {
    return <ErroDeVerificacao onRetry={() => { setSessionFailed(false); setSessionAttempt((n) => n + 1); }} />;
  }

  if (noCompany) {
    return (
      <div className="max-w-3xl mx-auto pb-24">
        <PageMeta title="Hoje" description="Turnos de hoje e dos próximos dias." />
        <PageHeader title="Hoje" subtitle={subtitle} />
        <Card className="text-center">
          <h2 className="text-lg font-bold">Não encontramos uma empresa nesta conta</h2>
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
    <div className="mx-auto max-w-3xl lg:max-w-5xl">
      <PageMeta title="Hoje" description="Turnos de hoje e dos próximos dias." />
      {teamEnabled && <SectionTabs section="inicio" />}
      <PageHeader
        title="Hoje"
        subtitle={subtitle}
        inlineAction={!canCover}
        action={
          // Sem turnos, o vazio já oferece "Criar turno": não repetir no cabeçalho.
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            {canCover && (
              <Button variant="secondary" data-copilot="empresa.hoje.cobrir" iconLeft={<Repeat size={18} />} onClick={() => setCoverOpen(true)}>
                {gestor ? 'Cobrir alguém' : 'Cobrir meus turnos'}
              </Button>
            )}
            {!loading && jobs.length > 0 && <CreateShiftLink />}
          </div>
        }
      />

      <GuideChecklist ocultavel className="mb-6" />
      <TrailShortcutCard className="mb-6" />

      {teamEnabled && operatorsFailed && (
        <Alert tone="warning" role="alert" className="mb-4">
          Não foi possível carregar quem pode receber turnos. "Passar para..." e "Cobrir" ficam indisponíveis por enquanto.
        </Alert>
      )}
      {teamEnabled && sideFailed && (
        <Alert
          tone="warning"
          role="alert"
          className="mb-4"
          action={<Button variant="secondary" onClick={reload}>Tentar de novo</Button>}
        >
          Não foi possível carregar as etiquetas ou as coberturas agora. Os turnos abaixo estão corretos.
        </Alert>
      )}

      {showFilters && (
        <section aria-label="Filtros" className="mb-6 space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Pessoas">
            <FilterChip pressed={!filtered} onClick={() => changeFilters(null, null)}>Todos</FilterChip>
            {gestor &&
              everyone.map((p) => (
                <FilterChip
                  key={p.userId}
                  pressed={personFilter === p.userId}
                  onClick={() => changeFilters(personFilter === p.userId ? null : p.userId, tagFilter)}
                >
                  {p.label}
                </FilterChip>
              ))}
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Etiquetas">
              {tags.map((t) => (
                <FilterChip key={t.id} pressed={tagFilter === t.id} onClick={() => changeFilters(personFilter, tagFilter === t.id ? null : t.id)}>
                  {t.name}
                </FilterChip>
              ))}
            </div>
          )}
        </section>
      )}

      {coverages.length > 0 && (
        <section aria-label="Coberturas em andamento" className="mb-6 space-y-2">
          <h2 className="text-lg font-bold">Coberturas em andamento</h2>
          {coverages.map((c) => {
            const canEnd = gestor || c.fromUserId === userId || c.toUserId === userId;
            const text = gestor
              ? `${labelOf(c.toUserId)} cobre ${labelOf(c.fromUserId)} de ${br(c.startsOn)} a ${br(c.endsOn)}`
              : c.toUserId === userId
                ? `Você cobre um colega de ${br(c.startsOn)} a ${br(c.endsOn)}`
                : `Um colega cobre os seus turnos de ${br(c.startsOn)} a ${br(c.endsOn)}`;
            return (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-status-info-line bg-status-info-bg p-3">
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
        <div role="status" aria-label="Carregando os turnos">
          <SkeletonList count={3} itemClassName="h-28" />
        </div>
      )}

      {!loading && loadError && (
        <ErrorState title="Não foi possível carregar os turnos." onRetry={reload} />
      )}

      {!loading && !loadError && jobs.length === 0 && (
        filtered ? (
          <EmptyState
            size="page"
            icon={CalendarClock}
            title="Nenhum turno com esse filtro"
            description={`Não há turnos nos próximos ${TODAY_RANGE_DAYS} dias para essa escolha.`}
            action={<Button variant="dark" onClick={() => changeFilters(null, null)}>Ver todos os turnos</Button>}
          />
        ) : (
          <EmptyState
            size="page"
            icon={CalendarClock}
            title={gestor ? `Nenhum turno nos próximos ${TODAY_RANGE_DAYS} dias` : `Você não tem turnos nos próximos ${TODAY_RANGE_DAYS} dias`}
            description={gestor
              ? 'Crie um turno e convide quem está no seu Elenco.'
              : 'Quando você criar um turno ou o Gestor passar um para você, ele aparece aqui.'}
            action={
              <Button variant="dark" data-copilot="empresa.hoje.criar-turno" iconLeft={<Plus size={18} />} onClick={() => navigate('/company/create')}>
                Criar turno
              </Button>
            }
          />
        )
      )}

      {!loading && !loadError && groups.map((group) => (
        <section key={group.date} aria-label={group.label} className="mb-8">
          <h2 className="mb-3 text-lg font-bold first-letter:uppercase">{group.label}</h2>
          <ul className="space-y-3">
            <BatchList as="li" items={group.jobs} batchOf={(j) => batchOf(j.jobId)} labels={lotes} render={(job) => {
              const passable = canPassJob(job, perms);
              // Dono único não ganha ação nova (R23); sem a RPC no ambiente, o botão não aparece.
              const cancellable = teamEnabled && cancelAvailable && canCancelJob(job, perms, new Date());
              const isSelected = selected.has(job.jobId);
              const line = responsibleLine(job);
              const state = occupancy(job.slots, job.filled);
              const presenca = `/company/jobs/${job.jobId}/candidates`;
              return (
                <li key={job.jobId}>
                  <Card padding="sm">
                    <div className="lg:flex lg:items-center lg:gap-4">
                      <div className="flex min-w-0 flex-1 items-start gap-1">
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
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                            {job.slots !== null && <SlotBadge filled={job.filled} total={job.slots} />}
                          </div>
                          <p className="mt-1 line-clamp-3 break-words text-base font-bold">{job.title}</p>
                          <p className="mt-0.5 text-sm text-gray-600">
                            {job.startTime ?? 'Sem horário'}
                            {job.slots !== null && (
                              <>
                                {' · '}
                                {job.filled !== null ? `${job.filled} de ${job.slots}` : `${job.slots}`} {job.slots === 1 ? 'vaga' : 'vagas'}
                                {job.filled !== null ? (job.slots === 1 ? ' preenchida' : ' preenchidas') : ''}
                              </>
                            )}
                          </p>
                          {teamEnabled && (
                            <p title={line} className="mt-1 flex items-start gap-1.5 text-xs text-gray-600">
                              <Users size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                              <span className="break-words">{line}</span>
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-2 lg:mt-0 lg:shrink-0">
                        {state.needsPeople ? (
                            <Button
                              variant={job.jobId === firstNeedingPeople ? 'dark' : 'secondary'}
                              className="flex-1 lg:flex-none"
                              data-copilot="empresa.hoje.chamar-freelas"
                              iconLeft={<Megaphone size={16} />}
                              onClick={() => navigate(`${presenca}?chamar=1`)}
                            >
                              Chamar freelas
                            </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            className="flex-1 lg:flex-none"
                            data-copilot="empresa.hoje.ver-turno"
                            onClick={() => navigate(presenca)}
                          >
                            Ver turno
                          </Button>
                        )}
                        <Menu
                          label={`Mais opções de ${job.title}`}
                          menuLabel="Ações do turno"
                          items={[
                            state.needsPeople && { label: 'Ver turno', icon: CalendarClock, onSelect: () => navigate(presenca) },
                            passable && { label: 'Passar para...', icon: Repeat, onSelect: () => setPassIds([job.jobId]) },
                            cancellable && { label: 'Cancelar turno', icon: XCircle, danger: true, onSelect: () => setCancelling(job) },
                          ]}
                        />
                      </div>
                    </div>
                  </Card>
                </li>
              );
            }} />
          </ul>
        </section>
      ))}

      {truncated && (
        <p className="text-center text-sm text-gray-600">Mostrando os primeiros 500 turnos. Use os filtros para ver o resto.</p>
      )}

      {/* Com equipe a Visão geral é uma aba; sem equipe (acesso direto) fica este caminho. */}
      {gestor && !teamEnabled && !loading && (
        <div className="mt-2 text-center">
          <Button variant="ghost" size="lg" iconLeft={<LayoutDashboard size={18} />} onClick={() => navigate('/company/dashboard')}>
            Ver o painel da empresa
          </Button>
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

      {selectedVisible.length > 0 && (
        <ActionBar
          summary={`${selectedVisible.length} ${selectedVisible.length === 1 ? 'turno' : 'turnos'}`}
          secondary={<Button variant="secondary" onClick={() => setSelected(new Set())}>Limpar seleção</Button>}
          primary={
            <Button variant="dark" iconLeft={<Repeat size={16} />} onClick={() => setPassIds(selectedVisible)}>
              Passar para...
            </Button>
          }
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
