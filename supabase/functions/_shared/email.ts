// Shared email utility using Resend API
// Set RESEND_API_KEY in Supabase secrets

const RESEND_API_URL = 'https://api.resend.com/emails';
const FROM_EMAIL = 'Worki <noreply@worki.com.br>';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://worki.com.br';

interface EmailPayload {
    to: string;
    subject: string;
    html: string;
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) {
        console.warn('RESEND_API_KEY not set, skipping email send');
        return false;
    }

    try {
        const res = await fetch(RESEND_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: FROM_EMAIL,
                to: payload.to,
                subject: payload.subject,
                html: payload.html,
            }),
        });

        if (!res.ok) {
            const err = await res.text();
            console.error('Email send failed:', err);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Email send error:', error);
        return false;
    }
}

// HTML escaping to prevent XSS in email clients
export function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Email templates

export function hiredEmail(workerName: string, jobTitle: string, companyName: string): EmailPayload {
    const w = escapeHtml(workerName);
    const j = escapeHtml(jobTitle);
    const c = escapeHtml(companyName);
    return {
        to: '', // filled by caller
        subject: `Turno confirmado! - ${j}`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
                <h1 style="color:#00A651">Parabens, ${w}!</h1>
                <p>Voce foi confirmado para o turno <strong>${j}</strong> da empresa <strong>${c}</strong>.</p>
                <p>Acesse a plataforma para ver os detalhes e iniciar o check-in no dia do turno.</p>
                <a href="${APP_URL}/my-jobs" style="display:inline-block;background:#00A651;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px">Ver Meus Turnos</a>
                <p style="color:#999;margin-top:24px;font-size:12px">Worki - Sua operação de freelas</p>
            </div>
        `,
    };
}

export function paymentReceivedEmail(workerName: string, amount: string, jobTitle: string): EmailPayload {
    const w = escapeHtml(workerName);
    const a = escapeHtml(amount);
    const j = escapeHtml(jobTitle);
    return {
        to: '',
        subject: `Pagamento recebido: R$ ${a}`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
                <h1 style="color:#00A651">Pagamento Recebido!</h1>
                <p>Ola ${w}, voce recebeu <strong>R$ ${a}</strong> pelo turno <strong>${j}</strong>.</p>
                <a href="${APP_URL}/recebimentos" style="display:inline-block;background:#00A651;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px">Ver Meus Recebimentos</a>
                <p style="color:#999;margin-top:24px;font-size:12px">Worki - Sua operação de freelas</p>
            </div>
        `,
    };
}

export function depositConfirmedEmail(companyName: string, amount: string): EmailPayload {
    const c = escapeHtml(companyName);
    const a = escapeHtml(amount);
    return {
        to: '',
        subject: `Deposito confirmado: R$ ${a}`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
                <h1 style="color:#2563EB">Deposito Confirmado!</h1>
                <p>Ola ${c}, seu deposito de <strong>R$ ${a}</strong> foi confirmado.</p>
                <p style="color:#999;margin-top:24px;font-size:12px">Worki - Sua operação de freelas</p>
            </div>
        `,
    };
}

export function newApplicationEmail(companyName: string, workerName: string, jobTitle: string): EmailPayload {
    const c = escapeHtml(companyName);
    const w = escapeHtml(workerName);
    const j = escapeHtml(jobTitle);
    return {
        to: '',
        subject: `${w} aceitou seu convite: ${j}`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
                <h1 style="color:#2563EB">Convite aceito!</h1>
                <p>Ola ${c}, <strong>${w}</strong> aceitou o convite para o turno <strong>${j}</strong>.</p>
                <p>Acesse a plataforma para ver os detalhes do turno.</p>
                <a href="${APP_URL}/company/jobs" style="display:inline-block;background:#2563EB;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px">Ver Turnos</a>
                <p style="color:#999;margin-top:24px;font-size:12px">Worki - Sua operação de freelas</p>
            </div>
        `,
    };
}
