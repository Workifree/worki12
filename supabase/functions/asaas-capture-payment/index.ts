/**
 * asaas-capture-payment — Captura o hold no Asaas e credita o worker na conclusão do turno.
 *
 * Fluxo postpago (Slice 2 / ADR-20260622-pagamento-postpago):
 *  Chamado pela empresa na conclusão do turno (espelha asaas-checkout para kind='postpaid').
 *  Também pode ser disparado por auto-processamento (cron — R9) após janela de carência.
 *
 *  Dois caminhos:
 *  A) Tem hold ativo (status='authorized'/'postpaid'):
 *     → captureAuthorizedPayment no Asaas → capture_escrow_postpago (credita worker).
 *  B) Sem hold (charge_on_demand / hold expirado):
 *     → charge direta com o token default da empresa → authorize_escrow_postpago + capture_escrow_postpago.
 *     (fallback — sem ADR adicional, mesmo gateway Asaas, Article 6 intacto.)
 *
 * Idempotência:
 *  - capture_escrow_postpago usa WHERE status='authorized' → double-capture não duplica crédito.
 *  - UNIQUE (wallet_id, reference_id) em wallet_transactions → idempotência do crédito.
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

    if (isRateLimited(user.id, 'capture-payment', 5, 60_000)) {
      return new Response(
        JSON.stringify({ error: 'Muitas tentativas. Aguarde 1 minuto.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
      );
    }

    const { jobId, workerId } = await req.json();
    if (!jobId || !workerId) throw new Error('jobId e workerId são obrigatórios.');

    // --- Verificar que o caller é dono do job ---
    const { data: job, error: jobErr } = await supabaseAdmin
      .from('jobs')
      .select('company_id, budget, title')
      .eq('id', jobId)
      .maybeSingle();

    if (jobErr || !job) throw new Error('Vaga não encontrada.');
    if (job.company_id !== user.id) throw new Error('Não autorizado: você não é o dono desta vaga.');

    // --- Verificar application concluída ou checkout confirmado ---
    const { data: app, error: appErr } = await supabaseAdmin
      .from('applications')
      .select('worker_id, status, company_checkout_confirmed_at')
      .eq('job_id', jobId)
      .eq('worker_id', workerId)
      .in('status', ['in_progress', 'completed'])
      .maybeSingle();

    if (appErr || !app) {
      throw new Error('Candidatura não encontrada ou trabalho ainda não foi iniciado.');
    }
    if (app.status !== 'completed' && !app.company_checkout_confirmed_at) {
      throw new Error('O trabalho precisa estar concluído antes de liberar o pagamento.');
    }

    // --- Get-or-create carteira do worker ---
    let workerWalletId: string;
    const { data: workerWallet } = await supabaseAdmin
      .from('wallets')
      .select('id')
      .eq('user_id', workerId)
      .maybeSingle();

    if (workerWallet) {
      workerWalletId = workerWallet.id;
    } else {
      const { data: newWallet, error: createErr } = await supabaseAdmin
        .from('wallets')
        .insert({ user_id: workerId, balance: 0, user_type: 'worker' })
        .select('id')
        .single();
      if (createErr || !newWallet) throw new Error('Falha ao criar carteira do worker.');
      workerWalletId = newWallet.id;
    }

    // --- Buscar escrow postpago 'authorized' ---
    const { data: escrow } = await supabaseAdmin
      .from('escrow_transactions')
      .select('id, asaas_payment_id, amount, status, captured_at')
      .eq('job_id', jobId)
      .eq('kind', 'postpaid')
      .maybeSingle();

    // --- Caminho A: tem hold ativo → capturar ---
    if (escrow && escrow.status === 'authorized' && escrow.asaas_payment_id) {
      const asaasPaymentId: string = escrow.asaas_payment_id;

      // captureAuthorizedPayment no Asaas
      const captureRes = await fetch(
        `${ASAAS_API_URL}/payments/${asaasPaymentId}/captureAuthorizedPayment`,
        {
          method: 'POST',
          headers: getAsaasHeaders(),
          body: JSON.stringify({}),
        }
      );
      const captureData = await captureRes.json();

      // Tratar hold expirado (fallback charge_on_demand)
      const isHoldExpired =
        !captureRes.ok &&
        (captureData.errors?.[0]?.description?.toLowerCase().includes('expir') ||
          captureData.errors?.[0]?.code === 'invalid_action' ||
          captureRes.status === 400);

      if (isHoldExpired) {
        console.warn(
          `[capture-payment] Hold expirado (job=${jobId}), executando charge_on_demand.`
        );
        return await chargeOnDemand(
          supabaseAdmin,
          jobId,
          app.worker_id ?? workerId,
          workerWalletId,
          job.company_id,
          job.budget,
          job.title,
          req,
          corsHeaders
        );
      }

      if (!captureRes.ok) {
        throw new Error(
          captureData.errors?.[0]?.description ||
          captureData.error ||
          'Erro ao capturar cobrança no Asaas.'
        );
      }

      // RPC atômica: marca released + credita worker (idempotente por (wallet_id, reference_id))
      const { error: rpcErr } = await supabaseAdmin.rpc('capture_escrow_postpago', {
        p_job_id: jobId,
        p_worker_wallet_id: workerWalletId,
      });

      if (rpcErr) {
        // Erro após captura no Asaas — logar para reconciliação
        console.error(
          `[capture-payment] RPC capture_escrow_postpago falhou após captura Asaas. ` +
          `job=${jobId} asaas_payment_id=${asaasPaymentId}. Erro: ${rpcErr.message}`
        );
        throw new Error('Falha ao registrar crédito. Pagamento foi capturado — contacte o suporte.');
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // --- Escrow já capturado/released → idempotente ---
    if (escrow && (escrow.status === 'released' || escrow.status === 'captured')) {
      return new Response(
        JSON.stringify({ success: true, idempotent: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // --- Caminho B: sem hold (charge_on_demand / job postpago sem pré-auth) ---
    if (!escrow || escrow.status === 'refunded') {
      return await chargeOnDemand(
        supabaseAdmin,
        jobId,
        workerId,
        workerWalletId,
        job.company_id,
        job.budget,
        job.title,
        req,
        corsHeaders
      );
    }

    throw new Error(`Estado de escrow inesperado: ${escrow?.status ?? 'ausente'}.`);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Erro interno.';
    console.error('asaas-capture-payment error:', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});

// ---------------------------------------------------------------------------
// Charge-on-demand: cobrança direta com token (sem hold prévio).
// Usado quando: modo charge_on_demand, hold expirado, ou sem pré-auth disponível.
// ---------------------------------------------------------------------------

async function chargeOnDemand(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  jobId: string,
  workerId: string,
  workerWalletId: string,
  companyUserId: string,
  amount: number,
  jobTitle: string,
  req: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  // Buscar token default da empresa
  const { data: pm, error: pmErr } = await supabaseAdmin
    .from('payment_methods')
    .select('asaas_credit_card_token')
    .eq('company_id', companyUserId)
    .eq('is_default', true)
    .maybeSingle();

  if (pmErr || !pm) {
    throw new Error('Método de pagamento da empresa não encontrado para cobrança direta.');
  }

  const { data: companyWallet } = await supabaseAdmin
    .from('wallets')
    .select('asaas_customer_id')
    .eq('user_id', companyUserId)
    .maybeSingle();

  if (!companyWallet?.asaas_customer_id) {
    throw new Error('Conta Asaas da empresa não encontrada.');
  }

  // ---------------------------------------------------------------------------
  // Guarda de idempotência — ANTES de qualquer cobrança Asaas.
  // Busca o escrow existente (excluindo 'refunded', que conta como ausente).
  // Se já está 'released'/'captured', o turno foi pago: retornar sucesso sem cobrar.
  // Se está 'authorized', não deveria ter chegado aqui (tratado no caminho A do caller),
  // mas garantimos que não cria 2ª cobrança.
  // ---------------------------------------------------------------------------
  const { data: escrowExists } = await supabaseAdmin
    .from('escrow_transactions')
    .select('id, status')
    .eq('job_id', jobId)
    .eq('kind', 'postpaid')
    .neq('status', 'refunded')
    .maybeSingle();

  if (escrowExists && (escrowExists.status === 'released' || escrowExists.status === 'captured')) {
    // Turno já pago — idempotente; não cobrar o cartão novamente.
    return new Response(
      JSON.stringify({ success: true, chargeOnDemand: true, idempotent: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }

  const remoteIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    '0.0.0.0';

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 1);

  // Cobrança direta (sem authorizeOnly) — só chega aqui se escrow está ausente ou 'authorized'
  const chargeRes = await fetch(`${ASAAS_API_URL}/payments`, {
    method: 'POST',
    headers: getAsaasHeaders(),
    body: JSON.stringify({
      customer: companyWallet.asaas_customer_id,
      billingType: 'CREDIT_CARD',
      value: amount,
      dueDate: dueDate.toISOString().split('T')[0],
      description: `Pagamento de turno: ${jobTitle}`,
      externalReference: jobId,
      creditCardToken: pm.asaas_credit_card_token,
      remoteIp,
    }),
  });

  const chargeData = await chargeRes.json();
  if (!chargeRes.ok) {
    throw new Error(
      chargeData.errors?.[0]?.description ||
      chargeData.error ||
      'Erro ao cobrar cartão da empresa.'
    );
  }

  const asaasPaymentId: string = chargeData.id;

  // Se escrow existente (hold expirado com status 'authorized'), atualizar o asaas_payment_id
  // para manter trilha de auditoria apontando para a nova cobrança (não o hold expirado).
  if (escrowExists && escrowExists.status === 'authorized') {
    const { error: updatePmtErr } = await supabaseAdmin
      .from('escrow_transactions')
      .update({ asaas_payment_id: asaasPaymentId })
      .eq('id', escrowExists.id);

    if (updatePmtErr) {
      // Não crítico — log e continua. O crédito ao worker será executado independentemente.
      console.warn(
        `[charge-on-demand] Falha ao atualizar asaas_payment_id no escrow (id=${escrowExists.id}): ${updatePmtErr.message}`
      );
    }
  }

  // Se não há escrow (nunca criado ou previamente estornado), criar antes de capturar
  if (!escrowExists) {
    // Buscar applicationId para authorize_escrow
    const { data: application } = await supabaseAdmin
      .from('applications')
      .select('id')
      .eq('job_id', jobId)
      .eq('worker_id', workerId)
      .maybeSingle();

    const applicationId = application?.id ?? null;

    // 1. Authorize (grava o escrow)
    const { error: authRpcErr } = await supabaseAdmin.rpc('authorize_escrow_postpago', {
      p_job_id: jobId,
      p_application_id: applicationId,
      p_amount: amount,
      p_asaas_payment_id: asaasPaymentId,
      p_company_user_id: companyUserId,
    });

    if (authRpcErr && authRpcErr.code !== '23505') {
      console.error(`[charge-on-demand] authorize_escrow_postpago falhou: ${authRpcErr.message}`);
      throw new Error('Falha ao registrar escrow após cobrança. Contacte o suporte.');
    }
  }

  // 2. Capture (credita worker — idempotente)
  const { error: capRpcErr } = await supabaseAdmin.rpc('capture_escrow_postpago', {
    p_job_id: jobId,
    p_worker_wallet_id: workerWalletId,
  });

  if (capRpcErr) {
    console.error(
      `[charge-on-demand] capture_escrow_postpago falhou após cobrança Asaas. ` +
      `job=${jobId} payment=${asaasPaymentId}. Erro: ${capRpcErr.message}`
    );
    throw new Error('Falha ao registrar crédito após cobrança. Contacte o suporte.');
  }

  return new Response(
    JSON.stringify({ success: true, chargeOnDemand: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
  );
}
