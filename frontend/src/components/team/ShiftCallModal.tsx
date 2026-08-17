import { useState, useEffect, useMemo } from 'react';
import { X, Loader2, Megaphone, Users, Search, AlertTriangle } from 'lucide-react';
import { TeamConnectionService } from '../../services/teamConnectionService';
import {
  ShiftCallService,
  CALL_EXPIRY_PRESETS,
  DEFAULT_CALL_EXPIRY_HOURS,
  calcExpiryAtShiftStart,
} from '../../services/shiftCallService';
import { useToast } from '../../contexts/ToastContext';
import { SHIFT_CALL_REASON_LABELS } from '../../types';
import type { TeamMember, ShiftCallReason, Job } from '../../types';

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
// ---------------------------------------------------------------------------

export interface ShiftCallModalProps {
  job: Pick<Job, 'id' | 'title' | 'start_date' | 'work_start_time'> & { slots?: number };
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
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState<ShiftCallReason>('falta');
  // `null` = "até o início do turno"; número = horas.
  const [expiryHours, setExpiryHours] = useState<number | null>(DEFAULT_CALL_EXPIRY_HOURS);
  const [dispatching, setDispatching] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoadingTeam(true);
      const list = await TeamConnectionService.listTeamMembers();
      if (!active) return;
      setMembers(list);
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

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return available;
    return available.filter((member) => {
      const name = (member.worker.full_name ?? '').toLowerCase();
      const role = (member.worker.primary_role ?? '').toLowerCase();
      return name.includes(term) || role.includes(term);
    });
  }, [available, search]);

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
        ? `Chamado enviado para ${result.invited} freelas. Quem aceitar primeiro fica com a vaga.`
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

          {/* Busca + selecionar todos */}
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
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
                    <p className="font-black text-sm truncate">{member.worker.full_name}</p>
                    {member.worker.primary_role && (
                      <p className="text-xs font-bold text-gray-500 truncate">
                        {member.worker.primary_role}
                      </p>
                    )}
                  </div>
                </label>
              );
            })}
        </div>

        {/* Rodapé */}
        <div className="p-6 pt-4 border-t-2 border-black">
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
