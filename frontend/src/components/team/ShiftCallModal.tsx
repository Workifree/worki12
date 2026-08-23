import { useState, useEffect, useMemo } from 'react';
import { X, Loader2, Megaphone, Users, Search, AlertTriangle, CalendarCheck2, Award } from 'lucide-react';
import { TeamConnectionService } from '../../services/teamConnectionService';
import { TeamListService } from '../../services/teamListService';
import { LinkRiskService, type LinkRiskConfig } from '../../services/linkRiskService';
import {
  ShiftCallService,
  CALL_EXPIRY_PRESETS,
  DEFAULT_CALL_EXPIRY_HOURS,
  calcExpiryAtShiftStart,
} from '../../services/shiftCallService';
import { useToast } from '../../contexts/ToastContext';
import { SHIFT_CALL_REASON_LABELS } from '../../types';
import type { TeamMember, ShiftCallReason, Job, TeamListWithMembers } from '../../types';
import { DEFAULT_LINK_RISK_THRESHOLD } from '../company/seriesWeekRisk';
import { getWeekdayIndex } from '../../lib/dateUtils';
import { periodForTime, isWorkerAvailableFor } from '../../lib/availability';

// ---------------------------------------------------------------------------
// Modal "Chamar freelas" — o gesto central do F1.
//
// Substitui o ritual de escolher uma pessoa, mandar o convite e esperar horas: a empresa marca
// quantos quiser do elenco, escolhe em quanto tempo o chamado morre, e quem aceitar primeiro
// fica com a vaga. Um único selecionado é o convite individual de sempre — mesma tela.
//
// Três escolhas de desenho que vieram direto da operação real (entrevista 17/08/2026):
//  1. "Selecionar todos" e busca por nome/função: às 8h30, com a loja abrindo às 11h, ninguém
//     marca oito pessoas uma a uma.
//  2. Janela curta (default 2h, não 48h): o valor não é só o freela responder — é o gerente
//     descobrir RÁPIDO que ninguém vai vir, enquanto ainda dá tempo de chamar mais gente.
//  3. Motivo da quebra obrigatório na prática (default "Outro"): é uma linha de dropdown que
//     devolve o relatório que o sócio-operador já monta na mão hoje (falta × quebra de escala).
//
// F2 (Listas salvas do elenco) somou um atalho: chips por lista salva ("Cozinha", "Salão") entre
// o grid Motivo/Expira e a busca. Clique é UNIÃO com o que já estava selecionado (nunca limpa
// seleção manual nem de outro chip); a contagem do chip é a de DISPONÍVEIS pro turno, não o total
// de membros da lista — um membro que já está no turno (`excludeWorkerIds`) ou que saiu do elenco
// desde que a lista foi criada é filtrado em silêncio contra o `available` já calculado abaixo,
// sem query nova e sem erro visível. Zero listas cadastradas = zero mudança visual (comportamento
// intacto).
//
// F5 (Guarda de risco de vínculo) somou o selo "Já Nx esta semana": `my_link_risk_config()` é
// buscada em PARALELO com o elenco (mesmo `Promise.all` — LM-9, evita um round-trip serial às
// 8h30) e a contagem por freela (`countForShift`) é resolvida DEPOIS, em estado PRÓPRIO
// (`riskCounts`/`riskLoading`) — nunca no `loadingTeam` único do modal (LM-10): a lista do elenco
// nunca espera o selo. O selo só aparece para membros SELECIONADOS (fato, nunca conclusão
// jurídica — R7); "desligado" (`enabled=false`) apenas some da tela, não impede a contagem de já
// ter sido pedida (LM-9 relaxa a A5 original).
//
// F7 (Disponibilidade declarada) ORDENA, nunca filtra: quem casou com o dia+período do turno vem
// primeiro; quem não casou e quem nunca declarou ficam no MESMO patamar visual (sem selo, sem
// prioridade — só a ordem relativa estável do `Array.prototype.sort`). Landmine central (DDL
// §3.5, LM-7): `available` NUNCA é reordenado nem mutado — `availableWorkerIdsKey` (F5, acima) é
// derivado dele e é dependência do efeito que dispara `countForShift`; reordenar em lugar mudaria
// essa chave e redispararia a RPC da F5 a cada render. `ordered` é um memo NOVO, cópia de
// `available`, e a ordenação depende só de dado SÍNCRONO (`job.start_date`/`work_start_time` +
// `member.worker.availability_days`, que já chega junto do roster) — nunca de `riskCounts`/
// `riskLoading`, ou a lista pularia na tela quando a RPC da F5 aterrissasse depois do primeiro
// paint. Selo (contorno, nunca fill — o card selecionado já pinta o fundo de verde) mora num
// CONTÊINER de sinais na linha do cargo (R10), não solto — é o mesmo contêiner que a F8
// (certificações) vai usar como vizinho, sem precisar refazer o layout das duas linhas anteriores.
// ---------------------------------------------------------------------------

export interface ShiftCallModalProps {
  job: Pick<Job, 'id' | 'title' | 'start_date' | 'work_start_time' | 'certification_requirement'> & {
    slots?: number;
  };
  /** Freelas que já estão no turno (contratados ou já chamados) — não aparecem para seleção. */
  excludeWorkerIds?: string[];
  onClose: () => void;
  onDispatched: () => void;
}

export function ShiftCallModal({
  job,
  excludeWorkerIds = [],
  onClose,
  onDispatched,
}: ShiftCallModalProps) {
  const { addToast } = useToast();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [lists, setLists] = useState<TeamListWithMembers[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState<ShiftCallReason>('falta');
  // `null` = "até o início do turno"; número = horas.
  const [expiryHours, setExpiryHours] = useState<number | null>(DEFAULT_CALL_EXPIRY_HOURS);
  const [dispatching, setDispatching] = useState(false);
  // F5: config da guarda de vínculo (busca em paralelo, nunca em série — LM-9) e contagem por
  // freela (estado próprio, nunca segura a lista do elenco — LM-10).
  const [riskConfig, setRiskConfig] = useState<LinkRiskConfig | null>(null);
  const [riskCounts, setRiskCounts] = useState<Map<string, number> | null>(null);
  const [riskLoading, setRiskLoading] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoadingTeam(true);
      // `allSettled`, não `all`: a config de risco (F5) é um "extra" sobre o carregamento do
      // elenco (F1) — se `LinkRiskService.getConfig()` falhar por qualquer motivo (o contrato do
      // service já degrada sozinho, mas isto é defesa em profundidade), a lista do elenco não
      // pode travar em `loadingTeam=true` para sempre por causa de uma feature acessória.
      const [teamResult, listsResult, configResult] = await Promise.allSettled([
        TeamConnectionService.listTeamMembers(),
        TeamListService.listLists(),
        LinkRiskService.getConfig(),
      ]);
      if (!active) return;
      setMembers(teamResult.status === 'fulfilled' ? teamResult.value : []);
      setLists(listsResult.status === 'fulfilled' ? listsResult.value : []);
      setRiskConfig(configResult.status === 'fulfilled' ? configResult.value : null);
      setLoadingTeam(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const excluded = useMemo(() => new Set(excludeWorkerIds), [excludeWorkerIds]);

  const available = useMemo(
    () => members.filter((member) => !excluded.has(member.worker.id)),
    [members, excluded],
  );

  // F5-08 (mutação sobrevivente/nit): `available` é um array NOVO a cada render sempre que o pai
  // (`CompanyJobCandidates` etc.) passa `excludeWorkerIds` como array literal — mesmo quando o
  // CONTEÚDO não mudou. Se o efeito abaixo dependesse do array em si, a RPC de contagem
  // redispararia a cada re-render do pai. Uma chave-string (primitivo, comparado por VALOR, não
  // por referência) estabiliza a dependência sem perder a checagem de conteúdo.
  const availableWorkerIdsKey = useMemo(
    () => available.map((member) => member.worker.id).join(','),
    [available],
  );

  // F7 — dia da semana + período do turno, derivados de dado JÁ presente na tela (job passado
  // via prop), síncrono, zero query nova. `getWeekdayIndex` (não `new Date(iso).getDay()` cru)
  // evita o off-by-one de fuso documentado em `lib/dateUtils.ts` (LM-4 do DDL). `periodForTime`
  // aceita `HH:MM` e `HH:MM:SS` (LM-5).
  const weekday = useMemo(() => getWeekdayIndex(job.start_date), [job.start_date]);
  const shiftPeriod = useMemo(() => periodForTime(job.work_start_time), [job.work_start_time]);

  // F7 — quem, dentro de `available`, declarou disponibilidade para este dia+período. Vazio
  // quando o horário do turno não resolve em período conhecido (`shiftPeriod === null`) — nesse
  // caso ninguém é destacado, nunca um grupo inventado.
  const matchingAvailabilityIds = useMemo(
    () =>
      new Set(
        shiftPeriod === null
          ? []
          : available
              .filter((member) =>
                isWorkerAvailableFor(member.worker.availability_days, weekday, shiftPeriod),
              )
              .map((member) => member.worker.id),
      ),
    [available, weekday, shiftPeriod],
  );

  // F7 — `ordered` é uma CÓPIA de `available`, nunca `available` em si (LM-7): reordenar em lugar
  // mudaria `availableWorkerIdsKey` (F5, acima) e redispararia `countForShift` a cada render.
  // Sem sinal (`matchingAvailabilityIds` vazio), devolve `available` pela MESMA referência — evita
  // re-render de filhos memoizados e mantém a ordem idêntica quando não há o que priorizar.
  // `Array.prototype.sort` é estável (ES2019+): dentro de cada grupo (match / sem match) a ordem
  // relativa não muda — quem não declarou e quem declarou outro período ficam exatamente no mesmo
  // patamar, sem diferenciação de ordem entre eles.
  const ordered = useMemo(() => {
    if (matchingAvailabilityIds.size === 0) return available;
    return [...available].sort(
      (a, b) =>
        Number(matchingAvailabilityIds.has(b.worker.id)) -
        Number(matchingAvailabilityIds.has(a.worker.id)),
    );
  }, [available, matchingAvailabilityIds]);

  // F5 — LM-9/LM-10/LM-11: dispara SÓ depois que o elenco + a config chegaram (a lista já
  // renderizou nesse ponto; este efeito nunca segura `loadingTeam`), com `p_worker_ids` restrito
  // a quem está VISÍVEL no modal (`available` já exclui `excludeWorkerIds` — nunca conta quem nem
  // aparece no chamado). `enabled !== false` trata `undefined` como ligado (LM-6/fail-safe) —
  // config ainda não resolvida não é motivo pra pular a contagem. Os casos "não precisa buscar"
  // (desligado / elenco vazio) ficam de fora do efeito de propósito — nada de `setState` síncrono
  // no corpo do efeito por um motivo que já é conhecido no MESMO render (`riskCountsEffective`
  // abaixo resolve isso via derivação, não via estado).
  useEffect(() => {
    if (loadingTeam || riskConfig?.enabled === false || available.length === 0) {
      // F5-06 (mutação sobrevivente): se as deps mudarem para este ramo (ex.: config chega
      // DEPOIS e desliga a guarda) enquanto uma busca anterior deixou `riskLoading=true`, o aviso
      // "Verificando frequência da semana..." ficaria preso na tela para sempre. Cosmético, mas
      // sem custo — sempre reseta.
      setRiskLoading(false);
      return;
    }
    let active = true;
    setRiskLoading(true);
    void (async () => {
      // Defesa em profundidade (mesmo raciocínio do efeito acima): o contrato do service já
      // devolve Map vazio em erro, mas nunca deixar uma rejeição inesperada prender o selo em
      // "carregando" para sempre — o disparo do chamado não pode depender disto (A7).
      const counts = await LinkRiskService.countForShift(
        job.id,
        available.map((member) => member.worker.id),
      ).catch(() => new Map<string, number>());
      if (!active) return;
      setRiskCounts(counts);
      setRiskLoading(false);
    })();
    return () => {
      active = false;
    };
    // `availableWorkerIdsKey` (não `available`) de propósito — ver comentário acima (F5-08).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingTeam, riskConfig, availableWorkerIdsKey, job.id]);

  const riskThreshold = riskConfig?.threshold ?? DEFAULT_LINK_RISK_THRESHOLD;
  const riskEnabled = riskConfig?.enabled !== false;
  // Deriva o valor efetivo em vez de sincronizar via `setState` no efeito acima: desligado ⇒
  // `null` (nenhum selo); elenco vazio ⇒ Map vazia (nada a mostrar, sem esperar rede); caso
  // contrário, o que o efeito buscou (ainda `null` enquanto `riskLoading`). `useMemo` evita criar
  // um `Map` novo a cada render (identidade estável para os `useMemo`/`useEffect` que dependem
  // deste valor).
  const riskCountsEffective = useMemo(() => {
    if (!riskEnabled) return null;
    if (available.length === 0) return new Map<string, number>();
    return riskCounts;
  }, [riskEnabled, available, riskCounts]);

  // R7 — fato, nunca conclusão jurídica: agrupa os SELECIONADOS cuja contagem prospectiva
  // (existente + este chamado) ultrapassa o limite, por N (podem ter Ns diferentes no mesmo
  // chamado). Só entra aqui quem está marcado — R6.1.
  const riskyByCount = useMemo(() => {
    if (!riskCountsEffective) return [];
    const groups = new Map<number, string[]>();
    selected.forEach((workerId) => {
      const member = members.find((m) => m.worker.id === workerId);
      if (!member) return;
      const prospective = (riskCountsEffective.get(workerId) ?? 0) + 1;
      if (prospective > riskThreshold) {
        const names = groups.get(prospective) ?? [];
        names.push(member.worker.full_name || 'Freela');
        groups.set(prospective, names);
      }
    });
    return Array.from(groups.entries())
      .map(([count, names]) => ({ count, names }))
      .sort((a, b) => a.count - b.count);
  }, [riskCountsEffective, riskThreshold, selected, members]);

  // R9/R10/R11: contagem e seleção do chip são calculadas contra `available` (já exclui
  // excludeWorkerIds), não contra o total de membros salvos na lista — filtra em silêncio
  // qualquer worker_id que saiu do elenco (status não mais 'accepted') ou que já está no turno.
  const availableWorkerIds = useMemo(() => new Set(available.map((m) => m.worker.id)), [available]);

  const listAvailability = useMemo(() => {
    const map = new Map<string, string[]>();
    lists.forEach((list) => {
      map.set(
        list.id,
        list.memberIds.filter((id) => availableWorkerIds.has(id)),
      );
    });
    return map;
  }, [lists, availableWorkerIds]);

  // F7: itera `ordered` (não `available`) — a ordenação por disponibilidade sobrevive ao filtro
  // de busca. Seleção, chips de lista, contagem (F5) e o próprio filtro de busca continuam sobre
  // `available`/`member.worker` como antes; só a ORDEM de exibição muda.
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return ordered;
    return ordered.filter((member) => {
      const name = (member.worker.full_name ?? '').toLowerCase();
      const role = (member.worker.primary_role ?? '').toLowerCase();
      return name.includes(term) || role.includes(term);
    });
  }, [ordered, search]);

  const slots = job.slots ?? 1;
  const allVisibleSelected = visible.length > 0 && visible.every((m) => selected.has(m.worker.id));

  const toggle = (workerId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) next.delete(workerId);
      else next.add(workerId);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((m) => next.delete(m.worker.id));
      else visible.forEach((m) => next.add(m.worker.id));
      return next;
    });
  };

  // R9: clique é UNIÃO com o que já estava selecionado — nunca substitui a seleção manual nem a
  // de outro chip. Se TODOS os disponíveis da lista já estão marcados, o clique os remove
  // (toggle liga/desliga); caso contrário, soma os que faltam.
  const toggleListChip = (listId: string) => {
    const availableIds = listAvailability.get(listId) ?? [];
    if (availableIds.length === 0) return;
    const allSelected = availableIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) availableIds.forEach((id) => next.delete(id));
      else availableIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleDispatch = async () => {
    if (selected.size === 0) return;
    setDispatching(true);

    const result = await ShiftCallService.createShiftCall(job.id, Array.from(selected), {
      reason,
      ...(expiryHours === null
        ? { expiresAt: calcExpiryAtShiftStart(job.start_date, job.work_start_time) }
        : { expiresInHours: expiryHours }),
    });

    setDispatching(false);

    if (result.error || !result.call) {
      addToast(result.error ?? 'Não foi possível abrir o chamado.', 'error');
      return;
    }

    addToast(
      result.invited > 1
        ? result.invited === 1
          ? 'Convite enviado. Você é avisado assim que ele responder.'
          : `Chamado enviado para ${result.invited} freelas. Quem aceitar primeiro fica com a vaga.`
        : 'Convite enviado.',
      'success',
    );
    onDispatched();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !dispatching) onClose();
      }}
    >
      <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-lg max-h-[92vh] flex flex-col">
        {/* Cabeçalho */}
        <div className="p-6 pb-4 border-b-2 border-black">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
              <Megaphone size={20} /> Chamar freelas
            </h2>
            <button
              onClick={onClose}
              disabled={dispatching}
              aria-label="Fechar"
              className="p-2 hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-50"
            >
              <X size={20} />
            </button>
          </div>
          <p className="text-sm font-bold text-gray-500">
            {job.title} · {slots === 1 ? '1 vaga' : `${slots} vagas`}
          </p>
        </div>

        {/* Corpo */}
        <div className="p-6 overflow-y-auto flex-1">
          {/* F8 — aviso ADVISORY (nunca trava, R11): o turno tem um requisito de certificação
              declarado pela empresa. Uma linha, sem filtrar/desabilitar ninguém na lista abaixo —
              a decisão de quem chamar continua inteiramente da empresa. */}
          {job.certification_requirement && (
            <div className="flex items-start gap-2 text-xs font-bold text-blue-800 bg-blue-50 border-2 border-blue-200 rounded-xl p-3 mb-4">
              <Award size={14} className="flex-shrink-0 mt-0.5" />
              <span>
                Este turno pede: {job.certification_requirement}. É só um aviso — não filtra nem
                impede a seleção de ninguém.
              </span>
            </div>
          )}

          {/* Motivo + janela */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            <div>
              <label htmlFor="call-reason" className="block text-xs font-black uppercase text-gray-500 mb-1">
                Motivo
              </label>
              <select
                id="call-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as ShiftCallReason)}
                disabled={dispatching}
                className="w-full border-2 border-black rounded-xl px-3 py-2 font-bold text-sm bg-white disabled:opacity-50"
              >
                {(Object.keys(SHIFT_CALL_REASON_LABELS) as ShiftCallReason[]).map((key) => (
                  <option key={key} value={key}>
                    {SHIFT_CALL_REASON_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="call-expiry" className="block text-xs font-black uppercase text-gray-500 mb-1">
                Expira em
              </label>
              <select
                id="call-expiry"
                value={expiryHours === null ? 'shift_start' : String(expiryHours)}
                onChange={(e) =>
                  setExpiryHours(e.target.value === 'shift_start' ? null : Number(e.target.value))
                }
                disabled={dispatching}
                className="w-full border-2 border-black rounded-xl px-3 py-2 font-bold text-sm bg-white disabled:opacity-50"
              >
                {CALL_EXPIRY_PRESETS.map((preset) => (
                  <option key={preset.value} value={String(preset.value)}>
                    {preset.label}
                  </option>
                ))}
                <option value="shift_start">Até o início do turno</option>
              </select>
            </div>
          </div>

          {/* Chips de listas salvas (F2) — só aparece se a empresa tem listas; zero listas = zero mudança visual */}
          {lists.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {lists.map((list) => {
                const availableIds = listAvailability.get(list.id) ?? [];
                const isEmpty = availableIds.length === 0;
                const isActive = !isEmpty && availableIds.every((id) => selected.has(id));
                return (
                  <button
                    key={list.id}
                    type="button"
                    onClick={isEmpty ? undefined : () => toggleListChip(list.id)}
                    disabled={dispatching || isEmpty}
                    aria-pressed={isActive}
                    className={`min-h-11 px-4 py-2.5 rounded-pill border-2 border-black font-black uppercase text-sm flex items-center transition-colors ${
                      isEmpty
                        ? 'opacity-40 cursor-not-allowed bg-gray-100 text-gray-400'
                        : isActive
                          ? 'bg-black text-white'
                          : 'bg-white hover:bg-gray-100'
                    }`}
                  >
                    {list.name} ({availableIds.length})
                  </button>
                );
              })}
            </div>
          )}

          {/* Busca + selecionar todos */}
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <label htmlFor="shift-call-search" className="sr-only">
                Buscar por nome ou função
              </label>
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="shift-call-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou função"
                disabled={dispatching}
                className="w-full border-2 border-gray-200 focus:border-black rounded-xl pl-9 pr-3 py-2 font-bold text-sm outline-none transition-colors disabled:opacity-50"
              />
            </div>
            <button
              type="button"
              onClick={toggleAllVisible}
              disabled={dispatching || visible.length === 0}
              className="px-3 py-2 rounded-xl border-2 border-black font-black uppercase text-xs hover:bg-gray-100 transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              {allVisibleSelected ? 'Limpar' : 'Todos'}
            </button>
          </div>

          {/* F5 — estado PRÓPRIO, nunca segura a lista abaixo (LM-10): só um aviso discreto de
              que os selos de frequência ainda estão chegando. */}
          {riskLoading && (
            <p className="text-[11px] font-bold text-gray-400 mb-2" aria-live="polite">
              Verificando frequência da semana...
            </p>
          )}

          {/* Lista do elenco */}
          {loadingTeam && (
            <div className="space-y-2 animate-pulse">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-14 bg-gray-200 rounded-xl" />
              ))}
            </div>
          )}

          {!loadingTeam && available.length === 0 && (
            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-2xl text-gray-400">
              <Users size={32} className="mx-auto mb-2 opacity-30" />
              <p className="font-bold text-sm">Ninguém disponível no elenco para este turno.</p>
              <p className="text-xs mt-1">
                Todos os seus freelas já estão neste turno ou já foram chamados.
              </p>
            </div>
          )}

          {!loadingTeam && available.length > 0 && visible.length === 0 && (
            <p className="text-center py-6 text-sm font-bold text-gray-400">
              Nenhum freela encontrado para "{search}".
            </p>
          )}

          {!loadingTeam &&
            visible.map((member) => {
              const isSelected = selected.has(member.worker.id);
              // F5 — selo é fato, não parecer jurídico (R7): só para quem está SELECIONADO e cuja
              // contagem prospectiva (existente + este chamado) ultrapassa o limite configurado.
              // Fica na linha do NOME de propósito — a linha do cargo é do contêiner de sinais da
              // F7 (disponibilidade declarada), construído logo abaixo.
              const prospectiveCount = riskCountsEffective
                ? (riskCountsEffective.get(member.worker.id) ?? 0) + 1
                : 0;
              const showRiskBadge =
                isSelected && riskCountsEffective !== null && prospectiveCount > riskThreshold;
              // F7: sinal na linha do CARGO (R10), nunca na do nome (reservada à F5). Contorno,
              // nunca fill (LM-10) — o card selecionado já pinta o fundo de `bg-primary-light`, e
              // um pill verde preenchido sumiria nele. Ausência de sinal (não declarou, ou
              // declarou outro período) não recebe NENHUMA marca — mesmo patamar visual, sem
              // penalização (A3/A4 do DDL).
              const showAvailabilityBadge = matchingAvailabilityIds.has(member.worker.id);
              return (
                <label
                  key={member.worker.id}
                  className={`flex items-center gap-3 p-3 mb-2 rounded-xl border-2 cursor-pointer transition-all ${
                    isSelected ? 'border-black bg-primary-light' : 'border-gray-100 hover:border-black'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(member.worker.id)}
                    disabled={dispatching}
                    className="w-5 h-5 accent-black flex-shrink-0"
                  />
                  <div className="w-9 h-9 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
                    {member.worker.avatar_url ? (
                      <img
                        src={member.worker.avatar_url}
                        alt={member.worker.full_name ?? ''}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs font-black text-gray-400">
                        {(member.worker.full_name ?? '?').charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="font-black text-sm truncate">{member.worker.full_name}</p>
                      {showRiskBadge && (
                        <span className="inline-flex items-center gap-1 flex-shrink-0 text-[10px] font-black uppercase text-yellow-700 bg-yellow-50 border border-yellow-300 rounded-pill px-2 py-0.5">
                          <AlertTriangle size={10} /> Já {prospectiveCount}x esta semana com você
                        </span>
                      )}
                    </div>
                    {(member.worker.primary_role || showAvailabilityBadge) && (
                      <div className="flex items-center gap-2 min-w-0">
                        {member.worker.primary_role && (
                          <p className="text-xs font-bold text-gray-500 truncate">
                            {member.worker.primary_role}
                          </p>
                        )}
                        {/* F7 — contêiner de sinais da linha secundária: vazio quando não há
                            selo, para a F8 (certificações) entrar como vizinho sem refazer o
                            layout das duas linhas (LM-10 do DDL). */}
                        <span className="inline-flex items-center gap-1 flex-shrink-0">
                          {showAvailabilityBadge && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-primary border border-primary rounded-pill px-2 py-0.5"
                              title="Disponível para este dia e período, segundo a grade que este freela declarou"
                              aria-label="Freela declarou disponibilidade para este turno"
                            >
                              <CalendarCheck2 size={10} /> Disponível
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
        </div>

        {/* Rodapé */}
        <div className="p-6 pt-4 border-t-2 border-black">
          {/* F5 — banner só se pelo menos 1 SELECIONADO está com aviso; fato + config +
              devolução da decisão, nunca conclusão jurídica (R7). Nunca desabilita o disparo
              (A7) — mesma área do aviso de vagas incompletas, os dois podem coexistir. */}
          {riskyByCount.length > 0 && (
            <div className="flex items-start gap-3 p-3 rounded-xl border-2 border-yellow-300 bg-yellow-50 mb-3">
              <AlertTriangle size={16} className="text-yellow-700 flex-shrink-0 mt-0.5" />
              <div className="text-xs font-bold text-yellow-800 space-y-1">
                {riskyByCount.map(({ count, names }) => (
                  <p key={count}>
                    Atenção: {names.join(', ')} já teria{names.length > 1 ? 'm' : ''} {count}ª vez
                    confirmada em turnos da sua empresa nesta semana (dom–sáb) com este chamado.
                  </p>
                ))}
                <p>
                  Sua empresa tolera até {riskThreshold}x/semana — este aviso aparece acima disso. A decisão de
                  chamar é sua — consulte seu contador/jurídico se tiver dúvida sobre frequência e
                  risco de vínculo.
                </p>
              </div>
            </div>
          )}
          {/* Aviso honesto: selecionar menos gente que o número de vagas não preenche o turno.
              É melhor dizer isso ANTES do disparo do que o gerente descobrir no dia. */}
          {selected.size > 0 && selected.size < slots && (
            <p className="flex items-start gap-2 text-xs font-bold text-yellow-700 bg-yellow-50 border border-yellow-300 rounded-xl p-2 mb-3">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              Você selecionou {selected.size} para {slots} vagas. Mesmo que todos aceitem, o turno
              ficará incompleto.
            </p>
          )}
          <button
            onClick={() => void handleDispatch()}
            disabled={selected.size === 0 || dispatching}
            className="w-full bg-black hover:bg-blue-600 text-white px-6 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {dispatching ? <Loader2 className="animate-spin" size={18} /> : <Megaphone size={18} />}
            {dispatching
              ? 'Enviando...'
              : selected.size === 0
                ? 'Selecione os freelas'
                : selected.size === 1
                  ? 'Enviar convite'
                  : selected.size === 1
                    ? 'Chamar 1 freela'
                    : `Chamar ${selected.size} freelas`}
          </button>
          {selected.size > 1 && (
            <p className="text-xs text-gray-500 text-center mt-2 font-bold">
              Todos recebem ao mesmo tempo. Quem aceitar primeiro fica com a vaga.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
