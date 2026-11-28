import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders, ASAAS_API_URL, getAsaasHeaders } from '../_shared/asaas.ts';
import { handleBonusAction, isBonusAction, isBonusInputError, isBonusForbiddenError } from './bonus.ts';

// Normaliza (trim + minúsculas) e descarta itens vazios: "a@x.com,," não pode gerar '' como admin.
const ADMIN_EMAILS = (Deno.env.get('ADMIN_EMAILS') ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(e => e.length > 0);

// Comparação em tempo constante (via digest SHA-256 de tamanho fixo) do token com a chave service_role.
async function isServiceRoleToken(token: string): Promise<boolean> {
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!key || !token) return false;
    const enc = new TextEncoder();
    const [a, b] = await Promise.all([
        crypto.subtle.digest('SHA-256', enc.encode(token)),
        crypto.subtle.digest('SHA-256', enc.encode(key)),
    ]);
    const va = new Uint8Array(a);
    const vb = new Uint8Array(b);
    let diff = 0;
    for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
    return diff === 0;
}

serve(async (req) => {
    const corsHeaders = getCorsHeaders(req);
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401
            });
        }

        // Allow service_role key OR admin user email
        const token = authHeader.replace('Bearer ', '');
        const isServiceRole = await isServiceRoleToken(token);
        let adminUserId: string | null = null;

        if (!isServiceRole) {
            const supabaseAnon = createClient(
                Deno.env.get('SUPABASE_URL') ?? '',
                Deno.env.get('SUPABASE_ANON_KEY') ?? '',
                { global: { headers: { Authorization: authHeader } } }
            );
            const { data: { user }, error: authError } = await supabaseAnon.auth.getUser();
            const userEmail = (user?.email ?? '').trim().toLowerCase();
            if (authError || !user || !user.email_confirmed_at || !userEmail || !ADMIN_EMAILS.includes(userEmail)) {
                return new Response(JSON.stringify({ error: 'Forbidden' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403
                });
            }
            adminUserId = user.id;
        }

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        // deno-lint-ignore no-explicit-any -- campos legados (user_id, amount) são validados em cada ação
        let body: Record<string, any>;
        try {
            const parsed: unknown = await req.json();
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not-object');
            body = parsed as typeof body;
        } catch {
            return new Response(JSON.stringify({ error: 'Corpo da requisição inválido' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
            });
        }
        const { action } = body;

        // Trilha de bônus (admin): lógica isolada em ./bonus.ts, mesma checagem de admin acima.
        if (isBonusAction(action)) {
            try {
                const result = await handleBonusAction(supabaseAdmin, adminUserId, body);
                return new Response(JSON.stringify(result), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (e: unknown) {
                if (isBonusForbiddenError(e)) {
                    return new Response(JSON.stringify({ error: 'Forbidden' }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403
                    });
                }
                if (isBonusInputError(e)) {
                    return new Response(JSON.stringify({ error: e.message }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
                    });
                }
                // Erro de banco/rede: detalhe só no log do servidor (sem nome de constraint para o client).
                console.error('Admin bonus error:', e instanceof Error ? e.message : 'unknown');
                return new Response(JSON.stringify({ error: 'Não foi possível concluir a ação de bônus' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500
                });
            }
        }

        // Helper: build a map of wallet_id → { user_id, email, user_type, name }
        async function buildWalletUserMap() {
            const { data: wallets } = await supabaseAdmin.from('wallets').select('id, user_id, user_type');
            if (!wallets || wallets.length === 0) return new Map();

            const userIds = [...new Set(wallets.map((w: { user_id: string }) => w.user_id))];

            // Get auth users for emails
            const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 500 });
            const authMap = new Map(authUsers.map(u => [u.id, u]));

            // Get worker/company profiles for names
            const [workersRes, companiesRes] = await Promise.all([
                supabaseAdmin.from('workers').select('user_id, full_name').in('user_id', userIds),
                supabaseAdmin.from('companies').select('user_id, company_name, contact_name').in('user_id', userIds),
            ]);
            const workersMap = new Map((workersRes.data || []).map((w: { user_id: string; full_name: string }) => [w.user_id, w]));
            const companiesMap = new Map((companiesRes.data || []).map((c: { user_id: string; company_name: string; contact_name: string }) => [c.user_id, c]));

            const result = new Map();
            for (const w of wallets) {
                const authUser = authMap.get(w.user_id);
                const worker = workersMap.get(w.user_id);
                const company = companiesMap.get(w.user_id);
                result.set(w.id, {
                    user_id: w.user_id,
                    email: authUser?.email || 'unknown',
                    user_type: w.user_type,
                    name: worker?.full_name || company?.company_name || company?.contact_name || authUser?.user_metadata?.full_name || '-',
                });
            }
            return result;
        }

        if (action === 'users') {
            const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 100 });
            if (error) throw error;

            const [workersRes, companiesRes, walletsRes] = await Promise.all([
                supabaseAdmin.from('workers').select('user_id, full_name, skills, city, state'),
                supabaseAdmin.from('companies').select('user_id, company_name, contact_name, sector'),
                supabaseAdmin.from('wallets').select('user_id, balance, user_type'),
            ]);

            const workersMap = new Map((workersRes.data || []).map(w => [w.user_id, w]));
            const companiesMap = new Map((companiesRes.data || []).map(c => [c.user_id, c]));
            const walletsMap = new Map((walletsRes.data || []).map(w => [w.user_id, w]));

            const enrichedUsers = users.map(u => ({
                id: u.id,
                email: u.email,
                user_type: u.user_metadata?.user_type || 'unknown',
                full_name: u.user_metadata?.full_name || '',
                created_at: u.created_at,
                email_confirmed_at: u.email_confirmed_at,
                last_sign_in_at: u.last_sign_in_at,
                profile: workersMap.get(u.id) || companiesMap.get(u.id) || null,
                balance: walletsMap.get(u.id)?.balance || 0,
            }));

            return new Response(JSON.stringify({ users: enrichedUsers }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        if (action === 'escrows') {
            const { data, error } = await supabaseAdmin
                .from('escrow_transactions')
                .select('*, job:jobs(title, company_id)')
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) throw error;

            // Enrich with wallet owner info
            const walletMap = await buildWalletUserMap();

            const enriched = (data || []).map(e => ({
                ...e,
                company_info: walletMap.get(e.company_wallet_id) || null,
                worker_info: e.worker_wallet_id ? walletMap.get(e.worker_wallet_id) || null : null,
            }));

            return new Response(JSON.stringify({ escrows: enriched }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        if (action === 'stats') {
            // Fetch Asaas real balance in parallel with DB queries
            let asaasBalance = null;
            try {
                const asaasRes = await fetch(`${ASAAS_API_URL}/finance/balance`, {
                    headers: getAsaasHeaders(),
                });
                if (asaasRes.ok) {
                    const asaasData = await asaasRes.json();
                    asaasBalance = {
                        currentBalance: asaasData.balance ?? 0,
                        pendingBalance: asaasData.statistics?.pending ?? 0,
                        totalBalance: (asaasData.balance ?? 0) + (asaasData.statistics?.pending ?? 0),
                    };
                }
            } catch (e) {
                console.error('Failed to fetch Asaas balance:', e);
            }

            const [workersRes, companiesRes, jobsRes, escrowReserved, escrowReleased, walletsRes, txRes] = await Promise.all([
                supabaseAdmin.from('workers').select('id', { count: 'exact', head: true }),
                supabaseAdmin.from('companies').select('id', { count: 'exact', head: true }),
                supabaseAdmin.from('jobs').select('id', { count: 'exact', head: true }),
                supabaseAdmin.from('escrow_transactions').select('amount').eq('status', 'reserved'),
                supabaseAdmin.from('escrow_transactions').select('amount').eq('status', 'released'),
                supabaseAdmin.from('wallets').select('balance, user_type'),
                supabaseAdmin.from('wallet_transactions')
                    .select('*, wallet:wallets(user_id, user_type)')
                    .order('created_at', { ascending: false })
                    .limit(50),
            ]);

            const reservedTotal = (escrowReserved.data || []).reduce((s: number, e: { amount: number }) => s + Number(e.amount), 0);
            const releasedTotal = (escrowReleased.data || []).reduce((s: number, e: { amount: number }) => s + Number(e.amount), 0);
            const dbTotalBalance = (walletsRes.data || []).reduce((s: number, w: { balance: number }) => s + Number(w.balance), 0);
            const workerBalances = (walletsRes.data || []).filter((w: { user_type: string }) => w.user_type === 'worker').reduce((s: number, w: { balance: number }) => s + Number(w.balance), 0);
            const companyBalances = (walletsRes.data || []).filter((w: { user_type: string }) => w.user_type === 'company').reduce((s: number, w: { balance: number }) => s + Number(w.balance), 0);

            // Enrich transactions with user email/name
            const walletMap = await buildWalletUserMap();

            const enrichedTx = (txRes.data || []).map(tx => ({
                ...tx,
                user_info: walletMap.get(tx.wallet_id) || null,
            }));

            return new Response(JSON.stringify({
                stats: {
                    totalWorkers: workersRes.count || 0,
                    totalCompanies: companiesRes.count || 0,
                    totalJobs: jobsRes.count || 0,
                    totalEscrowReserved: reservedTotal,
                    totalEscrowReleased: releasedTotal,
                    dbTotalBalance,
                    workerBalances,
                    companyBalances,
                    asaas: asaasBalance,
                },
                transactions: enrichedTx,
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // Admin: create PIX deposit on Asaas for any user
        if (action === 'create_deposit') {
            const { user_id, amount } = body;
            if (!user_id || !amount) throw new Error('user_id and amount required');
            if (typeof amount !== 'number') {
                return new Response(JSON.stringify({ error: 'Amount must be a number' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
                });
            }
            if (amount <= 0) {
                return new Response(JSON.stringify({ error: 'Amount must be positive' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
                });
            }

            const { data: wallet } = await supabaseAdmin
                .from('wallets').select('id, asaas_customer_id').eq('user_id', user_id).single();
            if (!wallet) throw new Error('Wallet not found for user');

            if (!wallet.asaas_customer_id) throw new Error('User has no Asaas customer ID. They need to deposit via frontend first to register CPF.');

            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 1);

            const paymentRes = await fetch(`${ASAAS_API_URL}/payments`, {
                method: 'POST',
                headers: getAsaasHeaders(),
                body: JSON.stringify({
                    customer: wallet.asaas_customer_id,
                    billingType: 'PIX',
                    value: Math.round(amount * 100) / 100,
                    dueDate: dueDate.toISOString().split('T')[0],
                    description: 'Deposito de Creditos - Worki (Admin)',
                    externalReference: user_id,
                }),
            });
            const paymentData = await paymentRes.json();
            if (!paymentRes.ok) throw new Error(paymentData.errors?.[0]?.description || 'Asaas error');

            return new Response(JSON.stringify({
                success: true,
                paymentId: paymentData.id,
                invoiceUrl: paymentData.invoiceUrl,
                value: paymentData.value,
                status: paymentData.status,
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Admin: manually credit a wallet (simulate webhook for testing)
        if (action === 'admin_credit') {
            const { user_id, amount, payment_id } = body;
            if (!user_id || !amount) throw new Error('user_id and amount required');
            if (typeof amount !== 'number') {
                return new Response(JSON.stringify({ error: 'Amount must be a number' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
                });
            }
            if (amount <= 0) {
                return new Response(JSON.stringify({ error: 'Amount must be positive' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
                });
            }

            const refId = payment_id || `admin-credit-${Date.now()}`;
            const { data, error } = await supabaseAdmin.rpc('credit_deposit', {
                p_user_id: user_id,
                p_amount: amount,
                p_payment_id: refId,
                p_description: 'Deposito via Pix (Admin)',
            });
            if (error) throw error;

            // Get updated balance
            const { data: wallet } = await supabaseAdmin
                .from('wallets').select('balance').eq('user_id', user_id).single();

            return new Response(JSON.stringify({
                success: true,
                credited: data,
                new_balance: wallet?.balance || 0,
                reference_id: refId,
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        if (action === 'impersonate_user') {
            const targetEmail = String(body.target_email ?? '').trim().toLowerCase();
            const reason = String(body.reason ?? 'Suporte SysAdmin').trim().slice(0, 200);
            if (!targetEmail || !targetEmail.includes('@')) {
                return new Response(JSON.stringify({ error: 'E-mail de destino inválido' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
                });
            }
            if (ADMIN_EMAILS.includes(targetEmail)) {
                return new Response(JSON.stringify({ error: 'Não é permitido acessar outra conta de administrador' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403
                });
            }

            const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
                type: 'magiclink',
                email: targetEmail,
            });
            if (linkError || !linkData?.properties?.hashed_token) {
                console.error('Impersonate generateLink error:', linkError?.message);
                return new Response(JSON.stringify({ error: linkError?.message || 'Não foi possível gerar acesso' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
                });
            }

            console.info(JSON.stringify({
                event: 'admin_impersonate',
                admin_user_id: adminUserId,
                target_email: targetEmail,
                target_user_id: linkData.user?.id ?? null,
                reason,
                at: new Date().toISOString(),
            }));

            return new Response(JSON.stringify({
                token_hash: linkData.properties.hashed_token,
                email: targetEmail,
                type: 'magiclink',
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        if (action === 'financial_summary') {
            // Fetch Asaas real balance
            let asaasBalance = null;
            try {
                const asaasRes = await fetch(`${ASAAS_API_URL}/finance/balance`, {
                    headers: getAsaasHeaders(),
                });
                if (asaasRes.ok) {
                    const asaasData = await asaasRes.json();
                    asaasBalance = {
                        currentBalance: asaasData.balance ?? 0,
                        pendingBalance: asaasData.statistics?.pending ?? 0,
                    };
                }
            } catch (e) {
                console.error('Failed to fetch Asaas balance:', e);
            }

            const [walletsRes, escrowReservedRes, platformFeeRes, depositsRes, withdrawalsRes] = await Promise.all([
                supabaseAdmin.from('wallets').select('balance'),
                supabaseAdmin.from('escrow_transactions').select('amount').eq('status', 'reserved'),
                supabaseAdmin.from('wallet_transactions').select('amount').eq('type', 'platform_fee'),
                supabaseAdmin.from('wallet_transactions').select('id').eq('type', 'credit'),
                supabaseAdmin.from('wallet_transactions').select('id').eq('type', 'debit'),
            ]);

            const totalWalletBalances = (walletsRes.data || []).reduce((s: number, w: { balance: number }) => s + Number(w.balance), 0);
            const totalEscrowReserved = (escrowReservedRes.data || []).reduce((s: number, e: { amount: number }) => s + Number(e.amount), 0);
            const totalPlatformFees = (platformFeeRes.data || []).reduce((s: number, t: { amount: number }) => s + Math.abs(Number(t.amount)), 0);
            const depositCount = (depositsRes.data || []).length;
            const withdrawalCount = (withdrawalsRes.data || []).length;
            const estimatedAsaasCost = (depositCount + withdrawalCount) * 1.99;
            const netProfit = totalPlatformFees - estimatedAsaasCost;

            return new Response(JSON.stringify({
                asaas: asaasBalance,
                totalWalletBalances,
                totalEscrowReserved,
                totalPlatformFees,
                depositCount,
                withdrawalCount,
                estimatedAsaasCost: parseFloat(estimatedAsaasCost.toFixed(2)),
                netProfit: parseFloat(netProfit.toFixed(2)),
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({ error: 'Invalid action' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
        });

    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error('Admin API Error:', msg);
        return new Response(JSON.stringify({ error: msg }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500
        });
    }
});
