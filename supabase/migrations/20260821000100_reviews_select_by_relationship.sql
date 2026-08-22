-- Migration: `reviews` deixa de ser varrível por qualquer conta autenticada (débito pré-piloto #9)
-- File: supabase/migrations/20260821000100_reviews_select_by_relationship.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260821-reviews-por-vinculo.md
-- DDL aprovado (FONTE NORMATIVA): .harness/spec/lgpd-producao/ddl-aprovado.md
-- Molde: 20260816120000 (workers por vínculo) + 20260816130000 (get_profile_reviews).
--
-- PROBLEMA (produção, pré-existente):
--   `reviews` é USING (true) desde 20260309000000:109. Qualquer conta autenticada, sem vínculo
--   nenhum, lê todas as avaliações de qualquer freela e resolve o nome da empresa avaliadora por
--   `reviewer_id` contra `companies` (também USING (true)). pages/company/WorkerPublicProfile.tsx
--   já renderiza exatamente isso.
--   E a RPC get_profile_reviews (SECURITY DEFINER) exige apenas auth.uid() IS NOT NULL — fechar
--   só a tabela deixaria a MESMA leitura aberta pela porta da RPC. As duas metades andam juntas.
--
-- ⚠️ TIPOS (corrigido em 21/08/2026 na aplicação): o contrato assumiu reviews.reviewer_id e
--   reviewed_id como TEXT, lendo a migration legada 20260314000008. Em PRODUÇÃO as duas colunas
--   são **uuid** — o schema real diverge do histórico do repositório (mesma classe do aviso do
--   architect sobre workers/companies terem sido criadas fora de migration). A primeira tentativa
--   de aplicar falhou com 42883 (uuid = text). `try_uuid` continua existindo porque o PARÂMETRO
--   da RPC segue text (contrato do client inalterado) e um valor inválido não pode derrubar a
--   função com 22P02.
--
-- NÃO TOCA SALDO/ESCROW (Article 8). Só leitura.
-- NÃO altera a policy de INSERT de `reviews` nem a de `companies` — ver débitos novos #10 e #11.
-- Risk: MEDIUM (muda leitura de tabela consumida por 4 telas). Reversível em 1 comando.
-- Backup required before production deploy: NO.

-- =============================================
-- 1. CAST SEGURO — reviews.reviewer_id / reviewed_id são TEXT (schema legado, 20260314000008)
--    `::uuid` puro em policy é bomba: uma linha com texto não-uuid derruba o SELECT inteiro com
--    22P02, e o conteúdo de reviewed_id é escolhido pelo atacante no INSERT.
-- =============================================
CREATE OR REPLACE FUNCTION public.try_uuid(p_text text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN p_text::uuid
    END;
$$;

COMMENT ON FUNCTION public.try_uuid(text) IS
    'Cast text->uuid que devolve NULL em vez de 22P02. Existe por causa do PARAMETRO text de '
    'get_profile_reviews (o client passa string) — NAO por causa do tipo das colunas: '
    'reviews.reviewer_id e reviews.reviewed_id sao **uuid** em producao, apesar de a migration '
    'legada 20260314000008 declara-las TEXT. Verificar sempre information_schema.columns do banco '
    'real, nao o historico do repositorio.';

REVOKE EXECUTE ON FUNCTION public.try_uuid(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.try_uuid(text) TO authenticated, service_role;

-- =============================================
-- 2. ÍNDICE DE SUPORTE — a policy filtra por autor.
--    (reviewed_id, direction) já existe: idx_reviews_reviewed_direction (20260816130000).
--    Sem CONCURRENTLY: migration do Supabase roda em transação.
-- =============================================
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON public.reviews (reviewer_id);

-- =============================================
-- 3. FUNÇÃO DE VISIBILIDADE
--    Retorna APENAS boolean; nunca devolve dado.
--    GRAFO DE POLICY (checagem de 42P17, que só aparece em RUNTIME):
--      reviews -> can_view_reviews_of (DEFINER: lê companies/workers como owner, sem RLS)
--                  -> can_view_worker_profile (DEFINER, 20260816120000)
--                       -> team_connections / applications / jobs / companies
--      Nenhuma dessas tabelas tem policy que referencie `reviews`. Grafo ACÍCLICO.
--      ⚠️ Se um dia alguma policy de team_connections/applications/jobs/companies passar a ler
--         `reviews`, ESTE é o ponto que fecha o ciclo. Registrar em ADR ao fazer.
-- =============================================
DROP FUNCTION IF EXISTS public.can_view_reviews_of(text);

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

    -- (1) perfil avaliado é uma EMPRESA que eu opero. Ancoragem DUPLA — mesma regra de
    --     is_company_owner / is_job_owner (ADR-20260817-seam-autorizacao-empresa).
    IF EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id = v_id AND (c.id = v_uid OR c.owner_id = v_uid)
    ) THEN
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
    'Empresa que eu opero (ancoragem dupla) OU freela que eu ja posso ver (can_view_worker_profile, '
    '20260816120000). NAO concede leitura de avaliacoes de EMPRESA a terceiros — esse caminho e a '
    'RPC get_profile_reviews, que serve a prova social do perfil publico /empresa/:id.';

REVOKE EXECUTE ON FUNCTION public.can_view_reviews_of(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_view_reviews_of(uuid) TO authenticated, service_role;

-- =============================================
-- 4. POLICY DE SELECT
--    Policies permissivas são OR'd: enquanto a `USING (true)` existir, nada muda. DROP primeiro.
-- =============================================
-- ATENCAO (corrigido em 21/08/2026, achado de verificacao pos-aplicacao):
-- O nome REAL da policy permissiva em producao e "Public view reviews" (qual = true). Os tres
-- nomes originalmente listados aqui NAO existiam. DROP POLICY de nome inexistente **nao falha** —
-- passa em silencio. Como policies de SELECT sao combinadas por OR, a policy restritiva abaixo
-- nao restringia NADA enquanto a permissiva sobrevivia: a divida #9 apareceria como paga com o
-- buraco aberto. Sempre conferir pg_policies DEPOIS de aplicar.
DROP POLICY IF EXISTS "Public view reviews" ON public.reviews;
DROP POLICY IF EXISTS "Authenticated users can view reviews" ON public.reviews;
DROP POLICY IF EXISTS "Anyone authenticated can view reviews" ON public.reviews;
DROP POLICY IF EXISTS "reviews_select_related" ON public.reviews;

CREATE POLICY "reviews_select_related" ON public.reviews
    FOR SELECT TO authenticated
    USING (
        -- (1) sou o AUTOR (MyJobs: "quais turnos eu já avaliei")
        reviews.reviewer_id = (SELECT auth.uid())
        -- (2) sou o AVALIADO
        OR reviews.reviewed_id = (SELECT auth.uid())
        -- (3) tenho vínculo com o perfil avaliado
        OR public.can_view_reviews_of(reviews.reviewed_id)
    );

-- GRANTS: reafirmação defensiva. NUNCA `REVOKE ALL ... FROM PUBLIC` em TABELA
-- (lição de 20260318000000: derrubou o service_role). Revogar de anon é o padrão do projeto.
REVOKE ALL ON public.reviews FROM anon;
GRANT SELECT, INSERT ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;

-- =============================================
-- 5. FECHAR A OUTRA PORTA — gate de vínculo dentro de get_profile_reviews
--    Reproduz 20260816130000 na íntegra; delta ÚNICO marcado como EMENDA 2026-08-21.
--    Sem isto, a policy acima é teatro: a RPC é DEFINER e devolve o mesmo conteúdo.
-- =============================================
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
        r.reviewer_id::text,
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
                        OR EXISTS (
                            SELECT 1 FROM public.companies co
                            WHERE co.id = public.try_uuid(p_reviewed_id)
                              AND co.owner_id = auth.uid()
                        )
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
      -- EMENDA 2026-08-21 (débito #9): a RPC é DEFINER e era a MESMA varredura que a policy
      -- USING(true) permitia. Gate por direção:
      --   'company' = perfil de EMPRESA avaliada -> ABERTO a qualquer autenticado. É a prova
      --               social do perfil público /empresa/:id (o freela decide antes de aceitar
      --               convite). Os avaliadores freelas já saem mascarados ("Carlos S.").
      --   'worker'  = perfil de FREELA avaliado -> exige vínculo, mesma régua de
      --               can_view_worker_profile (20260816120000). Sem vínculo: ZERO linhas,
      --               sem erro (degrada como lista vazia, não como falha).
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
    'completo so para o dono do perfil avaliado. GATE POR DIRECAO (2026-08-21): p_direction='
    '''company'' (perfil de empresa) e ABERTO a qualquer autenticado — prova social deliberada do '
    'perfil publico /empresa/:id; p_direction=''worker'' (perfil de freela) EXIGE '
    'can_view_worker_profile. Existe porque a policy workers_select_self_or_related impede o freela '
    'de ler a linha de outro freela.';

REVOKE EXECUTE ON FUNCTION public.get_profile_reviews(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_profile_reviews(text, text) TO authenticated, service_role;

-- ============================================================================
-- COMO VERIFICAR (obrigatório após aplicar)
-- ----------------------------------------------------------------------------
-- V1. Conta nova, sem vínculo nenhum (criar na hora):
--       GET /rest/v1/reviews?select=*                          ⇒ [] (antes: base inteira)
--       rpc get_profile_reviews(<freela alheio>, 'worker')     ⇒ []
--       rpc get_profile_reviews(<empresa qualquer>, 'company') ⇒ lista com nomes MASCARADOS
-- V2. Freela dono: rpc(<meu id>, 'worker') ⇒ minhas avaliações, nome da empresa inteiro.
-- V3. Empresa COM vínculo: /company/workers/:id continua mostrando avaliações e nome da empresa.
-- V4. Empresa SEM vínculo com aquele freela: mesma URL ⇒ lista vazia (não erro).
-- V5. /empresa/:id aberto por freela sem vínculo ⇒ avaliações continuam aparecendo (R2 preservada).
-- V6. MyJobs: o botão "Avaliar" continua sumindo nos turnos já avaliados.
-- V7. F12 (badges), quando existir: RPC própria, resultado idêntico antes e depois.
--
-- DOWN (rollback — copiar/colar):
--   DROP POLICY IF EXISTS "reviews_select_related" ON public.reviews;
--   CREATE POLICY "Public view reviews" ON public.reviews   -- nome REAL da policy derrubada
--       FOR SELECT TO authenticated USING (true);
--   -- e restaurar o corpo de get_profile_reviews de 20260816130000 (sem o bloco EMENDA).
--   DROP FUNCTION IF EXISTS public.can_view_reviews_of(uuid);   -- assinatura REAL; (text) nao existe
--   DROP FUNCTION IF EXISTS public.try_uuid(text);
--   DROP INDEX IF EXISTS public.idx_reviews_reviewer;
-- ============================================================================
