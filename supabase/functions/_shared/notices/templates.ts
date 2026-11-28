// Texto dos avisos. Conteudo MINIMO (ADR 7): empresa, dia/hora, cidade e link que so mostra.
// Nunca CPF, PIX, valor, endereco ou nome de terceiro: o payload do banco nem tem esses campos.

export type NoticeEventKind =
    | 'shift_call_target'
    | 'sos_call_target'
    | 'attendance_request'
    | 'shift_cancelled'
    | 'payment_recorded'
    | 'shift_accepted'
    | 'team_member_waiting';

export interface NoticePayload {
    company_name?: string | null;
    starts_at?: string | null;
    city?: string | null;
    path?: string | null;
}

export interface NoticeText {
    title: string;
    body: string;
    cta: string;
    path: string;
}

const TZ = 'America/Sao_Paulo';

export function safePath(path: unknown): string {
    return typeof path === 'string' && /^\/([A-Za-z0-9_-][A-Za-z0-9_/-]*)?$/.test(path) ? path : '/';
}

// Caracteres de controle (quebra de linha no assunto etc.) viram espaco.
const clean = (value: string | null | undefined, max: number) =>
    (value ?? '').replace(/\p{Cc}+/gu, ' ').trim().slice(0, max);

export function formatWhen(startsAt: string | null | undefined): { day: string; time: string } {
    const date = startsAt ? new Date(startsAt) : null;
    if (!date || Number.isNaN(date.getTime())) return { day: 'data a confirmar', time: '' };
    const day = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(date);
    const time = new Intl.DateTimeFormat('pt-BR', {
        timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(date);
    // 00:00 = turno sem horario cadastrado: nao inventa hora.
    return { day, time: time === '00:00' ? '' : time };
}

export function noticeText(kind: NoticeEventKind, payload: NoticePayload): NoticeText {
    const company = clean(payload.company_name, 80) || 'Uma empresa';
    const city = clean(payload.city, 60);
    const { day, time } = formatWhen(payload.starts_at);
    const when = `${day}${time ? ` às ${time}` : ''}`;
    const where = city ? ` (${city})` : '';
    const path = safePath(payload.path);
    switch (kind) {
        case 'shift_call_target':
            return {
                path, cta: 'Ver turno', title: 'Chamado de turno',
                body: `${company} chamou você para um turno em ${when}${where}. Abra o Workyn para responder.`,
            };
        case 'sos_call_target':
            return {
                path, cta: 'Ver turno', title: 'Turno urgente',
                body: `${company} precisa de alguém para um turno em ${when}${where}. Abra o Workyn para responder.`,
            };
        case 'attendance_request':
            return {
                path, cta: 'Responder', title: 'Confirme sua presença',
                body: `${company} pede a confirmação do seu turno em ${when}${where}. Abra o Workyn para responder.`,
            };
        case 'shift_cancelled':
            return path.startsWith('/company/')
                ? {
                    path, cta: 'Ver turno', title: 'Cancelamento em um turno',
                    body: `Houve um cancelamento no turno de ${when}. Abra o Workyn para ver.`,
                }
                : {
                    path, cta: 'Ver meus turnos', title: 'Turno cancelado',
                    body: `O turno de ${when} com ${company} foi cancelado. Abra o Workyn para ver.`,
                };
        case 'payment_recorded':
            return {
                path, cta: 'Ver recibo', title: 'Pagamento registrado',
                body: `${company} registrou o pagamento do turno de ${day}. Abra o Workyn para conferir o recibo.`,
            };
        case 'shift_accepted':
            return {
                path, cta: 'Ver turno', title: 'Vaga preenchida no turno',
                body: `Um freela confirmou presença no turno de ${when}${where}. Abra o Workyn para conferir.`,
            };
        case 'team_member_waiting':
            return {
                path, cta: 'Confirmar na Equipe', title: 'Confirme novo membro da equipe',
                body: `Uma pessoa convidada entrou em ${company} e aguarda sua confirmação para operar.`,
            };
    }
}

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderEmail(
    kind: NoticeEventKind, payload: NoticePayload,
    options: { appUrl: string; unsubscribePageUrl: string; senderAddress?: string },
): { subject: string; html: string; text: string } {
    const t = noticeText(kind, payload);
    const company = clean(payload.company_name, 80);
    const forCompany = t.path.startsWith('/company/');
    const subject = company && !forCompany ? `${t.title}: ${company}` : t.title;
    const link = `${options.appUrl.replace(/\/+$/, '')}${t.path}`;
    // Azul = empresa, verde = freela (design system).
    const accent = forCompany ? '#2563EB' : '#00A651';
    const address = options.senderAddress ? ` · ${options.senderAddress}` : '';
    const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#F4F4F0;font-family:Arial,Helvetica,sans-serif;color:#111111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto">
<tr><td style="background:#ffffff;border:2px solid #111111;border-radius:16px;box-shadow:6px 6px 0 0 #111111;padding:24px">
<p style="margin:0 0 16px;font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:1px">Workyn</p>
<h1 style="margin:0 0 12px;font-size:22px;font-weight:900;text-transform:uppercase">${escapeHtml(t.title)}</h1>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5">${escapeHtml(t.body)}</p>
<a href="${escapeHtml(link)}" style="display:inline-block;background:${accent};color:#ffffff;border:2px solid #111111;border-radius:12px;padding:12px 24px;font-size:14px;font-weight:900;text-transform:uppercase;text-decoration:none">${escapeHtml(t.cta)}</a>
</td></tr>
<tr><td style="padding:20px 4px 0;font-size:12px;line-height:1.6;color:#555555">
Você recebeu este e-mail por causa de um turno no Workyn${escapeHtml(address)}.<br>
<a href="${escapeHtml(options.unsubscribePageUrl)}" style="color:#555555">Não quero mais receber avisos por e-mail</a>
</td></tr></table></body></html>`;
    const text = `${t.title}\n\n${t.body}\n\n${t.cta}: ${link}\n\n` +
        `Não quero mais receber avisos por e-mail: ${options.unsubscribePageUrl}${address}`;
    return { subject, html, text };
}
