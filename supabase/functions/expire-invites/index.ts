/**
 * expire-invites — auto-expiração de convites de turno vencidos (item #6 do piloto).
 *
 * CONTEXTO (sem migration — restrição dura desta tarefa):
 *   `applications.status` tem CHECK (herdado do schema legado — não localizado como migration
 *   isolada neste repo, mas confirmado via `frontend/src/types/index.ts` `ApplicationStatus`)
 *   que permite: 'pending' | 'reviewing' | 'interview' | 'hired' | 'in_progress' | 'completed' |
 *   'rejected' | 'invited' | 'declined'. Não existe valor 'expired'.
 *
 *   `applications.invitation_response` tem CHECK explícito (migration
 *   20260622000100_invite_columns_applications.sql, linha 35):
 *     CHECK (invitation_response IS NULL OR invitation_response IN ('accepted', 'declined'))
 *   ou seja, 'expired' TAMBÉM violaria esse CHECK — não dá para usar
 *   invitation_response='expired' sem migration.
 *
 * DECISÃO (sem migration): usamos o valor 'declined' já permitido em `status` (semântica R7:
 * recusa é NEUTRA — zero punição — o mesmo vale para expiração, que também não deve punir o
 * freela). Para DISTINGUIR "expirado sem resposta" de "recusado ativamente pelo worker":
 *   - Expiração automática (esta função): status='declined', invitation_responded_at=now(),
 *     invitation_response permanece NULL (nunca setamos 'expired' ali — violaria o CHECK).
 *   - Recusa ativa (shiftInviteService.respondToInvite): status='declined',
 *     invitation_response='declined' (setado).
 *   Consumidores que precisarem diferenciar os dois casos podem checar
 *   `invitation_response IS NULL` (auto-expirado) vs `= 'declined'` (recusa ativa do worker).
 *
 * TODO (exigiria migration — gate architect, NÃO implementado aqui):
 *   Um valor de status dedicado (ex.: 'expired') tornaria essa distinção explícita no próprio
 *   `status` em vez de depender da combinação status+invitation_response. Deixado como TODO
 *   proposital — fora do escopo desta tarefa (regra dura: nenhuma migration nova).
 *
 * IDEMPOTÊNCIA: o UPDATE só afeta linhas com status='invited' AND invitation_expires_at < now().
 * Após a primeira execução, essas linhas passam a status='declined' e saem do filtro — rodar de
 * novo é seguro (não há duplo efeito, não mexe em saldo/escrow).
 *
 * OPS (fora do escopo desta tarefa):
 *   - Agendamento: pg_cron (`SELECT cron.schedule(...)`) ou Supabase Scheduled Functions,
 *     chamando este endpoint periodicamente (ex.: a cada 15-60 min).
 *   - Deploy: `supabase functions deploy expire-invites --no-verify-jwt` (chamada por scheduler,
 *     sem JWT de usuário — mesmo padrão de asaas-webhook/admin-data, Article 11). Alternativamente,
 *     se o scheduler suportar enviar o service_role key como Bearer, pode manter verify-jwt e
 *     autenticar como esta função já faz (compara Authorization com SUPABASE_SERVICE_ROLE_KEY).
 *   - Notificação ao worker/empresa sobre a expiração: não implementado aqui (best-effort futuro,
 *     mesmo padrão de `send-notification`).
 *
 * NÃO toca saldo/escrow/pagamento (Article 8). NÃO expõe service_role no frontend (Article 10) —
 * a key só existe aqui, dentro da Edge Function, via Deno.env.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/asaas.ts';

serve(async (req) => {
  const cors = getCorsHeaders(req);

  // CORS preflight (Article 11)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  // Auth: só service_role pode chamar (chamada por scheduler/ops, não pelo frontend).
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: 'Authorization header required' }),
      { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  const token = authHeader.replace('Bearer ', '');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!serviceRoleKey || token !== serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'Service role required' }),
      { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      serviceRoleKey,
    );

    const nowIso = new Date().toISOString();

    // Marca como 'declined' (neutro — R7) os convites vencidos que ainda estão 'invited'.
    // invitation_response permanece NULL de propósito — distingue expiração automática de
    // recusa ativa do worker (ver cabeçalho do arquivo).
    const { data: expired, error } = await supabaseAdmin
      .from('applications')
      .update({
        status: 'declined',
        invitation_responded_at: nowIso,
      })
      .eq('status', 'invited')
      .not('invitation_expires_at', 'is', null)
      .lt('invitation_expires_at', nowIso)
      .select('id, job_id, worker_id');

    if (error) {
      console.error('expire-invites: update failed', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const expiredCount = expired?.length ?? 0;
    console.log(`expire-invites: ${expiredCount} convite(s) expirado(s) marcados como 'declined'.`);

    return new Response(
      JSON.stringify({ success: true, expiredCount, expired: expired ?? [] }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('expire-invites: unexpected error', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
