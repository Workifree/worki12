-- Corrige anonymize_account: referenciava colunas dropadas na limpeza Asaas/Stripe
-- (workers.address/address_number/postal_code/province/income_value/stripe_account_id/
--  stripe_onboarding_completed e companies.postal_code/address_number/province/
--  income_value/stripe_customer_id), causando 42703 e travando a exclusao de conta
-- inteira (a guarda LGPD bloqueia DELETE em auth.users ate anonimizar, e a anonimizacao
-- falhava). companies.address foi MANTIDA (ainda existe). Descoberto por QA em 02/09/2026.

CREATE OR REPLACE FUNCTION public.anonymize_account(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_now           timestamptz := now();
    v_is_worker     boolean;
    v_company_ids   uuid[];
    v_balance       numeric;
    -- EMENDA 2026-08-22: `v_counts` NASCE com todas as chaves em zero. Antes, as chaves de
    -- domínio viviam dentro de `IF v_is_worker` / `IF cardinality(...) > 0` e simplesmente NÃO
    -- APARECIAM no retorno para quem não é freela nem dono de empresa (a classe GERENTE, por
    -- exemplo). "Chave ausente" e "chave zero" são fatos diferentes: a primeira é indistinguível
    -- de "as âncoras não resolveram, isto é um bug". Quem lê o retorno (Edge Function, auditoria,
    -- suporte) precisa ver a rotina declarar que olhou e não achou nada.
    v_counts        jsonb := jsonb_build_object(
        'service_terms', 0, 'worker_certifications', 0, 'worker_trainings', 0,
        'team_list_members', 0, 'team_lists', 0, 'company_spend_limits', 0,
        'company_monthly_revenue', 0, 'job_series', 0, 'worker_trainings_company', 0,
        'team_connections', 0, 'worker_referrals', 0, 'worker_company_badge_prefs', 0,
        'company_members', 0, 'organization_members', 0, 'notifications', 0,
        'analytics_events', 0,
        'payment_methods', 0, 'applications_redacted', 0, 'jobs_redacted', 0,
        'shift_calls_redacted', 0, 'workers', 0, 'companies', 0
    );
    v_n             integer;
    v_txt           text;          -- EMENDA 2026-08-22 (GUARDA 4, fronteira F13)
    v_is_member     boolean := false;  -- EMENDA 2026-08-22 (classe GERENTE/SOCIO, fronteira F13)
    c_worker_label  constant text := '[Conta Deletada]';
    c_company_label constant text := '[Empresa Deletada]';
    c_redacted      constant text :=
        '[TERMO REMOVIDO — a conta do titular foi excluida a pedido dele (LGPD art. 18, VI). '
        'Este termo nao havia sido aceito e, portanto, nao possui valor probatorio.]';
    -- EMENDA 2026-08-22 — marcador de redacao de TEXTO LIVRE em linha RETIDA.
    -- Marcador e nao NULL, por tres razoes: (1) `jobs.title`/`location` mostram que este schema
    -- tem coluna textual NOT NULL, e a lista de redacao vai crescer -- um NULL em coluna NOT NULL
    -- estouraria DENTRO da transacao destrutiva; (2) a UI da contraparte (recibo, MyJobs) explica
    -- o vazio em vez de parecer defeito; (3) e o mesmo padrao de c_redacted / '[Conta Deletada]'.
    c_redacted_text constant text :=
        '[CONTEUDO REMOVIDO — a conta de quem escreveu este texto foi excluida a pedido do '
        'titular (LGPD art. 18, VI).]';
BEGIN
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT EXISTS (SELECT 1 FROM public.workers w WHERE w.id = p_user_id) INTO v_is_worker;

    -- Ancoragem DUPLA de empresa (mesma regra de is_company_owner / is_job_owner):
    -- companies.id = auth.uid() no caso canônico, owner_id nos registros com dono separado.
    SELECT array_agg(c.id) INTO v_company_ids
    FROM public.companies c
    WHERE c.id = p_user_id OR c.owner_id = p_user_id;
    v_company_ids := coalesce(v_company_ids, ARRAY[]::uuid[]);

    -- ---- EMENDA 2026-08-22: a classe GERENTE/SOCIO tambem e titular ----
    -- Sem isto, `not_found` era devolvido para um usuario LEGITIMO. O gerente da F13, depois de
    -- `accept_manager_invite`, NAO tem linha em `companies` (a casca e APAGADA de proposito,
    -- 20260818100300) e nunca teve linha em `workers`: as duas ancoras acima dao vazio. O socio
    -- de rede que nao e dono de nenhuma unidade cai no mesmo buraco.
    --
    -- Tratar isso apenas como "a Edge Function aborta antes do deleteUser" fecharia o furo de
    -- SEGURANCA (credencial apagada com o vinculo ativo) as custas de criar um furo de DIREITO:
    -- essa pessoa ficaria PERMANENTEMENTE impedida de excluir a propria conta -- violando o
    -- art. 18, VI dentro da rotina que existe justamente para cumpri-lo. O portao correto e
    -- reconhecer a classe, nao recusa-la.
    --
    -- O corpo da rotina ja atende este caso sem nenhuma outra mudanca: os blocos de
    -- workers/companies nao acham linha e nao fazem nada, e os blocos de
    -- company_members/organization_members fecham o vinculo pelo predicado `user_id = $1`
    -- (o ramo por `company_id` recebe array vazio e e inofensivo).
    IF pg_catalog.to_regclass('public.company_members') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.company_members WHERE user_id = $1)'
           INTO v_is_member USING p_user_id;
    END IF;
    IF NOT v_is_member AND pg_catalog.to_regclass('public.organization_members') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = $1)'
           INTO v_is_member USING p_user_id;
    END IF;

    IF NOT v_is_worker AND cardinality(v_company_ids) = 0 AND NOT v_is_member THEN
        -- Agora `not_found` significa mesmo "nao existe titular", e segue valendo como FALHA
        -- para a Edge Function (§4): nunca seguir para o deleteUser depois deste retorno.
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- ---- GUARDA 1: saldo. Article 8 — não zeramos saldo aqui; RECUSAMOS. ----
    SELECT w.balance INTO v_balance FROM public.wallets w WHERE w.user_id = p_user_id;
    IF coalesce(v_balance, 0) > 0 THEN
        RETURN jsonb_build_object('outcome', 'wallet_has_balance', 'balance', v_balance);
    END IF;

    -- ---- GUARDA 2: escrow em aberto ----
    IF EXISTS (
        SELECT 1
        FROM public.escrow_transactions e
        JOIN public.wallets w
          ON w.id = e.company_wallet_id OR w.id = e.worker_wallet_id
        WHERE w.user_id = p_user_id
          AND e.status IN ('reserved', 'authorized')
    ) THEN
        RETURN jsonb_build_object('outcome', 'escrow_active');
    END IF;

    -- ---- GUARDA 3: pagamento prometido e não liquidado (modo A) ----
    IF EXISTS (
        SELECT 1 FROM public.shift_payments sp
        WHERE sp.status = 'scheduled'
          AND (sp.worker_id = p_user_id OR sp.company_id = ANY (v_company_ids))
    ) THEN
        RETURN jsonb_build_object('outcome', 'scheduled_payment_pending');
    END IF;

    -- ---- GUARDA 4 (EMENDA 2026-08-22): ultimo dono de organizacao com unidade de terceiro ----
    -- Fronteira com a F13. Mesma filosofia das guardas 1-3: quando a exclusao causaria dano
    -- IRREVERSIVEL a TERCEIRO, a rotina RECUSA e diz o que fazer -- nao destroi em silencio.
    -- Se este for o UNICO `organization_members.role='owner'` ativo de uma organizacao que ainda
    -- tem unidade que NAO e dele, fechar o vinculo (abaixo) deixaria a rede ORFA: ninguem mais
    -- passa em `is_organization_operator`, e os dois `ON DELETE RESTRICT`
    -- (companies.organization_id e organization_members.organization_id) impedem qualquer
    -- limpeza. Rede inoperavel e inapagavel, com unidades de socios que nao pediram nada.
    -- Remediavel pelo proprio titular: promover outro socio a `owner` e repetir a exclusao.
    -- CONFIRMAR COM JURIDICO (ddl-aprovado 5.4): e bloqueio temporario e sanavel pelo titular,
    -- da mesma classe de `wallet_has_balance`; a leitura de art. 18 VI assumida e que isso NAO e
    -- recusa do direito, e sim pre-condicao operacional. Nao subir a publico sem esse aval.
    -- Executado dinamicamente: esta migration PODE ir ao banco antes da F13.
    IF pg_catalog.to_regclass('public.organization_members') IS NOT NULL THEN
        EXECUTE $q$
            SELECT string_agg(DISTINCT om.organization_id::text, ', ')
            FROM public.organization_members om
            WHERE om.user_id = $1
              AND om.status  = 'active'
              AND om.role    = 'owner'
              AND NOT EXISTS (
                    SELECT 1 FROM public.organization_members o2
                     WHERE o2.organization_id = om.organization_id
                       AND o2.status = 'active'
                       AND o2.role   = 'owner'
                       AND o2.user_id IS DISTINCT FROM $1)
              AND EXISTS (
                    SELECT 1 FROM public.companies c
                     WHERE c.organization_id = om.organization_id
                       AND c.id <> ALL ($2))
        $q$ INTO v_txt USING p_user_id, v_company_ids;

        IF v_txt IS NOT NULL THEN
            RETURN jsonb_build_object('outcome', 'sole_organization_owner',
                                      'organization_ids', v_txt);
        END IF;
    END IF;

    -- =========================================================
    -- A PARTIR DAQUI É DESTRUTIVO. Tudo numa transação só.
    -- =========================================================

    -- ---- service_terms: rascunho é redigido; termo ACEITO é retido (só ip/ua saem) ----
    -- UM ÚNICO UPDATE por linha: o trigger só libera a reescrita quando anonymized_at vai de
    -- NULL para ts NO MESMO statement. Dois UPDATEs separados seriam BARRADOS.
    UPDATE public.service_terms st
       SET term_text           = CASE WHEN st.accepted_at IS NULL THEN c_redacted ELSE st.term_text END,
           accepted_ip         = NULL,
           accepted_user_agent = NULL,
           anonymized_at       = v_now
     WHERE st.anonymized_at IS NULL
       AND (st.worker_id = p_user_id OR st.company_id = ANY (v_company_ids));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('service_terms', v_n);

    -- ---- certificações/treinamentos do freela: DELETE (ramo (c) do trigger F8 barra UPDATE) ----
    IF v_is_worker THEN
        DELETE FROM public.worker_certifications wc WHERE wc.worker_id = p_user_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('worker_certifications', v_n);

        DELETE FROM public.worker_trainings wt WHERE wt.worker_id = p_user_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('worker_trainings', v_n);

        DELETE FROM public.team_list_members tlm WHERE tlm.worker_id = p_user_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('team_list_members', v_n);
    END IF;

    -- ---- EMENDA 2026-08-21: ramo EMPRESA (era mais fino que o ramo freela — §2.1.0, item 4) ----
    IF cardinality(v_company_ids) > 0 THEN
        -- `team_lists` apaga `team_list_members` por cascata INTRA-DOMÍNIO (a FK aponta para
        -- team_lists(id), que é apagada de verdade — essa cascata continua disparando).
        DELETE FROM public.team_lists tl WHERE tl.company_id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('team_lists', v_n);

        -- financial_contact_email / financial_contact_phone = contato de pessoa natural.
        DELETE FROM public.company_spend_limits csl WHERE csl.company_id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('company_spend_limits', v_n);

        DELETE FROM public.company_monthly_revenue cmr WHERE cmr.company_id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('company_monthly_revenue', v_n);

        -- job_template carrega briefing (mesma classe de companies.default_briefing).
        -- Seguro: NÃO há FK de jobs para job_series — as ocorrências materializadas permanecem.
        DELETE FROM public.job_series js WHERE js.company_id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('job_series', v_n);

        -- anotação interna que a empresa escreveu sobre terceiros que CONTINUAM na plataforma.
        DELETE FROM public.worker_trainings wt WHERE wt.company_id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('worker_trainings_company', v_n);
    END IF;

    -- ---- vínculo de elenco: dos dois lados ----
    DELETE FROM public.team_connections tc
     WHERE tc.worker_id = p_user_id OR tc.company_id = ANY (v_company_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('team_connections', v_n);

    -- ---- EMENDA 2026-08-21: indicação entre empresas (F10) — grafo sobre a pessoa ----
    -- TRÊS predicados: a indicação é um triângulo (freela, quem indica, para quem se indica).
    -- A proveniência do BI de aquisição NÃO se perde: vive em team_connections.source='referral'.
    DELETE FROM public.worker_referrals wr
     WHERE wr.worker_id = p_user_id
        OR wr.referring_company_id  = ANY (v_company_ids)
        OR wr.requesting_company_id = ANY (v_company_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('worker_referrals', v_n);

    -- ---- EMENDA 2026-08-21: opt-out de badge por empresa (F12) ----
    -- ⚠️ Este DELETE só é seguro porque a lápide de `workers` seta badges_hidden = true logo
    --    abaixo. Sozinho, ele RESSUSCITARIA os badges que estas linhas suprimiam (o badge é
    --    derivado de applications/jobs/reviews, todos RETIDOS). Os dois andam juntos.
    DELETE FROM public.worker_company_badge_prefs bp
     WHERE bp.worker_id = p_user_id OR bp.company_id = ANY (v_company_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('worker_company_badge_prefs', v_n);

    -- ---- EMENDA 2026-08-22: vinculo de operacao (F13) -- SOFT-REMOVE, nunca DELETE ----
    -- Executado dinamicamente porque esta migration pode ser aplicada ANTES da F13 (em producao
    -- ela E a proxima da fila; em CI a F13 vem antes). `to_regclass` NULL = tabela ainda nao
    -- existe = nada a fazer, sem erro. Quando a F13 subir, o mesmo corpo passa a agir.
    --
    -- POR QUE SOFT E NAO DELETE (ver 2.1): a propria F13 ja decidiu que este vinculo NAO se
    -- apaga (`revoke_company_manager`: "NUNCA DELETE"; `ON DELETE RESTRICT` em company_id). A
    -- rotina de LGPD nao pode ser a porta dos fundos que faz o que a RPC do produto recusa:
    -- apagar a linha levaria junto o registro de QUEM operou a unidade e QUANDO -- e os turnos,
    -- convites e pagamentos que essa pessoa criou continuam existindo, pendurados na UNIDADE, e
    -- ficariam sem referencia de autoria. Reter tambem e errado: `status='active'` e
    -- autorizacao operacional, e quem pediu exclusao nao pode seguir operando.
    --
    -- O QUE SAI: `invited_email` (e-mail de pessoa natural -- dado pessoal DIRETO, nao
    -- pseudonimo, e O item de PII desta tabela) e `invite_token` (credencial portadora: convite
    -- pendente de conta excluida nao pode continuar resgatavel). O que FICA: `user_id` e
    -- `created_by` -- uuid pseudonimo apontando para uma lapide, mesma regua de
    -- `worker_certifications.verified_by_company_id`; e `invited_at`/`accepted_at`, que sao a
    -- trilha de auditoria que justifica o soft.
    --
    -- TRES predicados: (1) a pessoa que sai era gerente de unidades alheias -> perde o acesso;
    -- (2) a EMPRESA que sai tinha gerentes que CONTINUAM na plataforma -> a unidade virou
    -- lapide, ninguem opera lapide, e o e-mail desses terceiros perde a base que o sustentava;
    -- (3) EMENDA 2026-08-22 (C-LGPD-GATE-INVITES) -- convite AINDA PENDENTE emitido por quem
    -- esta saindo, em unidade que NAO e dele.
    --
    -- Por que (3) e obrigatorio e nao existia: quem emite convite de gerente e o operador de
    -- REDE (`invite_company_manager` exige `is_organization_operator`), logo ele convida para
    -- unidades IRMAS, que NAO estao em `v_company_ids`. Sem este ramo, abrir o portao para a
    -- classe gerente/socio (acima) tornou ALCANCAVEL um buraco real: a conta e apagada e ficam
    -- para tras linhas `status='invited'` com `invited_email` DE TERCEIRO e `invite_token` VIVO
    -- (indice unico, 7 dias), assinadas por uma conta que nao existe mais. Credencial portadora
    -- resgatavel emitida por ninguem.
    --
    -- Por que SO `status='invited'` (e nao `created_by` em qualquer status): a linha ATIVA
    -- pertence ao GERENTE, um terceiro que continua na plataforma operando uma unidade que e de
    -- OUTRO dono. `created_by` ali e so a trilha de quem convidou; derrubar o acesso dele porque
    -- o convidante saiu seria dano a terceiro -- a mesma razao pela qual `organization_members`
    -- nao tem ramo por empresa. Simetria EXATA com o predicado de `organization_members` abaixo,
    -- que ja carregava este ramo com esta justificativa.
    IF pg_catalog.to_regclass('public.company_members') IS NOT NULL THEN
        EXECUTE $q$
            UPDATE public.company_members cm
               SET status = CASE WHEN cm.status IN ('invited', 'active')
                                 THEN 'removed' ELSE cm.status END,
                   invited_email = NULL,
                   invite_token  = NULL
             WHERE (cm.user_id = $1
                    OR cm.company_id = ANY ($2)
                    OR (cm.status = 'invited' AND cm.created_by = $1))
               AND (cm.status IN ('invited', 'active')
                    OR cm.invited_email IS NOT NULL
                    OR cm.invite_token  IS NOT NULL)
        $q$ USING p_user_id, v_company_ids;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('company_members', v_n);
    END IF;

    -- ---- EMENDA 2026-08-22: vinculo de rede (F13) -- idem, SEM ramo por empresa ----
    -- Aqui NAO existe predicado por `company_id`: a organizacao pertence tambem as unidades
    -- IRMAS, de outros socios. Excluir a conta de UM socio nao desliga os outros.
    -- Ramo (2): convite AINDA PENDENTE emitido por quem esta saindo. Um convite de rede assinado
    -- por uma conta que deixou de existir nao deve continuar aceitavel -- e carrega o e-mail de
    -- um terceiro. A GUARDA 4 acima ja garantiu que a rede nao fica sem dono ao fazer isto.
    IF pg_catalog.to_regclass('public.organization_members') IS NOT NULL THEN
        EXECUTE $q$
            UPDATE public.organization_members om
               SET status = CASE WHEN om.status IN ('invited', 'active')
                                 THEN 'removed' ELSE om.status END,
                   invited_email = NULL,
                   invite_token  = NULL
             WHERE (om.user_id = $1
                    OR (om.status = 'invited' AND om.created_by = $1))
               AND (om.status IN ('invited', 'active')
                    OR om.invited_email IS NOT NULL
                    OR om.invite_token  IS NOT NULL)
        $q$ USING p_user_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('organization_members', v_n);
    END IF;

    -- ---- `organizations`: RETIDA, nada a fazer (declarado, nao esquecido) ----
    -- `name` e o nome da REDE, compartilhado com as unidades irmas de outros socios; apaga-lo
    -- seria dano a terceiro. `created_by` e uuid pseudonimo apontando para lapide -- mesma regua
    -- de `worker_certifications.verified_by_company_id`. Nao ha coluna de contato.

    -- ---- notificações: texto com nome, valor e link ----
    DELETE FROM public.notifications n WHERE n.user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('notifications', v_n);

    -- ---- EMENDA 2026-08-22 (achado ALTO): analytics_events ----
    -- NAO estava aqui, e a lista da varredura (d)/(e) a descrevia como "apagada pela RPC ou pela
    -- CASCADE de auth.users". As DUAS metades da frase eram falsas: a RPC nao a apagava, e a FK
    -- `analytics_events_user_id_fkey` e NO ACTION, nao CASCADE (conferido em pg_constraint,
    -- 22/08). Ninguem apagava. Pior: sendo NO ACTION, cada linha aqui BLOQUEAVA o deleteUser.
    -- Agora a FK cai na 2B e o dado sai AQUI, dentro da transacao da RPC -- antes da credencial,
    -- e nao dependendo de acao referencial nenhuma (doutrina da lapide, ddl-aprovado 2.1.0).
    -- Conteudo: telemetria comportamental por usuario. Zero valor fiscal ou probatorio.
    DELETE FROM public.analytics_events ae WHERE ae.user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('analytics_events', v_n);

    -- ---- token de cartão da empresa ----
    -- EMENDA 2026-08-22: a versao anterior deste comentario dizia "revogar no Asaas e da Edge
    -- Function". NAO HA REVOGACAO. Nao existe caminho verificado para revogar um creditCardToken
    -- avulso (o token e vinculado ao CLIENTE; o endpoint por token nao tem precedente aqui nem
    -- consta da doc publica). Este DELETE apaga a REFERENCIA do nosso lado; o token PERMANECE no
    -- processador. O token e opaco (nunca PAN/CVV) e wallets.asaas_customer_id sobrevive, entao
    -- remediacao por CLIENTE continua possivel depois. Ver ddl-aprovado 4.1-4b, 5.3 e 5.4 J5, e
    -- ADR-20260822-token-de-cartao-permanece-no-asaas.md.
    IF cardinality(v_company_ids) > 0 THEN
        DELETE FROM public.payment_methods pm WHERE pm.company_id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('payment_methods', v_n);
    END IF;

    -- ---- EMENDA 2026-08-22: TEXTO LIVRE em tabela RETIDA (C-LGPD-CLASS-JOBS/APPLICATIONS) ----
    -- A linha FICA (ancora de shift_payments, BI, integridade referencial); o TEXTO SAI. E o
    -- padrao de ADR-20260821-expurgo-de-conteudo-nao-de-linha, aplicado agora tambem fora do
    -- expurgo por prazo. Corrige uma INCOERENCIA do proprio contrato: a rotina apagava
    -- `companies.default_briefing` ("texto da empresa, pode conter nomes") e DELETAVA
    -- `job_series` ("job_template carrega o briefing -- mesma classe"), mas RETINHA as copias
    -- materializadas em `jobs.briefing` -- que `create_job_series` (20260817000400) escreve
    -- copiando `job_template` LITERALMENTE. Apagar o molde e guardar as copias nao e decisao,
    -- e descuido; e a §5.3 nao registrava esta classe (registrava `shift_payments.note`,
    -- `reviews.comment` e `verified_note`, que sao exatamente a mesma familia).
    --
    -- O que NAO e redigido, e por que (decisao escrita, nao omissao):
    --   `jobs.title` / `jobs.location` -- nao sao narrativa livre: sao o rotulo operacional e o
    --   local do estabelecimento que a CONTRAPARTE (o freela, que continua na plataforma) le no
    --   proprio recibo e no `service_terms.term_text` ACEITO, que e RETIDO INTEGRALMENTE como
    --   prova. Apagar aqui nao elimina a informacao (ela esta congelada no termo) e degrada o
    --   registro de um terceiro sobre uma transacao encerrada. Risco residual em §5.3.
    IF v_is_worker THEN
        -- Texto que o FREELA escreveu SOBRE SI MESMO na candidatura (pull legado). Zero valor
        -- fiscal; `service_terms`/`shift_payments` e que provam a transacao.
        -- `message` (EMENDA 2026-08-22 (2)): coluna legada do modelo pull, 0 linhas e nenhuma
        -- escrita no frontend hoje. Entra pelo NOME e pelo TIPO, nao pelo volume: e texto livre
        -- do titular, mesma classe de `cover_letter` e de `workers.bio` (APAGADO em §2.1).
        -- Classificar coluna vazia custa uma linha; classificar depois que ela enche custa uma
        -- migration nova e um intervalo em que o dado sobreviveu.
        UPDATE public.applications a
           SET cover_letter = CASE WHEN a.cover_letter IS NULL THEN NULL ELSE c_redacted_text END,
               message      = CASE WHEN a.message      IS NULL THEN NULL ELSE c_redacted_text END
         WHERE a.worker_id = p_user_id
           AND (   (a.cover_letter IS NOT NULL AND a.cover_letter IS DISTINCT FROM c_redacted_text)
                OR (a.message      IS NOT NULL AND a.message      IS DISTINCT FROM c_redacted_text));
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('applications_redacted', v_n);
    END IF;

    IF cardinality(v_company_ids) > 0 THEN
        UPDATE public.jobs j
           SET briefing     = CASE WHEN j.briefing     IS NULL THEN NULL ELSE c_redacted_text END,
               description  = CASE WHEN j.description  IS NULL THEN NULL ELSE c_redacted_text END,
               requirements = CASE WHEN j.requirements IS NULL THEN NULL ELSE c_redacted_text END,
               -- F8: exigencia de certificacao em PROSA (<=200, advisory). Mesma classe do
               -- briefing -- a empresa nomeia credencial, condicao e pode nomear pessoa.
               certification_requirement = CASE WHEN j.certification_requirement IS NULL
                                                THEN NULL ELSE c_redacted_text END
         WHERE j.company_id = ANY (v_company_ids)
           AND (   (j.briefing     IS NOT NULL AND j.briefing     IS DISTINCT FROM c_redacted_text)
                OR (j.description  IS NOT NULL AND j.description  IS DISTINCT FROM c_redacted_text)
                OR (j.requirements IS NOT NULL AND j.requirements IS DISTINCT FROM c_redacted_text)
                OR (j.certification_requirement IS NOT NULL
                    AND j.certification_requirement IS DISTINCT FROM c_redacted_text));
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('jobs_redacted', v_n);
    END IF;

    -- `shift_calls.message`: texto que a empresa (ou o GERENTE dela) escreveu no disparo 1->N.
    -- DOIS predicados, e o segundo e obrigatorio: `shift_calls.company_id` NAO TEM FK (uuid nu,
    -- conferido no catalogo de producao -- §2.1.1), entao nada aqui e resolvido por cascata; e
    -- `created_by` e a UNICA forma de alcancar o texto escrito pelo GERENTE, cuja unidade
    -- pertence a outro dono e portanto nunca aparece em `v_company_ids`.
    UPDATE public.shift_calls sc
       SET message = c_redacted_text
     WHERE (sc.company_id = ANY (v_company_ids) OR sc.created_by = p_user_id)
       AND sc.message IS NOT NULL
       AND sc.message IS DISTINCT FROM c_redacted_text;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('shift_calls_redacted', v_n);

    -- ---- LÁPIDE: workers ----
    IF v_is_worker THEN
        UPDATE public.workers w
           SET full_name         = c_worker_label,
               cpf               = NULL,
               phone             = NULL,
               birth_date        = NULL,
               pix_key           = NULL,
               bio               = NULL,
               city              = NULL,
               avatar_url        = NULL,
               cover_url         = NULL,
               primary_role      = NULL,
               roles             = NULL,
               tags              = NULL,
               availability      = NULL,
               availability_days = NULL,
               experience_years  = NULL,
               verified_identity = false,
               -- EMENDA 2026-08-22 — preferencia de perfil declarada no onboarding. Mesma classe
               -- de `primary_role`; NAO retida como enum (a coluna e text sem CHECK).
               goal              = NULL,
               -- EMENDA 2026-08-22 — endereco residencial e renda declarada. Vazias em producao
               -- hoje; a classificacao existe para o dia em que nao estiverem. Residuo do
               -- cadastro de `customer` do Asaas, que nunca chegou a escrever aqui.
               -- EMENDA 2026-08-22 — identificador da pessoa num terceiro (gateway) + a
               -- afirmacao sobre ele. `false` pelo mesmo motivo de `verified_identity`: e um
               -- fato sobre uma identidade que deixou de existir.
               -- EMENDA 2026-08-21 — flags de alcance/exposição (F10/F11/F12).
               -- Não são "boolean sem conteúdo pessoal": governam quem alcança e quem enxerga
               -- o grafo desta pessoa. Ver §2.1 (workers) para o raciocínio de cada uma.
               badges_hidden        = true,   -- fecha "Já trabalhou com" (derivado de dado RETIDO)
               accepts_referrals    = false,  -- não é mais oferecível a outras empresas
               discoverable_for_sos = false,  -- sai do pool de SOS (o predicado de F11 não filtra lápide)
               anonymized_at     = coalesce(w.anonymized_at, v_now)
         WHERE w.id = p_user_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('workers', v_n);
    END IF;

    -- ---- LÁPIDE: companies ----
    IF cardinality(v_company_ids) > 0 THEN
        UPDATE public.companies c
           SET name             = c_company_label,
               cnpj             = NULL,
               city             = NULL,   -- EMENDA 2026-08-21: subconjunto de `address`, que já sai
               email            = NULL,
               address          = NULL,
               website          = NULL,
               description      = NULL,
               industry         = NULL,
               logo_url         = NULL,
               cover_url        = NULL,
               default_briefing = NULL,
               -- EMENDA 2026-08-22 — `company_type` grava 'MEI'/'INDIVIDUAL_PERSON': afirma
               -- pessoa natural de forma literal, onde `cnpj` so permitia inferir. `size` e
               -- estimativa autodeclarada de turnos/mes (o nome mente; ver ddl-aprovado 2.1),
               -- mesma classe de `workers.goal`. Nenhuma das duas tem CHECK -> nao sao enum.
               company_type     = NULL,
               size             = NULL,
               -- EMENDA 2026-08-22 — gemeas exatas das de `workers`: partes de endereco e renda
               -- declarada (cadastro de `customer` do Asaas) + identificador em gateway terceiro.
               -- Vazias hoje; `address` acima ja saiu, e reter as PARTES do endereco seria
               -- re-derivar o que a linha anterior apagou.
               anonymized_at    = coalesce(c.anonymized_at, v_now)
         WHERE c.id = ANY (v_company_ids);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object('companies', v_n);
    END IF;

    RETURN jsonb_build_object(
        'outcome',       'anonymized',
        'user_id',       p_user_id,
        'is_worker',     v_is_worker,
        -- EMENDA 2026-08-22 (C-LGPD-RETURN-CLASSE): sem esta chave, o retorno da classe
        -- GERENTE/SOCIO era `is_worker=false` + `company_ids=[]` -- indistinguivel de "bug: as
        -- ancoras nao resolveram". Quem le precisa saber POR QUE a rotina aceitou o titular.
        'is_member',     v_is_member,
        'company_ids',   to_jsonb(v_company_ids),
        'anonymized_at', v_now,
        'counts',        v_counts
    );
END;
$function$
