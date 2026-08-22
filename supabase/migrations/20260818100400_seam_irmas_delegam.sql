-- Migration: as funcoes-irma do seam passam a DELEGAR para is_company_owner, nao imitar
-- File: supabase/migrations/20260818100400_seam_irmas_delegam.sql
-- Achado: security-reviewer (F13 pos-Fase-2), ALTO.
--
-- O DEFEITO, EM UMA FRASE
-- ============================================================================
-- `can_view_worker_profile`, `list_team_connection_cards` (20260821000300) e
-- `can_view_reviews_of` + o ramo de mascaramento de `get_profile_reviews` (20260821000100,
-- redefinida por ultimo em 20260821000300) HARDCODAM a ancoragem
-- `company_id = auth.uid() OR company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())`
-- inline, em vez de chamar `public.is_company_owner(...)`. Foram reescritas em 21/08/2026, DEPOIS
-- de o contrato do F13 (multi-unidade) ter sido congelado em 18/08/2026 — nao conheciam o seam.
--
-- CONSEQUENCIA com F13 no ar: um gerente (company_members) ou socio/operador
-- (organization_members) da unidade NAO enxergaria CPF/telefone/PIX do elenco, nem cartoes do
-- elenco, nem o nome completo do avaliador — quebra o D5 em silencio (RLS, nenhum teste de
-- frontend pega).
--
-- O QUE ESTA MIGRATION FAZ, E SO ISSO: troca a ancoragem inline por `public.is_company_owner(...)`
-- nas quatro funcoes. NENHUMA outra semantica muda: ramo self, ramo operacional via `applications`,
-- projecao fechada de seis campos, gate por p_direction de get_profile_reviews — todos idênticos.
--
-- BASELINE (a versao MAIS RECENTE de cada uma, nao a original — a mesma armadilha que ja reverteu
-- um fix de producao nesta sessao):
--   can_view_worker_profile     <- 20260821000300 (DS-PII-1: perdeu o ramo 'pending'; NAO reintroduzir)
--   list_team_connection_cards  <- 20260821000300 (DS-PII-2; unica definicao)
--   can_view_reviews_of         <- 20260821000100 (unica definicao; nao redefinida em 20260821000300)
--   get_profile_reviews         <- 20260821000300 (DS-PII-3: reviewer_id mascarado por vinculo)
--
-- Article 8 intacto: nenhuma dessas quatro toca saldo/escrow. So leitura.
-- Risk: LOW (restringe apenas quem hoje falsamente NAO enxerga; nao abre superficie nova de leitura
-- alem do que is_company_owner ja concede a is_job_owner/jobs/team_lists/etc.).
-- Backup required before production deploy: NO.
-- ============================================================================


-- ============================================================================
-- 0. ASSERCAO — is_company_owner precisa existir com a assinatura esperada antes de delegar.
--    Falha fechado se o seam (20260818100200) nao foi aplicado ainda.
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'is_company_owner'
          AND pg_get_function_identity_arguments(p.oid) = 'p_company_id uuid'
    ) THEN
        RAISE EXCEPTION
          'ASSERCAO: public.is_company_owner(uuid) nao existe. Aplicar 20260818100200 antes '
          'desta migration. HALT -> architect.';
    END IF;
END $$;


-- ============================================================================
-- 1. can_view_worker_profile — delega nos dois ramos de empresa (elenco + operacional)
--    Baseline: 20260821000300 (DS-PII-1). SO a ancoragem muda.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.can_view_worker_profile(p_worker_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    -- Sem sessão (anon) -> nada.
    IF v_uid IS NULL OR p_worker_id IS NULL THEN
        RETURN false;
    END IF;

    -- (0) O próprio freela lê a própria linha (Profile, Dashboard, Sidebar, ProtectedRoute,
    --     DepositModal, onboarding). Mantém `select('*')` funcionando para o dono do dado.
    IF p_worker_id = v_uid THEN
        RETURN true;
    END IF;

    -- (1) Vínculo de elenco — DS-PII-1: SÓ 'accepted'. 'pending' foi removido de propósito:
    --     é a empresa dizendo "quero", escrito unilateralmente por ela (`tc_insert_company`
    --     só exige ser dona e nascer 'pending'). Enquanto 'pending' concedesse leitura, o uuid
    --     do freela virava credencial portadora de cpf/phone/pix_key/birth_date — ver
    --     ADR-20260821-uuid-de-freela-nao-e-credencial-de-pii. 'blocked' continua sem conceder
    --     (veto explícito do freela). NAO REINTRODUZIR o ramo 'pending' aqui.
    --     Ancoragem: DELEGA para is_company_owner (20260818100400) — antes hardcodada inline,
    --     por isso um gerente/operador de multi-unidade nao enxergava o proprio elenco.
    IF EXISTS (
        SELECT 1
        FROM public.team_connections tc
        WHERE tc.worker_id = p_worker_id
          AND tc.status = 'accepted'
          AND public.is_company_owner(tc.company_id)
    ) THEN
        RETURN true;
    END IF;

    -- (2) Vínculo operacional: o freela tem candidatura OU convite de turno (ambos vivem em
    --     `applications`) em um turno desta empresa. Cobre CompanyJobCandidates, CompanyJobs,
    --     CompanyDashboard, CompanyMessages, ReceiptView, relatório de ordens e o BI financeiro.
    --     Sem filtro de status: histórico concluído/cancelado precisa continuar legível para
    --     recibo, relatório e BI. Inalterado por DS-PII-1.
    --     Ancoragem: DELEGA para is_company_owner (20260818100400) — idem.
    IF EXISTS (
        SELECT 1
        FROM public.applications a
        JOIN public.jobs j ON j.id = a.job_id
        WHERE a.worker_id = p_worker_id
          AND public.is_company_owner(j.company_id)
    ) THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

COMMENT ON FUNCTION public.can_view_worker_profile(uuid) IS
    'Decide se auth.uid() pode ler a linha de um worker: o próprio freela, ou empresa com '
    'team_connections ACCEPTED (DS-PII-1, 20260821000300 — o ramo "pending" foi removido: '
    'nascia de INSERT unilateral da empresa e virava credencial de PII), ou empresa com '
    'applications do freela em turno seu. Retorna só boolean (não vaza dado). Usada na policy '
    'de SELECT de workers e em can_view_reviews_of/get_profile_reviews. Ancoragem de empresa '
    'DELEGA para public.is_company_owner (20260818100400) — cobre gerente/operador de '
    'multi-unidade, nao so owner_id.';

REVOKE EXECUTE ON FUNCTION public.can_view_worker_profile(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_view_worker_profile(uuid) TO authenticated, service_role;


-- ============================================================================
-- 2. list_team_connection_cards — delega, sem materializar `mine` na unha
--    Baseline: 20260821000300 (DS-PII-2). SO a ancoragem muda.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_team_connection_cards()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_out jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    -- Ancoragem: DELEGA para is_company_owner (20260818100400) — antes materializava a CTE
    -- `mine` so com owner_id/id, deixando de fora gerente (company_members) e socio/operador
    -- (organization_members) da unidade.
    SELECT coalesce(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb)
      INTO v_out
      FROM (
        SELECT tc.created_at AS ord, jsonb_build_object(
                   'id',          tc.id,
                   'company_id',  tc.company_id,
                   'worker_id',   tc.worker_id,
                   'status',      tc.status,
                   'source',      tc.source,
                   'blocked_by',  tc.blocked_by,
                   'created_at',  tc.created_at,
                   'accepted_at', tc.accepted_at,
                   'updated_at',  tc.updated_at,
                   -- Projeção EXAUSTIVA e fechada — NUNCA to_jsonb(w.*), que vazaria toda
                   -- coluna futura de `workers` sozinha. Nenhum destes seis é PII.
                   'worker', jsonb_build_object(
                       'id',             w.id,
                       'full_name',      w.full_name,
                       'avatar_url',     w.avatar_url,
                       'primary_role',   w.primary_role,
                       'rating_average', w.rating_average,
                       'city',           w.city
                   )
               ) AS x
          FROM public.team_connections tc
          JOIN public.workers w ON w.id = tc.worker_id
         WHERE public.is_company_owner(tc.company_id)
      ) s;

    RETURN jsonb_build_object('outcome', 'ok', 'items', v_out);
END;
$$;

COMMENT ON FUNCTION public.list_team_connection_cards() IS
    'DS-PII-2 — todas as conexões (pending/accepted/blocked) da empresa da sessão, com projeção '
    'fechada e exaustiva de workers (id, full_name, avatar_url, primary_role, rating_average, '
    'city — nenhum PII). Existe porque DS-PII-1 esvazia o embed worker:workers(...) de '
    'listAllConnections para linhas pending. SEM PARAMETRO de proposito (varredura com passo de '
    'uuid seria possivel se aceitasse "por qual empresa"). Nao toca saldo. Ancoragem DELEGA para '
    'public.is_company_owner (20260818100400) — cobre gerente/operador de multi-unidade.';

REVOKE EXECUTE ON FUNCTION public.list_team_connection_cards() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_team_connection_cards() TO authenticated, service_role;


-- ============================================================================
-- 3. can_view_reviews_of — delega o ramo "empresa que eu opero"
--    Baseline: 20260821000100 (unica definicao). SO a ancoragem muda.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.can_view_reviews_of(p_reviewed_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_id  uuid := p_reviewed_id;   -- coluna ja e uuid em producao (ver nota de tipos no cabecalho)
BEGIN
    IF v_uid IS NULL OR v_id IS NULL THEN
        RETURN false;
    END IF;

    -- (0) o dono do perfil avaliado (caso canônico: companies.id = workers.id = auth.uid()).
    IF v_id = v_uid THEN
        RETURN true;
    END IF;

    -- (1) perfil avaliado é uma EMPRESA que eu opero. Ancoragem: DELEGA para is_company_owner
    --     (20260818100400) — antes hardcodada inline (so owner_id/id), deixando de fora
    --     gerente/operador de multi-unidade.
    IF public.is_company_owner(v_id) THEN
        RETURN true;
    END IF;

    -- (2) perfil avaliado é um FREELA que eu já posso ver (elenco pending/accepted OU vínculo
    --     operacional via applications). Reusa a régua de 20260816120000 — uma decisão só, num
    --     lugar só. Quando a autorização de empresa mudar (F3 multi-unidade), muda lá e vale aqui.
    IF EXISTS (SELECT 1 FROM public.workers w WHERE w.id = v_id)
       AND public.can_view_worker_profile(v_id) THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

COMMENT ON FUNCTION public.can_view_reviews_of(uuid) IS
    'Decide se auth.uid() pode ler as avaliacoes RECEBIDAS por um perfil. Retorna so boolean. '
    'Empresa que eu opero (DELEGA para public.is_company_owner, 20260818100400 — cobre '
    'gerente/operador de multi-unidade) OU freela que eu ja posso ver (can_view_worker_profile, '
    '20260816120000). NAO concede leitura de avaliacoes de EMPRESA a terceiros — esse caminho e a '
    'RPC get_profile_reviews, que serve a prova social do perfil publico /empresa/:id.';

REVOKE EXECUTE ON FUNCTION public.can_view_reviews_of(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_view_reviews_of(uuid) TO authenticated, service_role;


-- ============================================================================
-- 4. get_profile_reviews — o ramo de mascaramento (reviewer_id + reviewer_name) delega
--    Baseline: 20260821000300 (DS-PII-3, redefinicao mais recente). SO a ancoragem muda:
--    o gate por p_direction, o CASE de reviewer_name, a projecao de colunas e a ordenacao
--    ficam IDENTICOS.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_profile_reviews(
    p_reviewed_id text,
    p_direction   text
)
RETURNS TABLE (
    review_id     text,
    rating        numeric,
    comment       text,
    created_at    text,
    reviewer_id   text,
    reviewer_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        r.id::text,
        r.rating::numeric,
        r.comment::text,
        -- ISO 8601 explícito em UTC (parser estrito do Safari rejeita o formato nativo).
        to_char(r.created_at::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        -- DS-PII-3: reviewer_id só sai quando o avaliador é EMPRESA (companies.id é público,
        -- SELECT USING (true)) OU quando o caller é o DONO do perfil avaliado — MESMO
        -- predicado que já mascara reviewer_name abaixo. Ancoragem: DELEGA para
        -- is_company_owner (20260818100400) — antes hardcodada inline.
        (CASE
            WHEN p_direction = 'worker' THEN r.reviewer_id::text
            WHEN (
                public.try_uuid(p_reviewed_id) = auth.uid()
                OR public.is_company_owner(public.try_uuid(p_reviewed_id))
            ) THEN r.reviewer_id::text
            ELSE NULL
        END)::text,
        (CASE
            -- Avaliador é EMPRESA: nome comercial, sem mascaramento.
            WHEN p_direction = 'worker' THEN (
                SELECT c.name::text
                FROM public.companies c
                WHERE c.id = r.reviewer_id
            )
            -- Avaliador é FREELA (pessoa física): completo só para o dono do perfil avaliado.
            ELSE (
                SELECT CASE
                    WHEN (
                        public.try_uuid(p_reviewed_id) = auth.uid()
                        OR public.is_company_owner(public.try_uuid(p_reviewed_id))
                    ) THEN nullif(btrim(coalesce(w.full_name, '')), '')::text
                    ELSE public.mask_display_name(w.full_name)
                END
                FROM public.workers w
                WHERE w.id = r.reviewer_id
            )
        END)::text
    FROM public.reviews r
    WHERE auth.uid() IS NOT NULL
      AND public.try_uuid(p_reviewed_id) IS NOT NULL
      AND p_direction IN ('worker', 'company')
      -- Gate por direção (EMENDA 2026-08-21, 20260821000100):
      --   'company' = perfil de EMPRESA avaliada -> ABERTO a qualquer autenticado. É a prova
      --               social do perfil público /empresa/:id (o freela decide antes de aceitar
      --               convite). Os avaliadores freelas saem mascarados no NOME e, a partir de
      --               DS-PII-3, também com reviewer_id NULL para quem não é o dono.
      --   'worker'  = perfil de FREELA avaliado -> exige vínculo, mesma régua de
      --               can_view_worker_profile. Sem vínculo: ZERO linhas, sem erro.
      AND (
            p_direction = 'company'
         OR public.can_view_worker_profile(public.try_uuid(p_reviewed_id))
      )
      AND r.reviewed_id = public.try_uuid(p_reviewed_id)
      AND r.direction::text = p_direction
    ORDER BY r.created_at DESC;
$$;

COMMENT ON FUNCTION public.get_profile_reviews(text, text) IS
    'Avaliacoes recebidas por um perfil, ja com o nome de exibicao do avaliador. Deriva os '
    'avaliadores da propria tabela reviews (nao aceita lista de ids do caller) — nao e oraculo de '
    'enumeracao de nomes. Freela avaliador aparece mascarado ("Carlos S.") para terceiros e '
    'completo so para o dono do perfil avaliado. GATE POR DIRECAO (20260821000100): p_direction='
    '''company'' (perfil de empresa) e ABERTO a qualquer autenticado; p_direction=''worker'' '
    '(perfil de freela) EXIGE can_view_worker_profile. DS-PII-3 (20260821000300): reviewer_id sai '
    'NULL quando o avaliador e freela e o caller nao e o dono do perfil avaliado — mesmo '
    'predicado que ja mascarava reviewer_name, fechando a segunda instancia da classe descrita em '
    'ADR-20260821-uuid-de-freela-nao-e-credencial-de-pii. Ancoragem "e o dono/opera a empresa" '
    'DELEGA para public.is_company_owner (20260818100400) — cobre gerente/operador de '
    'multi-unidade, que antes ficava mascarado como terceiro no proprio perfil.';

REVOKE EXECUTE ON FUNCTION public.get_profile_reviews(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_profile_reviews(text, text) TO authenticated, service_role;


-- ============================================================================
-- COMO VERIFICAR (obrigatório após aplicar — NÃO aplicar em produção sem revisão humana)
-- ----------------------------------------------------------------------------
-- V1. Gerente (company_members status='active') de uma unidade com elenco 'accepted':
--       GET /rest/v1/workers?id=eq.<worker-do-elenco>  ⇒ linha inteira (antes: []).
-- V2. Mesmo gerente: rpc list_team_connection_cards() ⇒ inclui os cartões da unidade dele
--       (antes: outcome='ok', items=[] mesmo com conexões existentes).
-- V3. Sócio/operador (organization_members status='active', role IN ('owner','operator')):
--       rpc get_profile_reviews(<empresa-da-rede>, 'company') chamada pelo PRÓPRIO sócio ⇒
--       reviewer_id preenchido (antes: NULL, tratado como terceiro).
-- V4. can_view_worker_profile ainda NÃO concede para 'pending' nem para 'blocked' (DS-PII-1
--       intacto) — testar com conexão pending: workers?id=eq.<worker> ⇒ [].
-- V5. Owner "clássico" (companies.owner_id = auth.uid(), sem multi-unidade) continua enxergando
--       tudo igual — is_company_owner cobre esse ramo como antes.
--
-- DOWN (rollback — restaura o corpo hardcoded, copiar da versão anterior de cada arquivo):
--   can_view_worker_profile     <- corpo de 20260821000300 (antes desta migration)
--   list_team_connection_cards <- corpo de 20260821000300 (antes desta migration)
--   can_view_reviews_of         <- corpo de 20260821000100 (antes desta migration)
--   get_profile_reviews         <- corpo de 20260821000300 (antes desta migration)
-- ============================================================================
