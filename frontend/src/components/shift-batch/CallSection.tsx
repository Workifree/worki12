import { useState } from 'react';
import { SHIFT_CALL_REASON_LABELS, type ShiftCallReason, type TeamMember } from '../../types';
import { CALL_EXPIRY_PRESETS, DEFAULT_CALL_EXPIRY_HOURS } from '../../services/shiftCallService';
import { isWorkerAvailableFor, periodForTime } from '../../lib/availability';
import { MISSING_WORKERS_MESSAGE, plural, weekdayOf, type ShiftDraftCall, type ShiftDraftRow } from '../../lib/shiftDrafts';
import { roleLabel } from '../../lib/statusLabels';
import { BusyWorkerBadge } from '../team/BusyWorkerBadge';
import { Alert, Button, ButtonLink, ChoiceCard, Field, SkeletonList } from '../ui';
import { Dialog } from '../ui/Dialog';
import { DialogActions, DialogHeader } from '../ui';
import type { CallData } from './useCallData';

const isAvailable = (member: TeamMember, rows: ShiftDraftRow[]) =>
    rows.some((r) => isWorkerAvailableFor(member.worker.availability_days, weekdayOf(r.date), periodForTime(r.start_time)));

/** Escolha de pessoas do elenco. `rows` são os turnos a que a escolha se aplica. */
export function PeopleDialog({
    title, members, rows, selected, suggestedIds, busyIds, onSave, onClose,
}: {
    title: string;
    members: TeamMember[];
    rows: ShiftDraftRow[];
    selected: string[];
    /** Chamados da vez passada (copiar semana): aparecem primeiro, DESMARCADOS. */
    suggestedIds: ReadonlySet<string>;
    busyIds: ReadonlySet<string>;
    onSave: (ids: string[]) => void;
    onClose: () => void;
}) {
    const [chosen, setChosen] = useState(() => new Set(selected));
    const [search, setSearch] = useState('');
    const rank = (m: TeamMember) => (suggestedIds.has(m.worker.id) ? 2 : 0) + (isAvailable(m, rows) ? 1 : 0);
    const term = search.trim().toLowerCase();
    const visible = members
        .filter((m) => !term || `${m.worker.full_name} ${roleLabel(m.worker.primary_role ?? '')}`.toLowerCase().includes(term))
        .sort((a, b) => rank(b) - rank(a));
    const toggle = (id: string) => setChosen((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
    });

    return (
        <Dialog labelledBy="lote-pessoas" onClose={onClose}>
            <DialogHeader titleId="lote-pessoas" title={title} onClose={onClose} />
            <Field label="Buscar no elenco">
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
            </Field>
            <ul className="mt-3 flex flex-col gap-2">
                {visible.map((m) => (
                    <li key={m.worker.id}>
                        <ChoiceCard pressed={chosen.has(m.worker.id)} onClick={() => toggle(m.worker.id)} data-copilot="empresa.turno-lote.pessoa">
                            <span className="block truncate">{m.worker.full_name}</span>
                            <span className="flex flex-wrap items-center gap-1 text-xs font-normal text-gray-600">
                                {m.worker.primary_role && <span>{roleLabel(m.worker.primary_role)}</span>}
                                {suggestedIds.has(m.worker.id) && <span className="font-bold">· chamado da vez passada</span>}
                                {isAvailable(m, rows) && <span className="font-bold text-primary-dark">· costuma estar disponível</span>}
                                {busyIds.has(m.worker.id) && <BusyWorkerBadge />}
                            </span>
                        </ChoiceCard>
                    </li>
                ))}
            </ul>
            {visible.length === 0 && <p className="mt-3 text-sm text-gray-600">Ninguém encontrado.</p>}
            <DialogActions>
                <Button variant="secondary" onClick={onClose} data-copilot="empresa.turno-lote.pessoas-voltar">Voltar</Button>
                <Button variant="dark" onClick={() => onSave([...chosen])} data-copilot="empresa.turno-lote.pessoas-salvar">
                    Escolher {chosen.size > 0 ? `(${chosen.size})` : ''}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

/**
 * "Quem vai trabalhar": lista do elenco e/ou pessoas. Obrigatório para publicar (exceto elenco vazio).
 * Os chamados saem logo depois de os turnos serem criados, no mesmo passo.
 */
export function CallSection({
    call, onChange, data, onPickPeople, suggestedCount, chosenCount, title = 'Quem vai trabalhar', showMissing = false,
}: {
    call: ShiftDraftCall;
    onChange: (call: ShiftDraftCall) => void;
    data: CallData;
    onPickPeople: () => void;
    suggestedCount: number;
    /** Pessoas que serão chamadas (já resolvidas contra o elenco). */
    chosenCount: number;
    title?: string;
    /** Mostra a pendência quando a pessoa já tentou seguir sem escolher. */
    showMissing?: boolean;
}) {
    const peopleCount = call.worker_ids?.length ?? 0;
    const toggleList = (listId: string) => {
        if (call.mode === 'list' && call.list_id === listId) {
            onChange({ ...call, mode: peopleCount ? 'workers' : 'none', list_id: undefined });
        } else {
            onChange({ ...call, mode: 'list', list_id: listId });
        }
    };
    return (
        <section aria-labelledby="lote-chamar" className="flex flex-col gap-2" data-copilot="empresa.turno-lote.quem-trabalha">
            <h2 id="lote-chamar" className="text-lg font-bold">{title}</h2>
            {data.loading && <SkeletonList count={2} itemClassName="h-11" />}
            {!data.loading && data.error && (
                <Alert tone="warning" action={<Button variant="secondary" onClick={data.retry}>Tentar de novo</Button>}>
                    Não conseguimos carregar o seu elenco. Dá para publicar agora e chamar depois.
                </Alert>
            )}
            {!data.loading && !data.error && data.members.length === 0 && (
                <Alert tone="info" action={<ButtonLink variant="secondary" to="/company/team">Ir para Meu Elenco</ButtonLink>}>
                    Seu elenco está vazio: o turno fica aberto. Traga freelas em Elenco.
                </Alert>
            )}
            {!data.loading && data.members.length > 0 && (
                <>
                    <p className="text-sm text-gray-600">Escolha uma lista e/ou pessoas do elenco. Elas são chamadas assim que o turno for publicado.</p>
                    {data.lists.map((list) => (
                        <ChoiceCard
                            key={list.id}
                            pressed={call.mode === 'list' && call.list_id === list.id}
                            onClick={() => toggleList(list.id)}
                            data-copilot="empresa.turno-lote.lista"
                        >
                            Lista: {list.name}
                        </ChoiceCard>
                    ))}
                    <ChoiceCard
                        pressed={peopleCount > 0}
                        onClick={onPickPeople}
                        data-copilot="empresa.turno-lote.chamar-pessoas"
                    >
                        Escolher pessoas
                        {peopleCount > 0 && ` · ${plural(peopleCount, 'escolhida', 'escolhidas')}`}
                    </ChoiceCard>
                    <p role="status" className="text-sm font-bold">
                        {chosenCount > 0 ? plural(chosenCount, 'pessoa escolhida', 'pessoas escolhidas') : 'Ninguém escolhido ainda.'}
                    </p>
                    {showMissing && chosenCount === 0 && <Alert tone="danger" role="alert">{MISSING_WORKERS_MESSAGE}</Alert>}
                    {suggestedCount > 0 && (
                        <p className="text-xs text-gray-600">
                            {plural(suggestedCount, 'pessoa foi chamada', 'pessoas foram chamadas')} nestes turnos da vez passada. Elas aparecem primeiro, desmarcadas.
                        </p>
                    )}
                    {call.mode !== 'none' && (
                        <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
                            <Field label="Motivo">
                                <select value={call.reason ?? 'outro'} onChange={(e) => onChange({ ...call, reason: e.target.value as ShiftCallReason })}>
                                    {Object.entries(SHIFT_CALL_REASON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                </select>
                            </Field>
                            <Field label="Prazo para responder">
                                <select
                                    value={(call.expires_minutes ?? DEFAULT_CALL_EXPIRY_HOURS * 60) / 60}
                                    onChange={(e) => onChange({ ...call, expires_minutes: Number(e.target.value) * 60 })}
                                >
                                    {CALL_EXPIRY_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                                </select>
                            </Field>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
