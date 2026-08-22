-- Migration: list_team_connection_cards avalia a autorizacao por EMPRESA, nao por CONEXAO
-- Achado: C-PERF-LIST-CARDS
-- Contexto: DS-PII-2 (20260821000300) criou a funcao; 20260821001000 trocou a CTE `mine` por
--           `is_company_owner(tc.company_id)` para cobrir gerente/socio (multi-unidade).
--
-- O QUE MUDA: so o predicado do WHERE. Projecao, GRANTs, SECURITY DEFINER, search_path e o
-- contrato de retorno ficam IDENTICOS. Nenhuma coluna a mais sai da funcao.
--
-- POR QUE:
-- `WHERE public.is_company_owner(tc.company_id)` e avaliado UMA VEZ POR LINHA de
-- `team_connections`. Conferido no plano de execucao (EXPLAIN em producao, 22/08/2026): a funcao
-- aparece como `Filter: is_company_owner(company_id)`, ou seja, NAO e inlined pelo planejador
-- apesar de ser LANGUAGE sql/STABLE. E cada chamada faz ate quatro EXISTS (dois em
-- `is_company_owner` + dois em `session_operates_company_membership`).
--
-- Custo, portanto, e O(conexoes) — e `team_connections` e exatamente a tabela que cresce com o
-- negocio (empresas x freelas do elenco), enquanto `companies` do titular e um punhado. Com
-- 10 unidades x 50 freelas sao 500 linhas => ~2000 lookups por abertura de tela, contra 10.
--
-- A forma nova avalia por EMPRESA: O(empresas do titular).
--
-- POR QUE E EQUIVALENTE, e nao aproximado (verificado no catalogo, nao presumido):
-- `team_connections.company_id` tem FK para `companies` (confirmada em pg_constraint) e ha ZERO
-- linhas orfas hoje. Logo `is_company_owner(tc.company_id)` e
-- `tc.company_id IN (SELECT c.id FROM companies c WHERE is_company_owner(c.id))` selecionam
-- exatamente o mesmo conjunto: todo company_id de uma conexao existe em `companies`.
-- Sem a FK, a forma IN seria mais ESTREITA (descartaria orfao) — por isso a FK e premissa, e esta
-- escrita aqui para quem um dia pensar em remove-la.
--
-- NAO volta a CTE `mine` de 20260821000300: ela materializava so `owner_id`/`id` e deixava de fora
-- gerente (`company_members`) e socio/operador (`organization_members`). O ganho de custo nao pode
-- vir as custas de reintroduzir aquele buraco de autorizacao — por isso a delegacao a
-- `is_company_owner` permanece, so muda ONDE ela e avaliada.
--
-- Article 8: nao toca saldo.

CREATE OR REPLACE FUNCTION public.list_team_connection_cards()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_out jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

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
                   -- Projecao EXAUSTIVA e fechada — NUNCA to_jsonb(w.*), que vazaria toda
                   -- coluna futura de `workers` sozinha. Nenhum destes seis e PII.
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
         -- Ancoragem: MESMA regra de 20260821001000 (delega a is_company_owner, cobrindo
         -- gerente e socio/operador). O que muda e a GRANULARIDADE da avaliacao: uma vez por
         -- empresa do titular, em vez de uma vez por conexao. Ver cabecalho.
         WHERE tc.company_id IN (
                   SELECT c.id FROM public.companies c
                    WHERE public.is_company_owner(c.id)
               )
      ) s;

    RETURN jsonb_build_object('outcome', 'ok', 'items', v_out);
END;
$function$;

COMMENT ON FUNCTION public.list_team_connection_cards() IS
    'Cartoes do Elenco com projecao FECHADA de 6 campos nao-PII (DS-PII-2). SECURITY DEFINER '
    'porque can_view_worker_profile nega leitura de `workers` para conexao pending. Autorizacao '
    'delegada a is_company_owner, avaliada por EMPRESA (nao por conexao) — equivalencia garantida '
    'pela FK team_connections.company_id -> companies. Ver 20260822000200.';

REVOKE ALL ON FUNCTION public.list_team_connection_cards() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_team_connection_cards() TO authenticated, service_role;

-- ============================================================================
-- DOWN: trocar o predicado do WHERE de volta para a forma por-linha:
--
--          WHERE public.is_company_owner(tc.company_id)
--
--       ...mantendo TODO o resto do corpo acima intacto. Nao ha mais nada a reverter: esta
--       migration muda um predicado e nada alem dele.
--
-- ⚠️ NAO diga "reaplicar o corpo de 20260821001000". Esse arquivo NAO existe em
--    `supabase/migrations/` deste repositorio — ele vive na branch `feat/multi-unidade`
--    (worktree), embora ja esteja APLICADO em producao. Um DOWN que aponta para artefato
--    irrecuperavel a partir do repo nao e reversibilidade, e sim arqueologia: quem precisar
--    reverter estara sob pressao e nao vai ter onde procurar. Por isso o DOWN acima e literal.
--
-- MEDIDO em producao (22/08/2026), e nao presumido:
--   forma antiga  `WHERE is_company_owner(tc.company_id)`
--     -> Filter aplicado em `team_connections`; cost 26.11; Execution Time 25.657 ms
--   forma nova    `WHERE tc.company_id IN (SELECT c.id FROM companies WHERE is_company_owner(c.id))`
--     -> Filter aplicado em `companies`, "Rows Removed by Filter: 7" (uma chamada por EMPRESA),
--        Bitmap Index Scan em idx_team_connections_company; cost 12.67; Execution Time 1.790 ms
--   Confirma O(empresas) no lugar de O(conexoes). Com 4 linhas na tabela o ganho absoluto e
--   irrelevante HOJE; o que a medicao estabelece e a FORMA do plano, que e o que escala.
-- VERIFICACAO pos-aplicacao:
--   1. Projecao inalterada:
--      SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='list_team_connection_cards';
--      -> conferir que continuam os MESMOS 6 campos em 'worker' e nenhum a mais.
--   2. anon sem EXECUTE:
--      SELECT has_function_privilege('anon','public.list_team_connection_cards()','EXECUTE');
--      -> false
-- ============================================================================
