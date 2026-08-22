-- Migration: Badges das empresas onde o freela ja trabalhou (F12)
-- File: supabase/migrations/20260817001400_worker_company_badges.sql
-- Spec: .harness/spec/badges-empresas/spec.md
-- DDL aprovado: .harness/spec/badges-empresas/ddl-aprovado.md
-- ADR: .harness/memory-bank/decisions/ADR-20260821-badges-historico-de-empresas.md
--
-- O QUE ESTA MIGRATION FAZ
--   1. `workers.badges_hidden`             — chave-mestra do freela (esconde a secao inteira).
--   2. `worker_company_badge_prefs`        — opt-out por empresa (bisturi).
--   3. `get_worker_company_badges(uuid)`   — leitura DERIVADA dos badges (nenhum badge e armazenado).
--   4. `set_worker_badge_visibility(...)`  — o unico caminho de escrita da preferencia.
--
-- O QUE ELA NAO FAZ (e por que)
--   - NAO cria tabela de badge: badge e derivado de `applications.status='completed'` + `jobs` +
--     `reviews`. Reputacao materializada envelhece errado e exige invalidacao em cada canto
--     (estorno, anonimizacao LGPD, troca de logo). Derivado nao pode divergir da fonte: ele E a fonte.
--   - NAO altera `can_view_worker_profile` (20260816120000). O portao de quem ve o perfil do freela
--     continua exatamente o mesmo; esta feature so o CONSOME.
--   - NAO altera a policy de `reviews` (`USING (true)`, 20260309000000) nem a de `companies`
--     (`USING (true)`, 20260317160000). Ver a sinalizacao no topo do ddl-aprovado: a exposicao de
--     "que nota a empresa X deu" JA EXISTE hoje e e divida propria, com spec propria.
--   - NAO toca `wallets`, `escrow_transactions`, `wallet_transactions`, `shift_payments`, XP nem
--     `completed_jobs_count` (Article 8 intacto). Esconder badge nao desfaz historico.
--   - NAO cria bucket, policy de storage ou signed URL: `companies.logo_url` ja e URL publica do
--     bucket `avatars` (getPublicUrl em CompanyProfile.tsx), servida hoje no feed e em /empresa/:id.
--
-- ORDEM DOS BLOCOS: coluna e tabela ANTES das funcoes. `LANGUAGE sql` valida o corpo no CREATE —
--   funcao antes da tabela quebra a migration inteira (regra do harness, ja paga em e1d7ae8c).
--
-- RECURSAO DE POLICY (42P17): a policy de `worker_company_badge_prefs` referencia APENAS
--   `auth.uid()` — nenhuma subquery em outra tabela. Grafo aciclico por construcao; nenhuma outra
--   policy do schema referencia esta tabela. Nao ha o problema de `shift_calls <-> shift_call_targets`.
--
-- Risk: LOW (uma coluna aditiva com default nao-volatil, uma tabela nova, duas funcoes novas;
--            nenhuma policy existente alterada, nenhuma escrita em dado existente).
-- Backup required before production deploy: NO.
--
-- DOWN (rollback): bloco no fim do arquivo.

-- =============================================
-- 1. CHAVE-MESTRA DO FREELA (DS2)
--    Default `false` = comportamento da tese do produto (historico visivel). O freela desliga com
--    um UPDATE normal — a policy "Workers can update their own profile" (20260309000000:17,
--    USING/WITH CHECK `id = auth.uid()`) ja cobre, sem RPC nova (Article 5).
--    ADD COLUMN com DEFAULT nao-volatil e metadado no PG11+ (sem rewrite da tabela); `workers` e
--    pequena no pre-piloto. Por isso NOT NULL direto e seguro aqui.
-- =============================================
ALTER TABLE public.workers
    ADD COLUMN IF NOT EXISTS badges_hidden boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.workers.badges_hidden IS
    'Chave-mestra do freela sobre a secao "Ja trabalhou com" (F12). true = terceiros recebem ZERO '
    'badges em get_worker_company_badges; o proprio freela continua vendo tudo (senao nao consegue '
    'reverter). NAO apaga applications/reviews/XP — e visibilidade, nao desfazimento de historico.';

-- =============================================
-- 2. OPT-OUT POR EMPRESA (bisturi)
--    Linha existe = o freela ja se manifestou sobre AQUELA empresa. `hidden=false` explicito e
--    reexibicao (mantem a trilha em updated_at em vez de apagar a linha).
--    CASCADE: preferencia de exibicao nao e dado financeiro nem de auditoria — o veto do checklist
--    a ON DELETE CASCADE vale para tabela financeira. Apagar o freela deve apagar a preferencia.
-- =============================================
CREATE TABLE IF NOT EXISTS public.worker_company_badge_prefs (
    worker_id  uuid        NOT NULL REFERENCES public.workers(id)   ON DELETE CASCADE,
    company_id uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    hidden     boolean     NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (worker_id, company_id)
);

COMMENT ON TABLE public.worker_company_badge_prefs IS
    'Preferencia do freela sobre exibir o badge de UMA empresa especifica (F12). Unica escrita nova '
    'da feature — o badge em si e derivado de applications/jobs/reviews, nunca armazenado. Escrita '
    'SOMENTE via set_worker_badge_visibility (nao ha policy de INSERT/UPDATE/DELETE nesta tabela).';

ALTER TABLE public.worker_company_badge_prefs ENABLE ROW LEVEL SECURITY;

-- SELECT: so o dono da preferencia. Terceiro NUNCA le esta tabela direto — o filtro de "oculto"
-- acontece dentro da RPC SECURITY DEFINER, para nao vazar "existe um badge escondido aqui".
DROP POLICY IF EXISTS "wcbp_select_self" ON public.worker_company_badge_prefs;
CREATE POLICY "wcbp_select_self" ON public.worker_company_badge_prefs
    FOR SELECT TO authenticated
    USING (worker_id = auth.uid());

-- Sem policy de INSERT/UPDATE/DELETE de proposito (padrao de `shift_calls`, 20260817000100):
-- toda transicao de estado passa pela RPC, num lugar auditavel.

-- Grants de TABELA. NAO usar `REVOKE ALL ... FROM PUBLIC` aqui: 20260318000000 documenta que isso
-- derrubou o service_role. Revogamos so de `anon`.
REVOKE ALL ON public.worker_company_badge_prefs FROM anon;
GRANT SELECT ON public.worker_company_badge_prefs TO authenticated;
GRANT ALL    ON public.worker_company_badge_prefs TO service_role;

-- =============================================
-- 3. INDICE DE SUPORTE
--    A RPC varre `applications` por (worker_id, status='completed'). Existe
--    idx_applications_worker_job (worker_id, job_id) desde 20260816120000, mas o predicado parcial
--    e bem mais seletivo (a maioria das applications nunca chega a 'completed').
--    Sem CONCURRENTLY: migrations do Supabase rodam dentro de transacao (CONCURRENTLY e proibido em
--    bloco transacional) e as tabelas sao pequenas no pre-piloto.
--    `reviews` ja tem idx_reviews_reviewed_direction (reviewed_id, direction) — 20260816130000.
--    `jobs` ja tem idx_jobs_company (company_id) — 20260816120000.
-- =============================================
CREATE INDEX IF NOT EXISTS idx_applications_worker_completed
    ON public.applications (worker_id, job_id)
    WHERE status = 'completed';

-- =============================================
-- 4. LEITURA DOS BADGES (derivada)
--
--    SECURITY DEFINER porque a feature EXIGE leitura cruzada: a empresa A precisa saber que o freela
--    concluiu turno na empresa B, e a RLS de `applications` (20260317160000) — corretamente — so
--    deixa cada empresa ver as applications dos PROPRIOS turnos. A DEFINER e o furo estreito:
--      - recebe UM worker_id (nunca lista de ids do caller) => nao e oraculo de enumeracao;
--      - devolve 8 colunas fixas: id/nome/logo da empresa, contagem, data, nota, n de notas, hidden;
--      - NUNCA devolve cpf, phone, pix_key, birth_date, e-mail, valor de turno, titulo de vaga,
--        endereco, CNPJ ou qualquer coluna de `jobs`/`applications` alem da agregacao.
--
--    GUARDA (DS10): mora na WHERE e devolve CONJUNTO VAZIO para quem nao pode ver. Nunca
--    RAISE EXCEPTION — excecao distinguiria "freela nao existe" de "existe mas voce nao pode",
--    que e oraculo de existencia (A3).
--
--    auth.uid() dentro de SECURITY DEFINER funciona: o DEFINER troca o ROLE de execucao, nao as
--    claims do JWT (que vivem em request.jwt.claims). Precedentes: get_profile_reviews,
--    validate_application_update, enforce_shift_payment_immutability.
--
--    Tipos: reviews.reviewer_id / reviewed_id sao TEXT no schema legado (20260314000008) enquanto
--    workers.id / companies.id sao UUID — toda comparacao usa cast explicito para text.
-- =============================================
CREATE OR REPLACE FUNCTION public.get_worker_company_badges(p_worker_id uuid)
RETURNS TABLE (
    company_id       uuid,
    company_name     text,
    company_logo_url text,
    shifts_count     integer,
    last_shift_at    text,
    avg_rating       numeric,
    reviews_count    integer,
    hidden           boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH allowed AS (
        SELECT
            (p_worker_id = auth.uid()) AS is_self,
            (
                auth.uid() IS NOT NULL
                AND p_worker_id IS NOT NULL
                AND (
                    p_worker_id = auth.uid()
                    OR (
                        public.can_view_worker_profile(p_worker_id)
                        -- Chave-mestra (DS2): ligada, terceiro nao ve nada. O dono ignora.
                        AND NOT EXISTS (
                            SELECT 1 FROM public.workers w
                            WHERE w.id = p_worker_id AND w.badges_hidden
                        )
                    )
                )
            ) AS can_see
    ),
    shifts AS (
        SELECT
            j.company_id      AS cid,
            count(*)::integer AS shifts_count,
            max(j.start_date) AS last_shift_at
        FROM public.applications a
        JOIN public.jobs j ON j.id = a.job_id
        WHERE a.worker_id = p_worker_id
          AND a.status = 'completed'
          AND j.company_id IS NOT NULL
          AND (SELECT al.can_see FROM allowed al)
        GROUP BY j.company_id
    )
    SELECT
        c.id,
        c.name::text,
        c.logo_url::text,
        s.shifts_count,
        -- DS6: ISO 8601 explicito em UTC. `::text` cru devolve "2026-03-12 10:00:00+00",
        -- que o parser de Date do Safari rejeita.
        to_char(s.last_shift_at::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        rv.avg_rating,
        coalesce(rv.reviews_count, 0)::integer,
        coalesce(p.hidden, false)
    FROM shifts s
    JOIN public.companies c ON c.id = s.cid
    LEFT JOIN LATERAL (
        SELECT
            round(avg(r.rating)::numeric, 1) AS avg_rating,
            count(*)::integer                AS reviews_count
        FROM public.reviews r
        WHERE r.reviewed_id::text = p_worker_id::text
          AND r.direction::text = 'worker'
          -- DS7: ancoragem dupla. A policy de INSERT de reviews grava reviewer_id = auth.uid(),
          -- que e companies.id no caso canonico e owner_id quando o dono e separado. Sem os dois
          -- ramos, a nota some em silencio para as empresas com owner_id distinto.
          AND (
                r.reviewer_id::text = c.id::text
             OR (c.owner_id IS NOT NULL AND r.reviewer_id::text = c.owner_id::text)
          )
    ) rv ON true
    LEFT JOIN public.worker_company_badge_prefs p
           ON p.worker_id = p_worker_id
          AND p.company_id = s.cid
    -- Terceiro nunca recebe linha oculta; o dono recebe TUDO com a flag (DS1 — sem isso, A5
    -- "reexibir" e impossivel: o badge escondido sumiria da propria tela de gerencia).
    WHERE ((SELECT al.is_self FROM allowed al) OR coalesce(p.hidden, false) = false)
    -- DS5: ordem CRONOLOGICA. Proibido ORDER BY avg_rating — ordenar gente por nota e a Opcao B
    -- rejeitada em analytics-operacao/prd.md D4 (score/ranking exige ADR proprio).
    ORDER BY s.last_shift_at DESC NULLS LAST
    LIMIT 100;
$$;

COMMENT ON FUNCTION public.get_worker_company_badges(uuid) IS
    'Badges "ja trabalhou com" de um freela, DERIVADOS de applications.status=completed + jobs + '
    'reviews (nada e materializado). Visivel para o proprio freela ou para quem passa em '
    'can_view_worker_profile (20260816120000) — o portao NAO e alargado por esta funcao. Fora disso '
    'devolve conjunto vazio (nunca excecao: seria oraculo de existencia). Respeita '
    'workers.badges_hidden (global) e worker_company_badge_prefs.hidden (por empresa); o dono ve os '
    'ocultos com hidden=true para poder reexibir. Ordem cronologica — nunca por nota (ver '
    'analytics-operacao/prd.md D4).';

-- =============================================
-- 5. ESCRITA DA PREFERENCIA (unico caminho)
--
--    Nao recebe worker_id: e SEMPRE auth.uid(). Nao ha como um freela escrever a preferencia de
--    outro, nem uma empresa esconder/exibir o badge de alguem.
--
--    DS3 — guarda de elegibilidade: so grava se existir de fato turno concluido entre o chamador e
--    aquela empresa. Sem isso, qualquer freela grava linhas ilimitadas para company_id arbitrario
--    (lixo/abuso de escrita). Retorna boolean para a UI otimista distinguir "gravado" de "ignorado".
-- =============================================
CREATE OR REPLACE FUNCTION public.set_worker_badge_visibility(
    p_company_id uuid,
    p_hidden     boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL OR p_company_id IS NULL OR p_hidden IS NULL THEN
        RETURN false;
    END IF;

    -- Elegibilidade: existe turno CONCLUIDO deste freela nesta empresa?
    IF NOT EXISTS (
        SELECT 1
        FROM public.applications a
        JOIN public.jobs j ON j.id = a.job_id
        WHERE a.worker_id = v_uid
          AND a.status = 'completed'
          AND j.company_id = p_company_id
    ) THEN
        RETURN false;
    END IF;

    INSERT INTO public.worker_company_badge_prefs (worker_id, company_id, hidden, updated_at)
    VALUES (v_uid, p_company_id, p_hidden, now())
    ON CONFLICT (worker_id, company_id)
    DO UPDATE SET hidden = EXCLUDED.hidden, updated_at = now();

    RETURN true;
END;
$$;

COMMENT ON FUNCTION public.set_worker_badge_visibility(uuid, boolean) IS
    'Liga/desliga o badge de UMA empresa no perfil de quem chama (sempre auth.uid(); nao aceita '
    'worker_id). Devolve false sem gravar quando nao ha turno concluido com aquela empresa. NAO '
    'toca applications/reviews/XP/completed_jobs_count — esconder e exibicao, nao desfazimento.';

-- =============================================
-- 6. GRANTS DE FUNCAO
--    EXECUTE e concedido a PUBLIC por padrao no Postgres — o que exporia as RPCs ao papel `anon`
--    via PostgREST. Revogamos e concedemos explicitamente.
--    NOTA: REVOKE em FUNCAO, nao em TABELA — a licao de 20260318000000 (REVOKE ALL em tabela
--    derrubou o service_role) nao se aplica aqui.
--    Sem GRANT, `.rpc()` do supabase-js falha (PostgREST precisa do privilegio no schema cache).
-- =============================================
REVOKE EXECUTE ON FUNCTION public.get_worker_company_badges(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_worker_company_badges(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_worker_company_badges(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.set_worker_badge_visibility(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_worker_badge_visibility(uuid, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_worker_badge_visibility(uuid, boolean) TO authenticated, service_role;

-- =============================================
-- DOWN (rollback manual — copiar/colar, nesta ordem):
--   DROP FUNCTION IF EXISTS public.set_worker_badge_visibility(uuid, boolean);
--   DROP FUNCTION IF EXISTS public.get_worker_company_badges(uuid);
--   DROP TABLE    IF EXISTS public.worker_company_badge_prefs;
--   DROP INDEX    IF EXISTS public.idx_applications_worker_completed;
--   ALTER TABLE   public.workers DROP COLUMN IF EXISTS badges_hidden;
--   -- e remover <CompanyBadges> de WorkerPublicProfile.tsx e Profile.tsx.
--   -- Nada a restaurar: a migration nao altera policy existente nem escreve em dado existente.
-- =============================================
