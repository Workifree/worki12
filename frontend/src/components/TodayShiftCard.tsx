import { useEffect, useState, type ComponentProps } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Clock, LogIn, LogOut, MessageCircle, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { logError } from '../lib/logger';
import { formatBRL } from '../lib/currency';
import { attendanceGuardMessage, checkinWindow, checkinWindowMessage, saoPauloDay } from '../lib/checkinWindow';
import { openShiftConversation } from '../lib/shiftChat';
import { hasArrived, hasLeftShift, isOnShift, type PresenceStamps } from '../lib/shiftPresence';
import { Button, Card, IconButton, Menu, StatusBadge } from './ui';
import LocalDoTurno from './LocalDoTurno';
import { Dialog } from './ui/Dialog';
import { PresenceCheckFlow } from './presence/PresenceCheckFlow';
import { isPresencaEnabled } from '../lib/features';
import type { PresenceKind } from '../lib/presence';
import JobLifecycleStepper from './JobLifecycleStepper';

export interface TodayShift extends PresenceStamps {
    applicationId: string;
    status: string;
    title: string;
    companyName: string;
    startDate: string | null;
    startTime: string | null;
    endTime: string | null;
    location: string | null;
    pay: number | null;
    /** `jobs.presence_mode`; só vale com a flag de presença ligada. */
    presenceMode?: string | null;
}

interface TodayShiftCardProps {
    shift: TodayShift;
    heading: string;
    /** Recarrega os dados da tela depois de um registro. */
    onChanged: () => unknown;
    onCheckedOut?: () => void;
    /** Só aparece em turno contratado e ainda sem chegada. */
    onCancel?: () => void;
    /** Registro ou verificação em andamento: a tela segura a recarga ao vivo (chamado em par true/false). */
    onBusyChange?: (busy: boolean) => void;
    steps?: ComponentProps<typeof JobLifecycleStepper>['steps'];
}

/** Relógio que acorda a tela quando a janela de chegada abre ou fecha. */
function useNow(intervalMs = 30_000): Date {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}

export default function TodayShiftCard({ shift, heading, onChanged, onCheckedOut, onCancel, onBusyChange, steps }: TodayShiftCardProps) {
    const navigate = useNavigate();
    const { addToast } = useToast();
    const now = useNow();
    const [saving, setSaving] = useState(false);
    const [chatting, setChatting] = useState(false);
    const [verificando, setVerificando] = useState<PresenceKind | null>(null);
    const exigeQr = isPresencaEnabled() && shift.presenceMode === 'qr_gps';
    const busy = saving || verificando !== null;
    useEffect(() => {
        if (!busy) return;
        onBusyChange?.(true);
        return () => onBusyChange?.(false);
    }, [busy, onBusyChange]);

    const schedule = { startDate: shift.startDate, startTime: shift.startTime, endTime: shift.endTime };
    const window = checkinWindow(schedule, now);
    const arrived = hasArrived(shift);
    const left = hasLeftShift(shift);
    const onShift = isOnShift(shift);
    const startsToday = window.startDay === saoPauloDay(now);
    const hintId = `janela-${shift.applicationId}`;
    const hours = shift.startTime
        ? `${shift.startTime.slice(0, 5)}${shift.endTime ? `–${shift.endTime.slice(0, 5)}` : ''}`
        : 'Horário a definir';

    // `.select('id')` obrigatório: UPDATE negado pela RLS volta 0 linhas sem erro.
    const register = async (kind: 'chegada' | 'saida') => {
        setSaving(true);
        const failure = `Não foi possível registrar a ${kind === 'chegada' ? 'chegada' : 'saída'}. Atualize a página e tente novamente.`;
        try {
            const { data, error } = await supabase
                .from('applications')
                .update(
                    kind === 'chegada'
                        ? { worker_checkin_at: new Date().toISOString(), status: 'in_progress' }
                        : { worker_checkout_at: new Date().toISOString() },
                )
                .eq('id', shift.applicationId)
                .select('id');
            if (error) throw error;
            if (!data || data.length === 0) {
                addToast(failure, 'error');
                return;
            }
            addToast(kind === 'chegada' ? 'Chegada registrada!' : 'Saída registrada! A empresa confirma.', 'success');
            await onChanged();
            if (kind === 'saida') onCheckedOut?.();
        } catch (err) {
            logError(`TodayShiftCard.${kind}`, err);
            addToast(attendanceGuardMessage(err, schedule) ?? failure, 'error');
        } finally {
            setSaving(false);
        }
    };

    const presencaRegistrada = async () => {
        const saida = verificando === 'departure';
        // Na saída o cartão sai da lista ao recarregar: o aviso vai por toast.
        if (saida) {
            setVerificando(null);
            addToast('Saída registrada!', 'success');
        }
        await onChanged();
        if (saida) onCheckedOut?.();
    };

    const chat = async () => {
        setChatting(true);
        try {
            navigate(`/messages?conversation=${await openShiftConversation(shift.applicationId)}`);
        } catch (err) {
            logError('TodayShiftCard.chat', err);
            addToast('Erro ao iniciar conversa.', 'error');
        } finally {
            setChatting(false);
        }
    };

    // Situação da chegada numa linha (antes era uma caixa de aviso inteira).
    const chegada = shift.worker_checkin_at
        ? shift.company_checkin_confirmed_at
            ? { texto: 'Empresa confirmou chegada', cor: 'text-primary-ink', Icone: CheckCircle2 }
            : { texto: 'Aguardando confirmação da empresa', cor: 'text-status-warning-fg', Icone: Clock }
        : shift.company_checkin_confirmed_at
            ? { texto: 'Empresa registrou sua chegada', cor: 'text-status-info-fg', Icone: CheckCircle2 }
            : null;

    return (
        <Card as="article" padding="sm" className="flex flex-col gap-2">
            <div className="min-w-0">
                {/* Cabeçalho: rótulo + selos à esquerda; conversa e menu à direita (alvos de 44px). */}
                <div className="-mr-2 -mt-2 flex items-start justify-between gap-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pt-2.5">
                        <h2 className="text-sm font-semibold text-gray-600">{heading}</h2>
                        {/* "Ao vivo" já diz que é hoje. */}
                        {startsToday && !onShift && <StatusBadge tone="warning" icon={Clock}>É hoje</StatusBadge>}
                        {onShift ? (
                            <StatusBadge tone="success" icon={null}>Ao vivo</StatusBadge>
                        ) : (
                            <StatusBadge tone="info" icon={null}>Agendado</StatusBadge>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center">
                        <IconButton
                            aria-label="Falar com a empresa"
                            title="Falar com a empresa"
                            data-copilot="freela.turno.falar-empresa"
                            onClick={() => void chat()}
                            disabled={chatting}
                            aria-busy={chatting || undefined}
                        >
                            <MessageCircle size={20} />
                        </IconButton>
                        {onCancel && shift.status === 'hired' && !arrived && (
                            <Menu
                                label="Mais opções do turno"
                                items={[{
                                    label: 'Cancelar turno',
                                    icon: XCircle,
                                    danger: true,
                                    onSelect: onCancel,
                                    'data-copilot': 'freela.turnos.cancelar',
                                    'data-copilot-risk': 'D',
                                }]}
                            />
                        )}
                    </div>
                </div>
                <h3 className="text-base font-bold leading-snug line-clamp-2 [overflow-wrap:anywhere]">{shift.title}</h3>
                <p className="text-sm text-gray-700 truncate">{shift.companyName}</p>
                <p className="flex min-w-0 flex-wrap items-center gap-x-3 text-sm text-gray-700">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                        <Clock size={14} aria-hidden="true" /> {hours}
                    </span>
                    <span className="font-bold tabular-nums text-primary-ink">
                        {shift.pay && shift.pay > 0 ? formatBRL(shift.pay) : 'Valor não informado'}
                    </span>
                </p>
                <p className="flex min-w-0 items-center gap-1.5 text-sm text-gray-700 [overflow-wrap:anywhere]">
                    <LocalDoTurno location={shift.location} />
                </p>
            </div>

            {/* A linha do tempo completa só a partir de `sm`; no celular, a linha de situação e o botão dizem o passo. */}
            {steps && <div className="hidden sm:block"><JobLifecycleStepper steps={steps} /></div>}

            <div className="flex flex-col gap-2">
                {chegada && (
                    <p role="status" className={`flex items-center gap-1.5 text-sm font-semibold ${chegada.cor}`}>
                        <chegada.Icone size={16} aria-hidden="true" className="shrink-0" />
                        {chegada.texto}
                    </p>
                )}
                {!chegada && (
                    <div className="flex flex-col gap-1">
                        <Button
                            size="lg"
                            fullWidth
                            data-copilot="freela.turno.registrar-chegada"
                            data-copilot-risk="D"
                            onClick={() => (exigeQr ? setVerificando('arrival') : void register('chegada'))}
                            loading={saving}
                            disabled={window.state !== 'open'}
                            aria-describedby={hintId}
                            iconLeft={<LogIn size={18} />}
                        >
                            Registrar chegada
                        </Button>
                        <p id={hintId} className="text-xs text-gray-600">{checkinWindowMessage(window)}</p>
                    </div>
                )}

                {arrived && !left && (
                    <Button
                        size="lg"
                        fullWidth
                        data-copilot="freela.turno.registrar-saida"
                        data-copilot-risk="D"
                        onClick={() => (exigeQr ? setVerificando('departure') : void register('saida'))}
                        loading={saving}
                        iconLeft={<LogOut size={18} />}
                    >
                        Registrar saída
                    </Button>
                )}

                {onShift && (
                    <p className="text-xs text-gray-600">
                        Pagamento combinado direto com a empresa. O Worki registra o recibo.
                    </p>
                )}
            </div>

            {/* Um diálogo só: o leitor de QR usa id fixo no DOM. */}
            {exigeQr && verificando && (
                <Dialog labelledBy={`presenca-${shift.applicationId}`} onClose={() => setVerificando(null)} initialFocus="panel">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h2 id={`presenca-${shift.applicationId}`} className="text-lg font-bold">
                            Registrar {verificando === 'arrival' ? 'chegada' : 'saída'}
                        </h2>
                        <Button variant="ghost" onClick={() => setVerificando(null)}>Fechar</Button>
                    </div>
                    <PresenceCheckFlow
                        applicationId={shift.applicationId}
                        kind={verificando}
                        onRegistered={() => void presencaRegistrada()}
                    />
                </Dialog>
            )}
        </Card>
    );
}
