import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { logError } from '../../../lib/logger';
import type { BonusAdminAdapter, TrackConfig } from './types';
import { formatDate, paramError, paramLabel, PARAM_BOUNDS } from './format';
import { useLoad } from './useLoad';

interface Props {
    adapter: BonusAdminAdapter;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Vetos({ adapter }: Props) {
    const fetcher = useCallback(() => adapter.getVetos(), [adapter]);
    const { data, loading, error, reload } = useLoad(fetcher, 'bonus: vetos');
    const [personId, setPersonId] = useState('');
    const [reason, setReason] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);

    const add = async (e: FormEvent) => {
        e.preventDefault();
        if (!UUID_RE.test(personId.trim())) { setMessage('Informe o ID da pessoa (formato UUID).'); return; }
        if (!reason.trim()) { setMessage('Informe o motivo.'); return; }
        setBusy(true);
        try {
            await adapter.addVeto(personId.trim(), reason.trim());
            setPersonId(''); setReason(''); setMessage('Pessoa adicionada à lista.');
            await reload();
        } catch (err) {
            logError('bonus: adicionar veto', err);
            setMessage(err instanceof Error ? err.message : 'Não foi possível adicionar.');
        }
        setBusy(false);
    };

    const remove = async (id: string) => {
        setBusy(true);
        try {
            await adapter.removeVeto(id);
            setMessage('Pessoa removida da lista.');
            await reload();
        } catch (err) {
            logError('bonus: remover veto', err);
            setMessage('Não foi possível remover.');
        }
        setBusy(false);
    };

    return (
        <section aria-labelledby="bonus-vetos" className="space-y-4">
            <h2 id="bonus-vetos" className="text-xl font-black uppercase">Lista de vetos</h2>
            <p className="text-sm text-gray-700">Sócios e donos do Worki. Turnos feitos por eles não entram na contagem do bônus.</p>
            <form onSubmit={add} className="bg-white border-2 border-black rounded-2xl p-4 sm:p-6 space-y-3">
                <div>
                    <label htmlFor="veto-person" className="block text-sm font-bold mb-1">ID da pessoa</label>
                    <input id="veto-person" value={personId} onChange={(e) => setPersonId(e.target.value)}
                        className="w-full border-2 border-black rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary" placeholder="00000000-0000-0000-0000-000000000000" />
                </div>
                <div>
                    <label htmlFor="veto-reason" className="block text-sm font-bold mb-1">Motivo</label>
                    <input id="veto-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)}
                        className="w-full border-2 border-black rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary" placeholder="Ex.: sócio do Worki" />
                    <p className="text-xs text-gray-600 mt-1">Não escreva dado pessoal (CPF, telefone, endereço) no motivo.</p>
                </div>
                <button type="submit" disabled={busy}
                    className="px-6 py-3 rounded-xl font-black uppercase bg-black text-white hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed">
                    Adicionar
                </button>
            </form>
            {message && <p role="status" className="text-sm font-bold bg-gray-100 border-2 border-black rounded-xl px-4 py-2">{message}</p>}
            {loading && <div className="h-20 bg-gray-200 rounded-xl animate-pulse" role="status"><span className="sr-only">Carregando</span></div>}
            {error && <p role="alert" className="font-bold text-red-700">{error}</p>}
            {(data ?? []).length === 0 && !loading && !error && <p className="text-sm font-bold">Lista vazia.</p>}
            <ul className="space-y-2">
                {(data ?? []).map((v) => (
                    <li key={v.personId} className="bg-white border-2 border-black rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <p className="font-bold truncate">{v.personName || v.personId}</p>
                            <p className="text-xs text-gray-600">{v.reason} · desde {formatDate(v.createdAt)}</p>
                        </div>
                        <button type="button" disabled={busy} onClick={() => remove(v.personId)}
                            aria-label={`Remover ${v.personName || v.personId} da lista de vetos`}
                            className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl border-2 border-black text-sm font-black uppercase hover:bg-gray-100 disabled:opacity-50">
                            Remover
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function TrackParams({ adapter, track, onSaved }: Props & { track: TrackConfig; onSaved: () => Promise<void> }) {
    const numeric = Object.entries(track.params).filter(([, v]) => typeof v === 'number') as [string, number][];
    const [draft, setDraft] = useState<Record<string, string>>(
        () => Object.fromEntries(numeric.map(([k, v]) => [k, String(v)])),
    );
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);

    const save = async (e: FormEvent) => {
        e.preventDefault();
        const changed: Record<string, number> = {};
        for (const [k, v] of numeric) {
            const n = draft[k]?.trim() ? Number(draft[k]) : Number.NaN;
            const problem = paramError(k, n);
            if (n !== v && problem) { setMessage(problem); return; }
            if (n !== v) changed[k] = n;
        }
        if (Object.keys(changed).length === 0) { setMessage('Nada mudou.'); return; }
        setBusy(true);
        try {
            await adapter.updateTrackParams(track.trackKey, changed);
            setMessage('Parâmetros salvos.');
            await onSaved();
        } catch (err) {
            logError('bonus: salvar parâmetros', err);
            setMessage(err instanceof Error ? err.message : 'Não foi possível salvar.');
        }
        setBusy(false);
    };

    const changeStatus = async (status: 'calibrating' | 'open' | 'closed') => {
        setBusy(true);
        try {
            await adapter.updateTrackStatus(track.trackKey, status);
            await onSaved();
        } catch (err) {
            logError('bonus: status da trilha', err);
            setMessage(err instanceof Error ? err.message : 'Não foi possível mudar o status.');
        }
        setBusy(false);
    };

    return (
        <form onSubmit={save} noValidate className="bg-white border-2 border-black rounded-2xl p-4 sm:p-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-black uppercase">{track.name}</h3>
                <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-bold">{track.status === 'open' ? 'Aberta' : track.status === 'closed' ? 'Encerrada' : 'Em calibração'}</span>
            </div>
            <div>
                <label htmlFor={`${track.trackKey}-status`} className="block text-sm font-bold mb-1">Status da trilha (muda na hora)</label>
                <select id={`${track.trackKey}-status`} value={track.status} disabled={busy}
                    onChange={(e) => {
                        const v = e.target.value;
                        if (v === 'calibrating' || v === 'open' || v === 'closed') void changeStatus(v);
                    }}
                    className="w-full sm:w-auto border-2 border-black rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary">
                    <option value="calibrating">Em calibração</option>
                    <option value="open">Aberta</option>
                    <option value="closed">Encerrada</option>
                </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {numeric.map(([k]) => (
                    <div key={k}>
                        <label htmlFor={`${track.trackKey}-${k}`} className="block text-sm font-bold mb-1">{paramLabel(k)}</label>
                        <input id={`${track.trackKey}-${k}`} type="number" min={PARAM_BOUNDS[k]?.[0] ?? 0} max={PARAM_BOUNDS[k]?.[1]} step={1} inputMode="numeric" value={draft[k] ?? ''}
                            onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                            className="w-full border-2 border-black rounded-xl px-4 py-3 tabular-nums focus:ring-2 focus:ring-primary" />
                        {PARAM_BOUNDS[k] && <p className="text-xs text-gray-600 mt-1">De {PARAM_BOUNDS[k][0]} a {PARAM_BOUNDS[k][1]}</p>}
                    </div>
                ))}
            </div>
            {message && <p role="status" className="text-sm font-bold">{message}</p>}
            <button type="submit" disabled={busy}
                className="px-6 py-3 rounded-xl font-black uppercase bg-black text-white hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed">
                Salvar parâmetros
            </button>
        </form>
    );
}

function History({ adapter }: Props) {
    const fetcher = useCallback(() => adapter.getParamsHistory(), [adapter]);
    const { data, loading, error } = useLoad(fetcher, 'bonus: histórico de parâmetros');
    return (
        <div>
            <h3 className="text-lg font-black uppercase mb-2">Quem mudou</h3>
            {loading && <div className="h-16 bg-gray-200 rounded-xl animate-pulse" role="status"><span className="sr-only">Carregando</span></div>}
            {error && <p role="alert" className="font-bold text-red-700">{error}</p>}
            {data && data.length === 0 && <p className="text-sm font-bold">Nenhuma mudança registrada.</p>}
            <ul className="space-y-2">
                {(data ?? []).map((h) => (
                    <li key={h.id} className="bg-white border-2 border-black rounded-xl px-4 py-3 text-sm break-words">
                        <p className="font-bold">{formatDate(h.at)} · {h.actorLabel}</p>
                        <p className="text-gray-700">{h.summary}</p>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function Params({ adapter }: Props) {
    const fetcher = useCallback(() => adapter.getTracks(), [adapter]);
    const { data, loading, error, reload } = useLoad(fetcher, 'bonus: parâmetros');
    const [version, setVersion] = useState(0);
    return (
        <section aria-labelledby="bonus-params" className="space-y-4">
            <h2 id="bonus-params" className="text-xl font-black uppercase">Parâmetros de antifraude</h2>
            <p className="text-sm text-gray-700">Limiares por trilha. Nunca aparecem para o operador.</p>
            {loading && <div className="h-32 bg-gray-200 rounded-xl animate-pulse" role="status"><span className="sr-only">Carregando</span></div>}
            {error && <p role="alert" className="font-bold text-red-700">{error}</p>}
            {(data ?? []).map((t) => <TrackParams key={`${t.trackKey}-${t.status}-${JSON.stringify(t.params)}`} adapter={adapter} track={t} onSaved={async () => { await reload(); setVersion((v) => v + 1); }} />)}
            <History key={version} adapter={adapter} />
        </section>
    );
}

export default function VetosAndParams({ adapter }: Props) {
    return (
        <div className="space-y-10">
            <Vetos adapter={adapter} />
            <Params adapter={adapter} />
        </div>
    );
}
