/**
 * asaas-release-hold — Libera o hold no Asaas (cancelamento / no-show antes da captura).
 *
 * Fluxo postpago (Slice 2 / ADR-20260622-pagamento-postpago):
 *  Chamado pela empresa para cancelar o turno ou registrar no-show ANTES da conclusão.
 *  Marca o escrow como 'refunded' no DB (RPC release_hold_postpago) e deleta/libera
 *  o hold no Asaas (DELETE /v3/payments/{id}).
 *
 * Idempotência:
 *  - release_hold_postpago usa WHERE status='authorized' → não estorna hold já capturado.
 *  - Se o escrow já está 'refunded', retorna success sem reprocessar.
 *
 * Deploy normal (com verify-jwt) — caller é a EMPRESA.
 * Article 10: service_role apenas no Deno.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders, ASAAS_API_URL, getAsaasHeaders } from '../_shared/asaas.ts';
import { isRateLimited } from '../_shared/rate-limit.ts';

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // --- Auth (caller = empresa) ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) throw new Error('Invalid Token');

    if (isRateLimited(user.id, 'release-hold', 5, 60_000)) {
      return new Response(
        JSON.stringify({ error: 'Muitas tentativas. Aguarde 1 minuto.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
      );
    }

    const { jobId, reason } = await req.json();
    if (!jobId) throw new Error('jobId é obrigatório.');

    // --- Verificar que o caller é dono do job ---
    const { data: job, error: jobErr } = await supabaseAdmin
      .from('jobs')
      .select('company_id')
      .eq('id', jobId)
      .maybeSingle();

    if (jobErr || !job) throw new Error('Vaga não encontrada.');
    if (job.company_id !== user.id) throw new Error('Não autorizado: você não é o dono desta vaga.');

    // --- Verificar estado atual do escrow (idempotência: já refunded = success) ---
    const { data: escrow } = await supabaseAdmin
      .from('escrow_transactions')
      .select('id, status, asaas_payment_id')
      .eq('job_id', jobId)
      .eq('kind', 'postpaid')
      .maybeSingle();

    // Sem escrow postpago para este job (job pode ser prepago ou sem hold)
    if (!escrow) {
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'Nenhum escrow postpago encontrado.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Já liberado — idempotente
    if (escrow.status === 'refunded') {
      return new Response(
        JSON.stringify({ success: true, idempotent: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Já capturado — não permitir liberar
    if (escrow.status === 'released' || escrow.status === 'captured') {
      throw new Error(
        'O pagamento já foi capturado e não pode ser estornado por esta operação. ' +
        'Utilize o processo de reembolso adequado.'
      );
    }

    if (escrow.status !== 'authorized') {
      throw new Error(`Estado de escrow inesperado para liberação: '${escrow.status}'.`);
    }

    // --- RPC: marcar 'refunded' no DB e obter asaas_payment_id ---
    const releaseReason = reason || 'Hold liberado (cancelamento/no-show)';
    const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc(
      'release_hold_postpago',
      {
        p_job_id: jobId,
        p_reason: releaseReason,
      }
    );

    if (rpcErr) {
      // Se a RPC falhou porque não há hold authorized (race condition — outro processo liberou antes)
      if (rpcErr.message?.includes('Nenhum hold autorizado')) {
        return new Response(
          JSON.stringify({ success: true, idempotent: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }
      throw new Error(rpcErr.message || 'Erro ao liberar escrow no banco de dados.');
    }

    // A RPC retorna TABLE(escrow_id, asaas_payment_id) — supabase-js retorna array
    const row = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    const asaasPaymentId: string | null = row?.asaas_payment_id ?? escrow.asaas_payment_id ?? null;

    // --- Liberar/deletar o hold no Asaas ---
    if (asaasPaymentId) {
      const deleteRes = await fetch(`${ASAAS_API_URL}/payments/${asaasPaymentId}`, {
        method: 'DELETE',
        headers: getAsaasHeaders(),
      });

      if (!deleteRes.ok) {
        const deleteData = await deleteRes.json().catch(() => ({}));
        const errMsg: string =
          deleteData.errors?.[0]?.description ||
          deleteData.error ||
          `HTTP ${deleteRes.status}`;

        // Hold já expirado no Asaas ou já deletado — não é erro crítico (DB já está correto)
        const isAlreadyGone =
          deleteRes.status === 404 ||
          errMsg.toLowerCase().includes('not found') ||
          errMsg.toLowerCase().includes('já cancelad');

        if (isAlreadyGone) {
          console.warn(
            `[release-hold] Hold já removido no Asaas (${errMsg}) — DB marcado como refunded. OK.`
          );
        } else {
          // Logar mas não lançar: o DB está correto (refunded), o hold será expirado naturalmente
          console.error(
            `[release-hold] Falha ao deletar hold no Asaas: ${errMsg}. ` +
            `payment=${asaasPaymentId}. DB correto — hold expirará em 3 dias.`
          );
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Erro interno.';
    console.error('asaas-release-hold error:', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
