import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders, ASAAS_API_URL, getAsaasHeaders } from '../_shared/asaas.ts';

const MAX_PAGES = 10;

serve(async (req) => {
    const corsHeaders = getCorsHeaders(req);
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const asaasApiKey = Deno.env.get('ASAAS_API_KEY');
        if (!asaasApiKey) {
            throw new Error('ASAAS_API_KEY not configured');
        }

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        const authHeader = req.headers.get('Authorization');
        if (!authHeader) throw new Error('Missing Authorization header');
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
        if (userError || !user) throw new Error('Invalid Token');

        // Get user wallet
        const { data: wallet, error: walletError } = await supabaseAdmin
            .from('wallets')
            .select('id, balance')
            .eq('user_id', user.id)
            .single();

        if (walletError || !wallet) {
            return new Response(JSON.stringify({
                success: true,
                hasUpdates: false,
                totalSynced: 0,
                message: 'Carteira nao encontrada.'
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
            });
        }

        let hasUpdates = false;
        let totalSynced = 0;

        const statuses = ['RECEIVED', 'CONFIRMED'];

        for (const status of statuses) {
            let offset = 0;
            const limit = 100;
            let hasMore = true;
            let pageCount = 0;

            while (hasMore && pageCount < MAX_PAGES) {
                pageCount++;
                const asaasRes = await fetch(`${ASAAS_API_URL}/payments?externalReference=${user.id}&status=${status}&limit=${limit}&offset=${offset}`, {
                    headers: getAsaasHeaders()
                });

                if (!asaasRes.ok) {
                    console.error('Error fetching Asaas payments:', await asaasRes.text());
                    break;
                }

                const asaasData = await asaasRes.json();
                const payments = asaasData.data || [];

                for (const payment of payments) {
                    const paymentId = payment.id;
                    const amount = payment.netValue ?? payment.value; // Use netValue (after Asaas fees)

                    // Use atomic RPC - handles dedup via unique constraint
                    const { data: credited, error: rpcError } = await supabaseAdmin.rpc('credit_deposit', {
                        p_user_id: user.id,
                        p_amount: amount,
                        p_payment_id: paymentId,
                        p_description: 'Deposito sincronizado'
                    });

                    if (rpcError) {
                        // Unique constraint = already processed, skip
                        if (rpcError.code === '23505') continue;
                        console.error('credit_deposit error:', rpcError);
                        continue;
                    }

                    if (credited) {
                        totalSynced += amount;
                        hasUpdates = true;
                    }
                }

                hasMore = payments.length === limit;
                offset += limit;

                if (hasMore && pageCount >= MAX_PAGES) {
                    console.warn(`Max pages (${MAX_PAGES}) reached for status ${status}, user ${user.id}. Some payments may not be synced.`);
                }
            }
        }

        return new Response(JSON.stringify({
            success: true,
            hasUpdates,
            totalSynced,
            message: hasUpdates ? `Sincronizados R$ ${totalSynced.toFixed(2)} de novos depositos.` : 'Tudo ja esta atualizado.'
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (error: any) {
        console.error('Sync Error:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
});
