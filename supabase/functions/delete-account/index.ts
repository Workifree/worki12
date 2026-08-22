/**
 * delete-account — Exclusão de conta (LGPD art. 18, VI).
 *
 * Contrato normativo: .harness/spec/lgpd-producao/ddl-aprovado.md §4.
 * A anonimização de conteúdo pessoal (workers/companies/service_terms/certificações/vínculos/
 * indicações/notificações/payment_methods/company_members/organization_members) vive INTEIRA
 * na RPC transacional `public.anonymize_account` (supabase/migrations/20260821000000_*.sql).
 * Esta função NUNCA anonimiza campo a campo — isso saiu do TypeScript de propósito (§4.2):
 * a versão manual anterior cobria 7/12 colunas de workers e 5/11 de companies, o que é PIOR
 * que não existir (dava falsa sensação de cobertura — achado do evaluator C-LGPD-EDGE-4).
 *
 * Ordem que NÃO pode ser invertida (§4.3): deleteUser SÓ depois de outcome='anonimized'.
 * Se a credencial cair antes e a RPC falhar, sobra uma linha com CPF/PIX sem titular capaz de
 * pedir a exclusão de novo.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/asaas.ts';

// ---------------------------------------------------------------------------
// Tipos do retorno da RPC (jsonb) — ver corpo em
// supabase/migrations/20260821000000_lgpd_account_anonymization.sql
// ---------------------------------------------------------------------------

type AnonymizeOutcome =
  | 'invalid_input'
  | 'not_found'
  | 'wallet_has_balance'
  | 'escrow_active'
  | 'scheduled_payment_pending'
  | 'sole_organization_owner'
  | 'anonymized';

interface AnonymizeAccountResult {
  outcome: AnonymizeOutcome;
  balance?: number;
  organization_ids?: string;
  user_id?: string;
  is_worker?: boolean;
  is_member?: boolean;
  company_ids?: string[];
  anonymized_at?: string;
  counts?: Record<string, number>;
}

// Mensagens em português, específicas por outcome de recusa (§4, item 3 do pedido).
// 'not_found' e 'invalid_input' também abortam ANTES do deleteUser (§4.4) — não são
// "nada a fazer", são falha: o chamador não pôde ser reconhecido como titular válido.
function messageForOutcome(result: AnonymizeAccountResult): string {
  switch (result.outcome) {
    case 'wallet_has_balance':
      return `Você tem saldo disponível na carteira (R$ ${Number(result.balance ?? 0).toFixed(2)}). Saque seus fundos antes de excluir a conta.`;
    case 'escrow_active':
      return 'Você tem pagamentos em aberto (escrow reservado ou autorizado). Conclua ou cancele antes de excluir a conta.';
    case 'scheduled_payment_pending':
      return 'Há um pagamento agendado pendente. Efetive ou estorne o pagamento com a empresa/freela antes de excluir a conta.';
    case 'sole_organization_owner':
      return 'Você é o único responsável ativo por uma rede que tem unidades de outras pessoas. Promova outro sócio a responsável antes de excluir a conta.';
    case 'not_found':
      return 'Não foi possível localizar seu vínculo com a plataforma (freela, empresa ou gerente). Entre em contato com o suporte.';
    case 'invalid_input':
      return 'Requisição inválida.';
    default:
      return 'Erro ao processar a exclusão da conta. Tente novamente.';
  }
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

    // --- Auth: extrair userId do JWT, não do body da request ---
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

    // -------------------------------------------------------------------
    // 2. LER ANTES DE APAGAR (§4.1, passo 2) — a RPC vai zerar estas colunas/linhas.
    //    Storage: avatar/cover/logo vivem todos no bucket 'avatars', sob o prefixo
    //    `${userId}/...` (mesma convenção em Profile.tsx e CompanyProfile.tsx — o
    //    path é derivado do userId, não precisa ler a coluna avatar_url/cover_url).
    //    payment_methods: token do cartão da empresa, para revogar no Asaas depois.
    //    (Companies do titular resolvidas com a MESMA ancoragem dupla da RPC — leitura,
    //    não decisão de autorização; a RPC decide de novo, de forma independente.)
    // -------------------------------------------------------------------
    let storageObjectPaths: string[] = [];
    try {
      const { data: storageList } = await supabaseAdmin.storage.from('avatars').list(userId);
      storageObjectPaths = (storageList ?? []).map((f) => `${userId}/${f.name}`);
    } catch (storageListError) {
      console.error('delete-account: falha ao listar storage antes da anonimização', storageListError);
    }

    let cardTokensToRevoke: string[] = [];
    try {
      const { data: companiesOfTitular } = await supabaseAdmin
        .from('companies')
        .select('id')
        .or(`id.eq.${userId},owner_id.eq.${userId}`);
      const companyIdsPre = (companiesOfTitular ?? []).map((c: { id: string }) => c.id);
      if (companyIdsPre.length > 0) {
        const { data: paymentMethods } = await supabaseAdmin
          .from('payment_methods')
          .select('asaas_credit_card_token')
          .in('company_id', companyIdsPre);
        cardTokensToRevoke = (paymentMethods ?? [])
          .map((pm: { asaas_credit_card_token: string }) => pm.asaas_credit_card_token)
          .filter(Boolean);
      }
    } catch (paymentMethodsReadError) {
      console.error('delete-account: falha ao ler payment_methods antes da anonimização', paymentMethodsReadError);
    }

    // -------------------------------------------------------------------
    // 3. RPC transacional — única fonte de anonimização de conteúdo pessoal (§4.2).
    //    Devolve `outcome` estruturado, nunca exceção em caminho esperado.
    // -------------------------------------------------------------------
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('anonymize_account', {
      p_user_id: userId,
    });

    if (rpcError) {
      console.error('delete-account: anonymize_account falhou (erro de infraestrutura)', rpcError);
      return new Response(
        JSON.stringify({ error: 'Erro ao processar a exclusão da conta. Tente novamente.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    const result = rpcData as AnonymizeAccountResult;

    // Fail-closed: qualquer outcome que NÃO seja literalmente 'anonymized' aborta ANTES do
    // deleteUser (§4.3/§4.4) — inclusive 'not_found', que é FALHA, não "nada a fazer".
    if (result.outcome !== 'anonymized') {
      console.warn(`delete-account: anonymize_account recusou (outcome=${result.outcome}) para user ${userId}`);
      return new Response(
        JSON.stringify({ error: messageForOutcome(result), outcome: result.outcome }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // -------------------------------------------------------------------
    // Passos que permanecem no TS (§4.2) — não são dado pessoal, dependem de listas de
    // status espalhadas pelo produto. Usam is_worker/company_ids DEVOLVIDOS PELA RPC —
    // ela já resolveu a ancoragem dupla de empresa; não repetir a decisão aqui.
    // -------------------------------------------------------------------
    const isWorker = !!result.is_worker;
    const companyIds = result.company_ids ?? [];

    if (isWorker) {
      await supabaseAdmin
        .from('applications')
        .update({ status: 'cancelled' })
        .eq('worker_id', userId)
        .in('status', ['pending', 'interview', 'invited', 'hired', 'in_progress']);
    }

    if (companyIds.length > 0) {
      await supabaseAdmin
        .from('jobs')
        .update({ status: 'deleted' })
        .in('company_id', companyIds);

      const { data: companyJobs } = await supabaseAdmin
        .from('jobs')
        .select('id')
        .in('company_id', companyIds);
      const jobIds = (companyJobs ?? []).map((j: { id: string }) => j.id);
      if (jobIds.length > 0) {
        await supabaseAdmin
          .from('applications')
          .update({ status: 'cancelled' })
          .in('job_id', jobIds)
          .in('status', ['pending', 'interview', 'invited', 'hired', 'in_progress']);
      }
    }

    // -------------------------------------------------------------------
    // 4. Efeitos colaterais FORA do Postgres (idempotentes, best-effort — nenhum deles
    //    pode travar a exclusão da conta; a anonimização já foi commitada em (3)).
    // -------------------------------------------------------------------

    // 4a. Storage: remover avatar/cover/logo lidos em (2).
    if (storageObjectPaths.length > 0) {
      const { error: storageRemoveError } = await supabaseAdmin.storage
        .from('avatars')
        .remove(storageObjectPaths);
      if (storageRemoveError) {
        console.error('delete-account: falha ao remover objetos de storage (não bloqueante)', storageRemoveError);
      }
    }

    // 4b. Asaas: os cartões tokenizados lidos em (2) NÃO são revogados aqui. Dívida DECLARADA,
    //     não esquecimento — e a não-ação é deliberada.
    //
    // A primeira versão deste bloco chamava `DELETE {ASAAS_API_URL}/creditCard/{token}`. Esse
    // endpoint foi INVENTADO: não há precedente dele no repositório (o único DELETE ao Asaas é
    // `asaas-release-hold`, que apaga um `payment` — outro recurso) e a documentação pública do
    // Asaas não descreve remoção de token de cartão. Ela documenta `POST /v3/creditCard/tokenize`
    // para criar, e o token é vinculado ao CLIENTE — o caminho documentado para eliminar o dado
    // do cartão parece ser remover o cliente, ação de escopo muito maior, que não cabe decidir
    // dentro de uma rotina de exclusão sem alguém confirmar contra a API real.
    //
    // Por que remover a chamada em vez de deixá-la como "melhor esforço": uma requisição a um
    // endpoint inexistente responde 404, cai no ramo de aviso e loga "revogação não confirmada"
    // em TODA exclusão de conta, para sempre. Isso não é melhor esforço, é ruído que se disfarça
    // de tentativa — quem ler o log conclui que houve uma tentativa legítima que falhou, e não
    // que o endpoint nunca existiu. Guarda que parece funcionar e nunca foi conferida contra a
    // realidade é o padrão que esta leva inteira vem consertando; não vamos estrear mais um.
    // (O código antigo ainda logava o próprio token no `console.warn` — credencial de pagamento
    //  em log, dentro justamente da rotina de LGPD.)
    //
    // Estado real, para não haver ilusão: o token do cartão da empresa CONTINUA existindo no
    // Asaas depois da exclusão da conta. `payment_methods` é apagada pela RPC, então o Worki
    // perde a referência — mas o dado permanece no processador. Registrado em
    // `.harness/memory-bank/debitos-pre-piloto.md`; exige confirmação contra a API do Asaas
    // (ou contato com o suporte deles) ANTES de a rotina ser publicada ao usuário.
    if (cardTokensToRevoke.length > 0) {
      console.warn(
        `delete-account: ${cardTokensToRevoke.length} token(s) de cartao permanecem no Asaas apos ` +
        `a exclusao (endpoint de revogacao nao confirmado). Ver debitos-pre-piloto.md.`
      );
    }

    // 4c. Legado Prisma: DELETE em "Message" por senderid — fora da RPC transacional (§2.1
    //     "Demais tabelas" / §5.3: schema legado não auditado, não entra numa RPC de LGPD
    //     sem verificação). Comportamento mantido, não invertido.
    const { error: legacyMessageError } = await supabaseAdmin
      .from('Message')
      .delete()
      .eq('senderid', userId);
    if (legacyMessageError) {
      console.error('delete-account: falha ao apagar mensagens legadas (não bloqueante)', legacyMessageError);
    }

    // -------------------------------------------------------------------
    // 5. Só agora, com outcome='anonymized' confirmado: apagar a credencial.
    // -------------------------------------------------------------------
    const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteUserError) {
      // A anonimização JÁ FOI COMMITADA — não há o que desfazer, e não fingimos que nada
      // aconteceu. A conta fica anonimizada com credencial viva; o retry é seguro porque
      // anonymize_account é idempotente (§4.1, passo 5).
      console.error(
        `delete-account: conta ${userId} foi anonimizada com sucesso, mas deleteUser falhou — credencial permanece ativa`,
        deleteUserError
      );
      return new Response(
        JSON.stringify({
          error:
            'Seus dados foram anonimizados, mas houve uma falha ao remover o acesso da sua conta. Tente novamente — a operação é segura para repetir.',
          anonymized: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // -------------------------------------------------------------------
    // 6. Sucesso.
    // -------------------------------------------------------------------
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
