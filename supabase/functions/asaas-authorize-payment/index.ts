/**
 * asaas-authorize-payment — Pré-autoriza (hold) o cartão da empresa no aceite do convite.
 *
 * Fluxo postpago (Slice 2 / ADR-20260622-pagamento-postpago):
 *  Chamado pelo ShiftInviteService.respondToInvite('accepted') após o status da application
 *  mudar para 'hired'. Cria o hold (authorizeOnly:true) no Asaas e grava o escrow 'authorized'
 *  no DB via RPC atômica authorize_escrow_postpago.
 *
 * Modo controlado por env ASAAS_POSTPAGO_MODE:
 *  - 'authorize' (default)    : fluxo normal pré-auth → capture.
 *  - 'charge_on_demand'       : pula a pré-auth; a captura acontece na conclusão. Neste caso
 *                               a função retorna success sem criar hold nem chamar a RPC.
 *
 * Idempotência:
 *  - idx_escrow_unique_asaas_payment (UNIQUE asaas_payment_id): reprocesso não cria 2º escrow.
 *  - 23505 do índice idx_escrow_one_authorized_per_job → tratar como já-autorizado.
 *
 * Deploy normal (com verify-jwt) — caller é o WORKER autenticado.
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

    // --- Auth (caller = worker) ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) throw new Error('Invalid Token');

    if (isRateLimited(user.id, 'authorize-payment', 5, 60_000)) {
      return new Response(
        JSON.stringify({ error: 'Muitas tentativas. Aguarde 1 minuto.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
      );
    }

    const { jobId, applicationId } = await req.json();
    if (!jobId || !applicationId) throw new Error('jobId e applicationId são obrigatórios.');

    // --- Verificar que o caller é o worker desta application ---
    const { data: app, error: appErr } = await supabaseAdmin
      .from('applications')
      .select('id, worker_id, job_id, status, invited_by_company_at')
      .eq('id', applicationId)
      .maybeSingle();

    if (appErr || !app) throw new Error('Candidatura não encontrada.');
    if (app.worker_id !== user.id) throw new Error('Não autorizado: esta candidatura não é sua.');
    if (app.job_id !== jobId) throw new Error('jobId não corresponde à candidatura.');
    if (!app.invited_by_company_at) {
      throw new Error('Esta candidatura não é um convite push (invited_by_company_at ausente).');
    }
    if (app.status !== 'hired') {
      throw new Error(
        `Status da candidatura deve ser 'hired' para autorizar pagamento, mas é '${app.status}'.`
      );
    }

    // --- Verificar se já existe escrow postpago para este job (idempotência + proteção) ---
    // Busca SEM filtro de status: trata cada estado de forma explícita para não criar
    // holds adicionais no cartão da empresa sem novo consentimento.
    const { data: existingEscrow } = await supabaseAdmin
      .from('escrow_transactions')
      .select('id, asaas_payment_id, status')
      .eq('job_id', jobId)
      .eq('kind', 'postpaid')
      .maybeSingle();

    if (existingEscrow) {
      if (existingEscrow.status === 'authorized') {
        // Já autorizado — idempotência: retorna o existente sem criar 2º hold
        return new Response(
          JSON.stringify({
            success: true,
            escrowId: existingEscrow.id,
            asaasPaymentId: existingEscrow.asaas_payment_id,
            status: 'authorized',
            idempotent: true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }

      // Estado terminal: refunded / captured / released.
      // Não recriar hold sem novo convite/consentimento da empresa. Rejeitar explicitamente.
      return new Response(
        JSON.stringify({
          error:
            `Não é possível criar novo hold: o escrow deste turno já está em estado '${existingEscrow.status}'. ` +
            'Para um novo comprometimento de pagamento, a empresa deve emitir um novo convite.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
      );
    }

    // --- Modo: 'authorize' | 'charge_on_demand' ---
    const mode = Deno.env.get('ASAAS_POSTPAGO_MODE') ?? 'authorize';

    if (mode === 'charge_on_demand') {
      // Pula a pré-auth; captura será feita na conclusão. Retorna success sem escrow.
      console.log(`[authorize-payment] charge_on_demand mode: skip hold for job=${jobId}`);
      return new Response(
        JSON.stringify({ success: true, status: 'charge_on_demand', mode }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // --- Buscar dados do job (valor + company_id) ---
    const { data: job, error: jobErr } = await supabaseAdmin
      .from('jobs')
      .select('company_id, budget, title')
      .eq('id', jobId)
      .maybeSingle();

    if (jobErr || !job) throw new Error('Vaga não encontrada.');
    const amount: number = job.budget;
    if (!amount || amount <= 0) throw new Error('Budget da vaga inválido para pré-autorização.');

    const companyUserId: string = job.company_id;

    // --- Buscar método de pagamento default da empresa ---
    const { data: pm, error: pmErr } = await supabaseAdmin
      .from('payment_methods')
      .select('asaas_credit_card_token, brand, last4')
      .eq('company_id', companyUserId)
      .eq('is_default', true)
      .maybeSingle();

    if (pmErr || !pm) {
      throw new Error(
        'A empresa não possui método de pagamento cadastrado. ' +
        'Solicite ao operador que cadastre um cartão antes de aceitar convites.'
      );
    }

    // --- Buscar asaas_customer_id da empresa ---
    const { data: companyWallet, error: cwErr } = await supabaseAdmin
      .from('wallets')
      .select('asaas_customer_id')
      .eq('user_id', companyUserId)
      .maybeSingle();

    if (cwErr || !companyWallet?.asaas_customer_id) {
      throw new Error('Conta de pagamento da empresa não encontrada no Asaas.');
    }

    // --- remoteIp (exigido pelo Asaas para cobrança com cartão) ---
    const remoteIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      '0.0.0.0';

    // dueDate = hoje + 1 dia (mínimo exigido pelo Asaas)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 1);
    const dueDateStr = dueDate.toISOString().split('T')[0];

    // --- POST /v3/payments com authorizeOnly:true ---
    const paymentRes = await fetch(`${ASAAS_API_URL}/payments`, {
      method: 'POST',
      headers: getAsaasHeaders(),
      body: JSON.stringify({
        customer: companyWallet.asaas_customer_id,
        billingType: 'CREDIT_CARD',
        value: amount,
        dueDate: dueDateStr,
        description: `Turno reservado: ${job.title}`,
        externalReference: jobId,
        authorizeOnly: true,
        creditCardToken: pm.asaas_credit_card_token,
        remoteIp,
      }),
    });

    const paymentData = await paymentRes.json();

    // --- Tratar falha: distinguir "pré-auth não habilitada" de recusa de cartão ---
    if (!paymentRes.ok) {
      const errCode: string = paymentData.errors?.[0]?.code ?? '';
      const errMsg: string = paymentData.errors?.[0]?.description || paymentData.error || '';

      // Códigos específicos do Asaas que indicam que a funcionalidade de pré-autorização
      // não está habilitada na conta (configuração do merchant, não recusa de cartão).
      // Referência: documentação Asaas — "authorizeOnly not available for this account".
      const PRE_AUTH_UNAVAILABLE_CODES = new Set([
        'invalid_action',
        'INVALID_ACTION',
        'authorize_only_not_available',
        'AUTHORIZE_ONLY_NOT_AVAILABLE',
      ]);

      const isPreAuthDisabled =
        PRE_AUTH_UNAVAILABLE_CODES.has(errCode) ||
        errMsg.toLowerCase().includes('authorize_only') ||
        errMsg.toLowerCase().includes('authorizeonly') ||
        errMsg.toLowerCase().includes('pre-authorization not available') ||
        errMsg.toLowerCase().includes('pré-autorização não disponível');

      if (isPreAuthDisabled) {
        console.warn(
          `[authorize-payment] Pré-auth não disponível na conta (fallback charge_on_demand): ` +
          `code=${errCode} msg=${errMsg}`
        );
        return new Response(
          JSON.stringify({ success: true, status: 'charge_on_demand', fallback: true, reason: errMsg }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }

      // Qualquer outro erro (incluindo recusa de cartão) deve ser surfaced — não engolir.
      console.error(
        `[authorize-payment] Falha na pré-autorização: code=${errCode} status=${paymentRes.status} msg=${errMsg}`
      );
      throw new Error(errMsg || 'Erro ao criar pré-autorização no Asaas.');
    }

    const asaasPaymentId: string = paymentData.id;
    if (!asaasPaymentId) throw new Error('Asaas não retornou o id da cobrança.');

    // Status esperado: AUTHORIZED. Se não, logar mas prosseguir (Asaas pode retornar PENDING transitório)
    if (paymentData.status && paymentData.status !== 'AUTHORIZED') {
      console.warn(
        `[authorize-payment] Status Asaas inesperado: ${paymentData.status} para payment=${asaasPaymentId}`
      );
    }

    // --- Gravar escrow 'authorized'/'postpaid' no DB (RPC atômica) ---
    const { data: escrowId, error: rpcErr } = await supabaseAdmin.rpc(
      'authorize_escrow_postpago',
      {
        p_job_id: jobId,
        p_application_id: applicationId,
        p_amount: amount,
        p_asaas_payment_id: asaasPaymentId,
        p_company_user_id: companyUserId,
      }
    );

    if (rpcErr) {
      // 23505 = único violado (hold duplicado) — tratar como idempotente
      if (rpcErr.code === '23505') {
        console.warn(`[authorize-payment] Escrow duplicado (23505), tratando como idempotente.`);
        return new Response(
          JSON.stringify({ success: true, asaasPaymentId, status: 'authorized', idempotent: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }
      // RPC falhou após criar o hold no Asaas — logar para reconciliação manual
      console.error(
        `[authorize-payment] RPC authorize_escrow_postpago falhou após hold criado. ` +
        `asaas_payment_id=${asaasPaymentId} job=${jobId}. Erro: ${rpcErr.message}`
      );
      throw new Error('Falha ao registrar escrow. O hold foi criado no Asaas — contacte o suporte.');
    }

    return new Response(
      JSON.stringify({
        success: true,
        escrowId,
        asaasPaymentId,
        status: 'authorized',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Erro interno.';
    console.error('asaas-authorize-payment error:', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
