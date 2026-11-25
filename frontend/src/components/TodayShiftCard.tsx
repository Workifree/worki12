import { useEffect, useState, type ComponentProps } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, LogIn, LogOut, MessageCircle, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { logError } from '../lib/logger';
import { formatBRL } from '../lib/currency';
import { attendanceGuardMessage, checkinWindow, checkinWindowMessage, saoPauloDay } from '../lib/checkinWindow';
import { openShiftConversation } from '../lib/shiftChat';
import { hasArrived, hasLeftShift, isOnShift, type PresenceStamps } from '../lib/shiftPresence';
import { Alert, Button, Card, StatusBadge } from './ui';
import LocalDoTurno from './LocalDoTurno';
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
}

interface TodayShiftCardProps {
    shift: TodayShift;
    heading: string;
    /** Recarrega os dados da tela depois de um registro. */
    onChanged: () => unknown;
    onCheckedOut?: () => void;
    /** Só aparece em turno contratado e ainda sem chegada. */
    onCancel?: () => void;
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

export default function TodayShiftCard({ shift, heading, onChanged, onCheckedOut, onCancel, steps }: TodayShiftCardProps) {
    const navigate = useNavigate();
    const { addToast } = useToast();
    const now = useNow();
    const [saving, setSaving] = useState(false);
    const [chatting, setChatting] = useState(false);

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

    return (
        <Card as="article" className="flex flex-col gap-4 shadow-brutal-brand">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-lg font-bold">{heading}</h2>
                    <div className="flex flex-wrap items-center gap-2">
                        {startsToday && <StatusBadge tone="warning" icon={Clock}>É hoje</StatusBadge>}
                        {onShift ? (
                            <StatusBadge tone="success" icon={null}>Ao vivo</StatusBadge>
                        ) : (
                            <StatusBadge tone="info" icon={null}>Agendado</StatusBadge>
                        )}
                    </div>
                </div>
                <h3 className="mt-3 text-base font-bold break-words [overflow-wrap:anywhere]">{shift.title}</h3>
                <p className="text-sm text-gray-700 break-words [overflow-wrap:anywhere]">{shift.companyName}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-700">
                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                        <Clock size={14} aria-hidden="true" /> {hours}
                    </span>
                    <span className="font-bold tabular-nums text-primary-dark">
                        {shift.pay && shift.pay > 0 ? formatBRL(shift.pay) : 'Valor não informado'}
                    </span>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-700 [overflow-wrap:anywhere]">
                    <LocalDoTurno location={shift.location} />
                </p>
            </div>

            {steps && <JobLifecycleStepper steps={steps} />}

            <div className="flex flex-col gap-3">
                {shift.worker_checkin_at ? (
                    <Alert tone={shift.company_checkin_confirmed_at ? 'success' : 'warning'}>
                        {shift.company_checkin_confirmed_at ? 'Empresa confirmou chegada' : 'Aguardando confirmação da empresa'}
                    </Alert>
                ) : shift.company_checkin_confirmed_at ? (
                    <Alert tone="info">Empresa registrou sua chegada</Alert>
                ) : (
                    <div className="flex flex-col gap-1.5">
                        <Button
                            size="lg"
                            fullWidth
                            data-copilot="freela.turno.registrar-chegada"
                            data-copilot-risk="D"
                            onClick={() => void register('chegada')}
                            loading={saving}
                            disabled={window.state !== 'open'}
                            aria-describedby={hintId}
                            iconLeft={<LogIn size={18} />}
                        >
                            Registrar chegada
                        </Button>
                        <p id={hintId} className="text-sm text-gray-600">{checkinWindowMessage(window)}</p>
                    </div>
                )}

                {arrived && !left && (
                    <Button
                        size="lg"
                        fullWidth
                        data-copilot="freela.turno.registrar-saida"
                        data-copilot-risk="D"
                        onClick={() => void register('saida')}
                        loading={saving}
                        iconLeft={<LogOut size={18} />}
                    >
                        Registrar saída
                    </Button>
                )}

                <Button
                    variant="secondary"
                    fullWidth
                    data-copilot="freela.turno.falar-empresa"
                    onClick={() => void chat()}
                    loading={chatting}
                    iconLeft={<MessageCircle size={18} />}
                >
                    Falar com a empresa
                </Button>

                {onCancel && shift.status === 'hired' && !arrived && (
                    <Button
                        variant="dangerOutline"
                        fullWidth
                        data-copilot="freela.turnos.cancelar"
                        data-copilot-risk="D"
                        onClick={onCancel}
                        iconLeft={<XCircle size={18} />}
                    >
                        Cancelar turno
                    </Button>
                )}

                {onShift && (
                    <p className="text-xs text-gray-600">
                        Pagamento combinado direto com a empresa. O Worki registra o recibo.
                    </p>
                )}
            </div>
        </Card>
    );
}
