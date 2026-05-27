import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/asaas.ts';

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

    // Extrair userId do JWT — não do body da request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization header obrigatório.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Token inválido.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const userId = user.id;

    // 1. Detectar role: buscar em workers primeiro, depois companies
    const { data: workerData } = await supabaseAdmin
      .from('workers')
      .select('id')
      .eq('id', userId)
      .single();

    const isWorker = !!workerData;

    // 2. Verificar saldo positivo na carteira (workers e empresas)
    const { data: walletData } = await supabaseAdmin
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .single();

    if (walletData && Number(walletData.balance) > 0) {
      return new Response(
        JSON.stringify({
          error: 'Você tem saldo disponível na sua carteira. Saque seus fundos antes de deletar sua conta.',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    if (!isWorker) {
      // Verificar se é empresa com escrow ativo
      // escrow_transactions não tem company_id — buscar via jobs.company_id
      const { data: companyJobIds } = await supabaseAdmin
        .from('jobs')
        .select('id')
        .eq('company_id', userId);

      const jobIds = (companyJobIds || []).map((j: { id: string }) => j.id);

      if (jobIds.length > 0) {
        const { data: escrowData } = await supabaseAdmin
          .from('escrow_transactions')
          .select('id')
          .in('job_id', jobIds)
          .eq('status', 'reserved')
          .limit(1);

        if (escrowData && escrowData.length > 0) {
          return new Response(
            JSON.stringify({
              error: 'Você tem pagamentos pendentes. Confirme ou cancele os jobs em andamento antes de deletar sua conta.',
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400,
            }
          );
        }
      }
    }

    // 3. Cancelar applications ativas
    if (isWorker) {
      await supabaseAdmin
        .from('applications')
        .update({ status: 'cancelled' })
        .eq('worker_id', userId)
        .in('status', ['pending', 'interview', 'hired', 'in_progress']);
    } else {
      // Buscar IDs dos jobs da empresa
      const { data: companyJobs } = await supabaseAdmin
        .from('jobs')
        .select('id')
        .eq('company_id', userId);

      const jobIds = (companyJobs || []).map((j: { id: string }) => j.id);
      if (jobIds.length > 0) {
        await supabaseAdmin
          .from('applications')
          .update({ status: 'cancelled' })
          .in('job_id', jobIds)
          .in('status', ['pending', 'interview', 'hired', 'in_progress']);
      }
    }

    // 4. Marcar jobs como deleted (empresa)
    if (!isWorker) {
      await supabaseAdmin
        .from('jobs')
        .update({ status: 'deleted' })
        .eq('company_id', userId);
    }

    // 5. Anonimizar worker
    if (isWorker) {
      await supabaseAdmin
        .from('workers')
        .update({
          full_name: '[Conta Deletada]',
          phone: null,
          cpf: null,
          bio: null,
          pix_key: null,
          avatar_url: null,
          city: null,
        })
        .eq('id', userId);
    }

    // 6. Anonimizar empresa
    if (!isWorker) {
      await supabaseAdmin
        .from('companies')
        .update({
          name: '[Empresa Deletada]',
          cnpj: null,
          address: null,
          email: null,
          website: null,
        })
        .eq('id', userId);
    }

    // 7. Deletar mensagens
    await supabaseAdmin
      .from('Message')
      .delete()
      .eq('senderid', userId);

    // 8. Deletar auth user
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error('Erro ao deletar auth user:', deleteError);
      return new Response(JSON.stringify({ error: 'Erro ao deletar conta. Tente novamente.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    // 9. Sucesso
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('delete-account error:', error);
    return new Response(JSON.stringify({ error: 'Erro interno. Tente novamente.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
