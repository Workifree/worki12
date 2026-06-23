/**
 * asaas-tokenize-card — Tokeniza cartão de crédito da empresa no Asaas.
 *
 * Fluxo postpago (Slice 2 / ADR-20260622-pagamento-postpago):
 *  1. Garante que a empresa tem um asaas_customer_id (cria se não tiver).
 *  2. Envia dados do cartão para POST /v3/creditCard/tokenizeCreditCard (PAN só nesta
 *     chamada server→Asaas; NUNCA gravado no DB — Article 10 / PCI).
 *  3. Grava o token opaco + metadados em payment_methods (UNIQUE por company+token).
 *  4. Marca o novo método como default; desmarca o anterior.
 *
 * Deploy normal (com verify-jwt) — chamada autenticada pela empresa.
 * Article 10: service_role apenas no Deno (Supabase Admin); sem chave no frontend.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders, ASAAS_API_URL, getAsaasHeaders } from '../_shared/asaas.ts';
import { isRateLimited } from '../_shared/rate-limit.ts';

// ---------------------------------------------------------------------------
// Tipos de input
// ---------------------------------------------------------------------------

interface HolderInfo {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  phone: string;
}

interface TokenizeCardInput {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
  holderInfo: HolderInfo;
}

// ---------------------------------------------------------------------------
// Serve
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // --- Admin client (service_role só no Deno) ---
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // --- Auth ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) throw new Error('Invalid Token');

    // --- Rate limit: 3 tokenizações por minuto por empresa ---
    if (isRateLimited(user.id, 'tokenize-card', 3, 60_000)) {
      return new Response(
        JSON.stringify({ error: 'Muitas tentativas. Aguarde 1 minuto.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
      );
    }

    // --- Parse do body ---
    const body: TokenizeCardInput = await req.json();
    const { holderName, number, expiryMonth, expiryYear, ccv, holderInfo } = body;

    if (!holderName || !number || !expiryMonth || !expiryYear || !ccv) {
      throw new Error('Dados do cartão incompletos.');
    }
    if (!holderInfo?.cpfCnpj || !holderInfo?.name) {
      throw new Error('holderInfo obrigatório: name e cpfCnpj.');
    }

    // --- Resolver company_id (owner_id = auth.uid()) ---
    const { data: company, error: companyErr } = await supabaseAdmin
      .from('companies')
      .select('id')
      .eq('owner_id', user.id)
      .maybeSingle();

    if (companyErr || !company) {
      throw new Error('Perfil de empresa não encontrado.');
    }
    const companyId: string = company.id;

    // --- Garantir carteira e asaas_customer_id ---
    const { data: wallet, error: walletErr } = await supabaseAdmin
      .from('wallets')
      .select('id, asaas_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (walletErr || !wallet) {
      throw new Error('Carteira não encontrada. Conclua o onboarding primeiro.');
    }

    let customerId: string = wallet.asaas_customer_id ?? '';

    // Criar customer no Asaas se não existir (mesmo padrão do asaas-deposit)
    if (!customerId) {
      const cleanDoc = holderInfo.cpfCnpj.replace(/\D/g, '');
      const customerRes = await fetch(`${ASAAS_API_URL}/customers`, {
        method: 'POST',
        headers: getAsaasHeaders(),
        body: JSON.stringify({
          name: holderInfo.name,
          cpfCnpj: cleanDoc,
          email: holderInfo.email,
          phone: holderInfo.phone,
        }),
      });
      const customerData = await customerRes.json();
      if (!customerRes.ok) {
        throw new Error(
          customerData.errors?.[0]?.description || 'Erro ao criar conta de pagamento.'
        );
      }
      customerId = customerData.id;
      await supabaseAdmin
        .from('wallets')
        .update({ asaas_customer_id: customerId })
        .eq('user_id', user.id)
        .throwOnError();
    }

    // --- remoteIp para conformidade Asaas (exigido pelo endpoint de tokenização) ---
    const remoteIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      '0.0.0.0';

    // --- Tokenizar cartão no Asaas (PAN só nesta chamada — nunca gravado) ---
    const tokenizeRes = await fetch(`${ASAAS_API_URL}/creditCard/tokenizeCreditCard`, {
      method: 'POST',
      headers: getAsaasHeaders(),
      body: JSON.stringify({
        customer: customerId,
        creditCard: {
          holderName,
          number,
          expiryMonth,
          expiryYear,
          ccv,
        },
        creditCardHolderInfo: {
          name: holderInfo.name,
          email: holderInfo.email,
          cpfCnpj: holderInfo.cpfCnpj.replace(/\D/g, ''),
          postalCode: holderInfo.postalCode.replace(/\D/g, ''),
          addressNumber: holderInfo.addressNumber,
          phone: holderInfo.phone.replace(/\D/g, ''),
        },
        remoteIp,
      }),
    });

    const tokenizeData = await tokenizeRes.json();
    if (!tokenizeRes.ok) {
      throw new Error(
        tokenizeData.errors?.[0]?.description ||
        tokenizeData.error ||
        'Cartão recusado ou dados inválidos.'
      );
    }

    const asaasCreditCardToken: string = tokenizeData.creditCardToken;
    const brand: string = tokenizeData.creditCardBrand ?? '';
    // last4: Asaas retorna creditCardNumber mascarado (ex: "•••• 1234") — extraímos os 4 últimos dígitos
    const last4Raw: string = tokenizeData.creditCardNumber ?? '';
    const last4 = last4Raw.replace(/\D/g, '').slice(-4) || null;

    if (!asaasCreditCardToken) {
      throw new Error('Asaas não retornou o token do cartão.');
    }

    // --- Desmarcar default anterior (se houver) ---
    await supabaseAdmin
      .from('payment_methods')
      .update({ is_default: false })
      .eq('company_id', companyId)
      .eq('is_default', true);

    // --- Gravar método de pagamento (idempotente: UNIQUE company_id + token) ---
    const { data: pm, error: pmErr } = await supabaseAdmin
      .from('payment_methods')
      .upsert(
        {
          company_id: companyId,
          asaas_credit_card_token: asaasCreditCardToken,
          brand: brand || null,
          last4,
          holder_name: holderName,
          is_default: true,
        },
        { onConflict: 'company_id,asaas_credit_card_token', ignoreDuplicates: false }
      )
      .select('id, brand, last4')
      .single();

    if (pmErr || !pm) {
      throw new Error('Erro ao salvar método de pagamento.');
    }

    return new Response(
      JSON.stringify({
        success: true,
        paymentMethodId: pm.id,
        brand: pm.brand,
        last4: pm.last4,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Erro interno.';
    console.error('asaas-tokenize-card error:', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
