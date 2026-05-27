import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders, ASAAS_API_URL, getAsaasHeaders } from '../_shared/asaas.ts';
import { isRateLimited } from '../_shared/rate-limit.ts';

function validateCPF(cpf: string): boolean {
    if (cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    const digits = cpf.split('').map(Number);
    // First check digit
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += digits[i] * (10 - i);
    let remainder = (sum * 10) % 11;
    if (remainder === 10) remainder = 0;
    if (remainder !== digits[9]) return false;

    // Second check digit
    sum = 0;
    for (let i = 0; i < 10; i++) sum += digits[i] * (11 - i);
    remainder = (sum * 10) % 11;
    if (remainder === 10) remainder = 0;
    if (remainder !== digits[10]) return false;

    return true;
}

function validateCNPJ(cnpj: string): boolean {
    if (cnpj.length !== 14) return false;
    if (/^(\d)\1{13}$/.test(cnpj)) return false;

    const digits = cnpj.split('').map(Number);
    const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

    // First check digit
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += digits[i] * weights1[i];
    let remainder = sum % 11;
    const check1 = remainder < 2 ? 0 : 11 - remainder;
    if (check1 !== digits[12]) return false;

    // Second check digit
    sum = 0;
    for (let i = 0; i < 13; i++) sum += digits[i] * weights2[i];
    remainder = sum % 11;
    const check2 = remainder < 2 ? 0 : 11 - remainder;
    if (check2 !== digits[13]) return false;

    return true;
}

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

        const authHeader = req.headers.get('Authorization');
        if (!authHeader) throw new Error('Missing Authorization header');
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) throw new Error('Invalid Token');

        if (isRateLimited(user.id, 'deposit', 5, 60_000)) {
            return new Response(JSON.stringify({ error: 'Muitas tentativas. Aguarde 1 minuto.' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429
            });
        }

        const { amount, name, cpfCnpj, billingType } = await req.json();

        if (!amount || typeof amount !== 'number' || amount < 50) {
            throw new Error('Valor mínimo para depósito é R$ 50,00');
        }
        if (amount > 50000) {
            throw new Error('Maximum deposit amount is R$ 50,000.00');
        }
        // Ensure 2 decimal places precision
        const sanitizedAmount = Math.round(amount * 100) / 100;

        // Ensure wallet exists
        const { data: wallet } = await supabaseAdmin
            .from('wallets')
            .select('id, asaas_customer_id')
            .eq('user_id', user.id)
            .single();

        if (!wallet) {
            throw new Error('Wallet not found. Please complete onboarding first.');
        }

        let customerId = wallet.asaas_customer_id;

        // Create a customer on the master account if not exists
        if (!customerId) {
            const cleanDoc = cpfCnpj ? cpfCnpj.replace(/\D/g, '') : '';
            if (cleanDoc.length === 11) {
                if (!validateCPF(cleanDoc)) {
                    throw new Error('CPF inválido. Verifique os dígitos e tente novamente.');
                }
            } else if (cleanDoc.length === 14) {
                if (!validateCNPJ(cleanDoc)) {
                    throw new Error('CNPJ inválido. Verifique os dígitos e tente novamente.');
                }
            } else {
                throw new Error('CPF (11 dígitos) ou CNPJ (14 dígitos) é obrigatório para criar conta de pagamento.');
            }
            const finalDoc = cleanDoc;

            const customerPayload = {
                name: name || 'Worki User',
                cpfCnpj: finalDoc
            };

            const customerRes = await fetch(`${ASAAS_API_URL}/customers`, {
                method: 'POST',
                headers: getAsaasHeaders(),
                body: JSON.stringify(customerPayload)
            });
            const customerData = await customerRes.json();

            if (!customerRes.ok) {
                console.error('Customer Details:', customerData);
                throw new Error(customerData.errors?.[0]?.description || 'Error creating Asaas customer');
            }

            customerId = customerData.id;

            await supabaseAdmin.from('wallets').update({ asaas_customer_id: customerId }).eq('user_id', user.id).throwOnError();
        }

        // Create charge on master account — accepts PIX, Boleto, or Credit Card
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 3); // 3 days for boleto

        const allowedTypes = ['PIX', 'BOLETO', 'CREDIT_CARD', 'UNDEFINED'];
        const selectedType = allowedTypes.includes(billingType) ? billingType : 'UNDEFINED';

        const paymentPayload: Record<string, unknown> = {
            customer: customerId,
            billingType: selectedType,
            value: sanitizedAmount,
            dueDate: dueDate.toISOString().split('T')[0],
            description: `Deposito de Creditos - Worki`,
            externalReference: user.id,
        };

        // Credit card installments (if applicable)
        if (selectedType === 'CREDIT_CARD' && sanitizedAmount >= 100) {
            paymentPayload.maxInstallmentCount = Math.min(Math.floor(sanitizedAmount / 50), 6);
        }

        const paymentRes = await fetch(`${ASAAS_API_URL}/payments`, {
            method: 'POST',
            headers: getAsaasHeaders(),
            body: JSON.stringify(paymentPayload)
        });

        const paymentData = await paymentRes.json();
        if (!paymentRes.ok) throw new Error(paymentData.errors?.[0]?.description || 'Erro ao gerar cobranca');

        return new Response(JSON.stringify({
            success: true,
            paymentId: paymentData.id,
            invoiceUrl: paymentData.invoiceUrl,
            billingType: selectedType,
            pixQrCodeUrl: paymentData.invoiceUrl
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (error: any) {
        console.error('Deposit Error:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        });
    }
});
