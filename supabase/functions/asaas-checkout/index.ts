import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/asaas.ts';
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

        const authHeader = req.headers.get('Authorization');
        if (!authHeader) throw new Error('Missing Authorization header');
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
        if (userError || !user) throw new Error('Invalid Token');

        if (isRateLimited(user.id, 'checkout', 5, 60_000)) {
            return new Response(JSON.stringify({ error: 'Muitas tentativas. Aguarde 1 minuto.' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429
            });
        }

        const { jobId, workerId } = await req.json();

        if (!jobId || !workerId) {
            throw new Error('jobId and workerId are required');
        }

        // 1. Verify caller is the job owner
        const { data: job, error: jobError } = await supabaseAdmin
            .from('jobs')
            .select('company_id')
            .eq('id', jobId)
            .single();

        if (jobError || !job) throw new Error('Job not found');
        if (job.company_id !== user.id) throw new Error('Not authorized');

        // 2. Verify workerId has a completed application (or confirmed checkout) for this job
        const { data: app, error: appError } = await supabaseAdmin
            .from('applications')
            .select('worker_id, status, company_checkout_confirmed_at')
            .eq('job_id', jobId)
            .eq('worker_id', workerId)
            .in('status', ['in_progress', 'completed'])
            .single();

        if (appError || !app) {
            throw new Error('Candidatura nao encontrada ou trabalho ainda nao foi iniciado');
        }

        // Only allow release if job is completed OR company explicitly confirmed checkout
        if (app.status !== 'completed' && !app.company_checkout_confirmed_at) {
            throw new Error('O trabalho precisa estar concluido antes de liberar o pagamento');
        }

        // Get or create worker wallet
        let { data: workerWallet } = await supabaseAdmin
            .from('wallets')
            .select('id')
            .eq('user_id', workerId)
            .single();

        if (!workerWallet) {
            // Auto-create wallet for worker if missing (legacy users)
            const { data: newWallet, error: createError } = await supabaseAdmin
                .from('wallets')
                .insert({ user_id: workerId, balance: 0, user_type: 'worker' })
                .select('id')
                .single();

            if (createError || !newWallet) throw new Error('Failed to create worker wallet');
            workerWallet = newWallet;
        }

        // Use atomic RPC - prevents double-release via UPDATE ... WHERE status='reserved'
        const { data, error: rpcError } = await supabaseAdmin.rpc('release_escrow', {
            p_job_id: jobId,
            p_worker_wallet_id: workerWallet.id
        });

        if (rpcError) {
            console.error('release_escrow RPC error:', rpcError);
            throw new Error(rpcError.message || 'Failed to release escrow');
        }

        return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (error: any) {
        console.error('Checkout Error:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        });
    }
});
