/**
 * GLOSSÁRIO ÚNICO do que aparece na tela: status (rótulo, tom e ícone) e funções de turno.
 * Nenhuma tela exibe enum cru ("cancelled"), slug ("garcom") nem inventa sinônimo.
 *
 * Uma palavra por estado (decidido aqui; não usar os sinônimos):
 *   Concluído           (não "Finalizado")             completed
 *   Cancelado           (não "Dispensado")             cancelled; a tela nem sempre sabe quem cancelou
 *   Recusado            (não "Recusou")                declined / rejected
 *   Expirado            (não "Expirou")                expired
 *   Contratado          (não "Confirmado", "Aceito")   hired
 *   Em andamento                                       in_progress ou presença registrada
 *   Aguardando resposta (não "Convidado")              invited
 *   Estornado                                          voided
 *
 * Vocabulário: Turno ("vaga" só para a posição: "1 de 2 vagas") · Freela (nunca "worker",
 * "candidato", "trabalhador") · Chamar (convidar para turno) · Registrar chegada / saída (não
 * "check-in") · Perguntar se vem (véspera) · Código do freela (não "ID do worker").
 *
 * Tom: neutral = encerrado sem problema (recusa é neutra, R6/R7) · info = agendado ou
 * informativo · warning = alguém precisa agir · success = resolvido · danger = falha ou bloqueio.
 */
import {
    AlertTriangle, Ban, CalendarClock, CheckCircle2, CircleDashed, Clock, MinusCircle,
    PauseCircle, PlayCircle, Send, type LucideIcon,
} from 'lucide-react';

export type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export interface StatusInfo {
    label: string;
    tone: StatusTone;
    icon: LucideIcon;
}

const s = (label: string, tone: StatusTone, icon: LucideIcon): StatusInfo => ({ label, tone, icon });

const CONCLUIDO = s('Concluído', 'success', CheckCircle2);
const CANCELADO = s('Cancelado', 'neutral', MinusCircle);
const RECUSADO = s('Recusado', 'neutral', MinusCircle);
const EXPIRADO = s('Expirado', 'neutral', Clock);
const AGUARDANDO = s('Aguardando resposta', 'info', Send);
const CONTRATADO = s('Contratado', 'success', CheckCircle2);
const EM_ANDAMENTO = s('Em andamento', 'info', PlayCircle);
const PENDENTE = s('Pendente', 'warning', Clock);

export const STATUS = {
    application: {
        invited: AGUARDANDO,
        pending: PENDENTE,
        interview: s('Em entrevista', 'info', Clock),
        approved: CONTRATADO,
        scheduled: CONTRATADO,
        accepted: CONTRATADO,
        hired: CONTRATADO,
        in_progress: EM_ANDAMENTO,
        checked_out: s('Saída confirmada', 'warning', Clock),
        completed: CONCLUIDO,
        declined: RECUSADO,
        rejected: RECUSADO,
        cancelled: CANCELADO,
        expired: EXPIRADO,
    },
    job: {
        open: s('Aberto', 'info', CircleDashed),
        paused: s('Pausado', 'neutral', PauseCircle),
        closed: s('Fechado', 'neutral', MinusCircle),
        in_progress: EM_ANDAMENTO,
        completed: CONCLUIDO,
        cancelled: CANCELADO,
        deleted: CANCELADO,
        unfilled: s('Sem freela', 'warning', AlertTriangle),
    },
    shiftCall: {
        open: AGUARDANDO,
        filled: s('Preenchido', 'success', CheckCircle2),
        expired: EXPIRADO,
        cancelled: CANCELADO,
        closed: s('Encerrado', 'neutral', MinusCircle),
    },
    payment: {
        pending: s('A pagar', 'warning', Clock),
        scheduled: s('Pagamento agendado', 'info', CalendarClock),
        recorded: s('Confirmar recebimento', 'warning', Clock),
        confirmed: s('Pago e confirmado', 'success', CheckCircle2),
        voided: s('Estornado', 'neutral', MinusCircle),
    },
    invite: {
        pending: AGUARDANDO,
        accepted: s('No Elenco', 'success', CheckCircle2),
        declined: RECUSADO,
        blocked: s('Bloqueado', 'danger', Ban),
        cancelled: CANCELADO,
        expired: EXPIRADO,
    },
    member: {
        invited: s('Convite enviado', 'info', Send),
        unconfirmed: s('Aguardando confirmação', 'warning', Clock),
        active: s('Ativo', 'success', CheckCircle2),
        removed: s('Removido', 'neutral', MinusCircle),
        expired: EXPIRADO,
    },
    certification: {
        declared: s('Declarada', 'neutral', CircleDashed),
        verified: s('Conferida', 'success', CheckCircle2),
        expiring: s('Vence em breve', 'warning', Clock),
        expired: s('Vencida', 'danger', AlertTriangle),
        revoked: s('Revogado', 'neutral', MinusCircle),
    },
    referral: {
        awaiting_worker: AGUARDANDO,
        accepted: s('Aceita', 'success', CheckCircle2),
        declined: s('Recusada', 'neutral', MinusCircle),
        cancelled: s('Cancelada', 'neutral', MinusCircle),
        expired: s('Expirada', 'neutral', Clock),
    },
} satisfies Record<string, Record<string, StatusInfo>>;

export type StatusDomain = keyof typeof STATUS;

/** Status desconhecido NUNCA vira texto cru na tela. */
export const UNKNOWN_STATUS: StatusInfo = s('Encerrado', 'neutral', MinusCircle);

export function getStatus(domain: StatusDomain, status: string | null | undefined): StatusInfo {
    const table: Record<string, StatusInfo> = STATUS[domain];
    return status && Object.prototype.hasOwnProperty.call(table, status) ? table[status] : UNKNOWN_STATUS;
}

export function statusLabel(domain: StatusDomain, status: string | null | undefined): string {
    return getStatus(domain, status).label;
}

/** Classes de superfície por tom (selo e aviso). Literais completos para o Tailwind enxergar. */
export const TONE_CLASS: Record<StatusTone, string> = {
    neutral: 'bg-status-neutral-bg text-status-neutral-fg border-status-neutral-line',
    info: 'bg-status-info-bg text-status-info-fg border-status-info-line',
    success: 'bg-status-success-bg text-status-success-fg border-status-success-line',
    warning: 'bg-status-warning-bg text-status-warning-fg border-status-warning-line',
    danger: 'bg-status-danger-bg text-status-danger-fg border-status-danger-line',
};

/** Slugs de função (`components/company/shiftCategories.ts`) para o rótulo curto com acento. */
const ROLE_LABELS: Record<string, string> = {
    garcom: 'Garçom',
    barista: 'Barista',
    barman: 'Barman',
    bartender: 'Bartender',
    cozinha: 'Cozinha',
    cozinheiro: 'Cozinheiro',
    auxiliar_cozinha: 'Auxiliar de cozinha',
    atendente: 'Atendente',
    caixa: 'Caixa',
    recepcao: 'Recepção',
    recepcionista: 'Recepcionista',
    limpeza: 'Limpeza',
    copeiro: 'Copeiro',
    cumim: 'Cumim',
    estoque: 'Estoque',
    seguranca: 'Segurança',
    promotor: 'Promotor',
    eventos: 'Eventos',
    outro: 'Outro',
};

/** Função como se lê na tela. Texto livre que não é slug conhecido volta como veio. */
export function roleLabel(value: string | null | undefined): string {
    const raw = (value ?? '').trim();
    if (!raw) return '';
    const key = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(ROLE_LABELS, key)) return ROLE_LABELS[key];
    if (!raw.includes('_')) return raw;
    const spaced = raw.replace(/_/g, ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
