-- Migration: Listas salvas do elenco — `team_lists` + `team_list_members` (F2)
-- File: supabase/migrations/20260817000300_team_lists.sql
-- Spec: .harness/spec/listas-elenco/spec.md (R1, R2, R12)
-- Gate: .harness/memory-bank/decisions/ADR-20260817-seam-autorizacao-empresa.md
--
-- ============================================================================
-- POR QUE `is_company_owner` (função nova, NÃO reusa `is_job_owner`)
-- ============================================================================
--   `is_job_owner` (20260817000100, F1) resolve "sou dono deste TURNO?" — ancorado em `job_id`.
--   F2 não tem turno no caminho: a âncora é a empresa diretamente. Inventar um turno fictício
--   para reusar `is_job_owner`, ou inlinar a ancoragem dupla sete vezes (4 policies em
--   `team_lists` + 3 em `team_list_members`), reproduziria uma regra que 20260816210000 já
--   documentou como instável (há linhas em produção com `companies.owner_id` NULL e outras com
--   `owner_id = id`). `is_company_owner` extrai essa âncora para um lugar só.
--
--   O ADR-20260817-seam-autorizacao-empresa.md decidiu EXPLICITAMENTE não fazer `is_job_owner`
--   delegar para `is_company_owner` nesta entrega: corpo de função SQL escrito como string
--   (`AS $$ ... $$`) não gera dependência registrada no catálogo, então um `DROP FUNCTION
--   is_company_owner` (o DOWN desta migration) sucederia sem reclamar e quebraria `is_job_owner`
--   EM RUNTIME, derrubando F1 inteiro. `is_job_owner` e `is_company_owner` são um PAR — qualquer
--   mudança na regra de autorização de empresa (F3 multi-unidade/gerente) tem de alterar as DUAS
--   na mesma migration, e esse é o momento de unificá-las de fato. Ver ADR, seção "Decisão" (2)-(3).
--
--   SECURITY INVOKER (não DEFINER), pelo mesmo motivo de `is_job_owner`: `public.companies` já
--   tem SELECT `USING (true)` para `authenticated` (20260317160000), então como INVOKER a função
--   devolve o mesmo resultado sem criar mais um objeto privilegiado para auditar.
--
-- ============================================================================
-- POR QUE `team_list_members` NÃO TEM POLICY DE UPDATE (LM-11)
-- ============================================================================
--   Uma policy de UPDATE em `team_list_members` permitiria trocar o `worker_id` de uma linha
--   já existente — e o `WITH CHECK` de INSERT (trava de elenco aceito) só roda no INSERT, não
--   num UPDATE. Isso contornaria a trava sem passar pela verificação de `team_connections
--   .status = 'accepted'`. Trocar membro é sempre DELETE + INSERT (é o que `teamListService
--   .setMembers` faz), nunca UPDATE.
--
-- ============================================================================
-- POR QUE NENHUMA POLICY DE `team_lists` REFERENCIA `team_list_members` (sem 42P17)
-- ============================================================================
--   O ciclo que F1 teve de quebrar com dois SECURITY DEFINER mínimos (`shift_call_job_id` /
--   `is_shift_call_target`) não existe aqui: `team_lists` não lê `team_list_members` em nenhuma
--   policy. Só `team_list_members` lê `team_lists` (via EXISTS), numa via só — grafo acíclico,
--   zero DEFINER novo (ver ADR, "Consequências positivas").
--
-- Article 8 INTACTO: nenhuma tabela/RPC de saldo tocada. Nenhum escrow envolvido.
-- Risk: LOW (tabelas novas, organizacionais; nada existente muda de semântica).
--
-- ============================================================================
-- DOWN (rollback)
-- ============================================================================
--   DROP TABLE IF EXISTS public.team_list_members;
--   DROP TABLE IF EXISTS public.team_lists;
--   DROP FUNCTION IF EXISTS public.normalize_team_list();
--   DROP FUNCTION IF EXISTS public.is_company_owner(uuid);
--
--   ATENÇÃO (ver ADR, "Contrato de manutenção conjunta"): se um dia `is_job_owner` passar a
--   delegar para `is_company_owner`, este DOWN precisa mudar também — do jeito que está hoje,
--   as duas funções são independentes e o DROP acima não afeta F1.
--
-- ============================================================================
-- COMO VERIFICAR (read-only, depois de aplicar)
-- ============================================================================
--   V1. Tabelas com RLS ligada e FORCE desligada:
--       SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
--        WHERE oid IN ('public.team_lists'::regclass,'public.team_list_members'::regclass);
--       -- ESPERADO: ambas t | f
--
--   V2. Policies (4 em team_lists: SELECT/INSERT/UPDATE/DELETE; 3 em team_list_members:
--       SELECT/INSERT/DELETE — NENHUMA UPDATE, ver LM-11 acima):
--       SELECT tablename, policyname, cmd FROM pg_policies
--        WHERE tablename IN ('team_lists','team_list_members') ORDER BY 1,3;
--       -- ESPERADO: team_lists com 4 linhas; team_list_members com 3 linhas, sem nenhuma 'UPDATE'.
--
--   V3. anon sem privilégio; authenticated com os grants de tabela esperados:
--       SELECT has_table_privilege('anon','public.team_lists','SELECT')          AS anon_sel,
--              has_table_privilege('authenticated','public.team_lists','SELECT') AS auth_sel,
--              has_table_privilege('authenticated','public.team_lists','INSERT') AS auth_ins,
--              has_table_privilege('authenticated','public.team_lists','DELETE') AS auth_del;
--       -- ESPERADO: f | t | t | t
--
--   V4. GRANT UPDATE é por COLUNA — só `name` (LM-1 do teamListService: enviar qualquer outra
--       coluna no UPDATE, incluindo `updated_at`, devolve 42501 mesmo com RLS satisfeita). Este
--       resultado DEPENDE do `REVOKE UPDATE ON team_lists FROM authenticated` que roda ANTES do
--       `GRANT UPDATE (name)` na seção 5 — GRANT é aditivo em Postgres, então sem o REVOKE um
--       privilégio de tabela concedido em outro lugar tornaria este teste falso-positivo (t | t
--       em vez de f | t) mesmo com o GRANT de coluna presente. Ver F-1 da revisão do evaluator.
--       SELECT has_column_privilege('authenticated','public.team_lists','company_id','UPDATE') AS upd_company_id,
--              has_column_privilege('authenticated','public.team_lists','name','UPDATE')       AS upd_name;
--       -- ESPERADO: f | t
--
--   V5. Sem recursão de policy (o teste que pega o erro 42P17, que só aparece em runtime):
--       BEGIN;
--         SELECT set_config('role','authenticated',true);
--         SELECT set_config('request.jwt.claims','{"sub":"<QUALQUER_UUID>","role":"authenticated"}',true);
--         SELECT count(*) FROM public.team_lists;         -- ESPERADO: 0 linhas, SEM erro
--         SELECT count(*) FROM public.team_list_members;  -- ESPERADO: 0 linhas, SEM erro
--       ROLLBACK;
--
--   V6. Isolamento entre empresas (A13 — a policy nega leitura/escrita cruzada, sem exceção não
--       tratada). Substitua pelos ids reais de duas empresas distintas (A tem ao menos uma linha
--       em team_lists; a sessão abaixo é da empresa B):
--       BEGIN;
--         SELECT set_config('role','authenticated',true);
--         SELECT set_config('request.jwt.claims','{"sub":"<UUID_EMPRESA_B>","role":"authenticated"}',true);
--         SELECT count(*) FROM public.team_lists WHERE company_id = '<UUID_EMPRESA_A>';
--         -- ESPERADO: 0 (RLS filtra a linha alheia — sem erro, sem vazar existência)
--         INSERT INTO public.team_lists (company_id, name, created_by)
--         VALUES ('<UUID_EMPRESA_A>', 'Invasao', '<UUID_EMPRESA_B>');
--         -- ESPERADO: erro "new row violates row-level security policy for table team_lists"
--       ROLLBACK;
--
--   V7. Trava de elenco aceito no INSERT de team_list_members (A14 — defesa central da feature;
--       sem esta prova, a policy fica documentada mas nunca exercitada). Substitua pelos ids de
--       uma lista existente da empresa da sessão e de um worker SEM team_connections 'accepted'
--       com ela (sem vínculo nenhum, ou vínculo 'pending'/'blocked'):
--       BEGIN;
--         SELECT set_config('role','authenticated',true);
--         SELECT set_config('request.jwt.claims','{"sub":"<UUID_DONO_DA_LISTA>","role":"authenticated"}',true);
--         INSERT INTO public.team_list_members (list_id, worker_id)
--         VALUES ('<UUID_LISTA_DA_EMPRESA>', '<UUID_WORKER_NAO_ACEITO>');
--         -- ESPERADO: erro "new row violates row-level security policy for table team_list_members"
--       ROLLBACK;
-- ============================================================================

-- =============================================
-- 1. HELPER
-- =============================================

-- INVOKER de propósito (ver cabeçalho). Par de `is_job_owner` (20260817000100) — juntas são o
-- único ponto do schema onde "esta sessão opera esta empresa" é decidido (ADR-20260817).
CREATE OR REPLACE FUNCTION public.is_company_owner(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
    SELECT (SELECT auth.uid()) IS NOT NULL
       AND p_company_id IS NOT NULL
       AND (
             p_company_id = (SELECT auth.uid())
          OR EXISTS (SELECT 1 FROM public.companies c
                      WHERE c.id = p_company_id AND c.owner_id = (SELECT auth.uid()))
       );
$$;

COMMENT ON FUNCTION public.is_company_owner(uuid) IS
    'A sessão atual opera esta empresa? Ancoragem DUPLA (company_id = auth.uid() OU via '
    'companies.owner_id) — mesma regra de public.is_job_owner (20260817000100), extraída aqui '
    'porque a F2 (listas do elenco) ancora direto na empresa, sem job_id no caminho. PAR de '
    'is_job_owner: as duas mudam juntas quando a regra de autorização de empresa mudar (F3 '
    'multi-unidade/gerente) — ver ADR-20260817-seam-autorizacao-empresa.md, "Contrato de '
    'manutenção conjunta". SECURITY INVOKER: companies já tem SELECT USING(true), não precisa '
    'de privilégio extra.';

REVOKE ALL ON FUNCTION public.is_company_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_company_owner(uuid) TO authenticated, service_role;

-- =============================================
-- 2. TABELAS
-- =============================================

CREATE TABLE IF NOT EXISTS public.team_lists (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    name        text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 60),
    created_by  uuid NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.team_lists IS
    'Agrupamento organizacional interno da empresa sobre o elenco aceito (team_connections). '
    'Não é vaga, não é convite, não move dinheiro (Article 8 intacto) — puro atalho de seleção '
    '(ex.: "Cozinha", "Salão") usado pelos chips do ShiftCallModal (F2, R8/R9). Sem UNIQUE de '
    'nome de propósito: duplicidade é cosmética, fora de escopo (spec, Out-of-scope).';
COMMENT ON COLUMN public.team_lists.created_by IS
    'Quem criou a lista. Hoje = dono da conta; com multi-unidade (F3), o gerente.';

CREATE INDEX IF NOT EXISTS idx_team_lists_company ON public.team_lists (company_id, created_at);

CREATE TABLE IF NOT EXISTS public.team_list_members (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id   uuid NOT NULL REFERENCES public.team_lists(id) ON DELETE CASCADE,
    worker_id uuid NOT NULL REFERENCES public.workers(id)    ON DELETE CASCADE,
    added_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (list_id, worker_id)
);

COMMENT ON TABLE public.team_list_members IS
    'Membro de uma team_lists. Um freela pode estar em N listas (sem exclusividade). O freela '
    'NÃO enxerga esta tabela — é artefato interno da empresa (nenhuma policy concede acesso ao '
    'worker). Linha órfã (worker_id cuja team_connections deixou de ser accepted) fica inerte de '
    'propósito — ver R11 da spec: filtragem acontece só no client, contra o `available` já '
    'calculado no ShiftCallModal, sem trigger de limpeza nem query nova.';

CREATE INDEX IF NOT EXISTS idx_team_list_members_worker ON public.team_list_members (worker_id);

-- =============================================
-- 3. NORMALIZAÇÃO (BEFORE roda antes do CHECK: "   " vira "" e é rejeitado)
-- =============================================

CREATE OR REPLACE FUNCTION public.normalize_team_list()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
    NEW.name       := btrim(NEW.name);
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.normalize_team_list() IS
    'BEFORE INSERT/UPDATE em team_lists: apara espaços do nome ANTES do CHECK (btrim(name)<>'''') '
    'rodar — um nome só de espaços vira string vazia e é rejeitado — e escreve updated_at no '
    'servidor. Por isso o teamListService.renameList só envia {name}: updated_at nunca vem do '
    'client (e o GRANT UPDATE de coluna, seção 5, nem permite).';

REVOKE ALL ON FUNCTION public.normalize_team_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_team_list() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_team_lists_normalize ON public.team_lists;
CREATE TRIGGER trg_team_lists_normalize
    BEFORE INSERT OR UPDATE ON public.team_lists
    FOR EACH ROW EXECUTE FUNCTION public.normalize_team_list();

-- =============================================
-- 4. RLS
--    Policies PRIMEIRO, ENABLE por último (nunca deixar tabela com RLS ligada e sem policy).
-- =============================================

DROP POLICY IF EXISTS "team_lists_select"          ON public.team_lists;
DROP POLICY IF EXISTS "team_lists_insert"           ON public.team_lists;
DROP POLICY IF EXISTS "team_lists_update"           ON public.team_lists;
DROP POLICY IF EXISTS "team_lists_delete"           ON public.team_lists;
DROP POLICY IF EXISTS "team_list_members_select"    ON public.team_list_members;
DROP POLICY IF EXISTS "team_list_members_insert"    ON public.team_list_members;
DROP POLICY IF EXISTS "team_list_members_delete"    ON public.team_list_members;

CREATE POLICY "team_lists_select" ON public.team_lists
    FOR SELECT TO authenticated USING (public.is_company_owner(company_id));
CREATE POLICY "team_lists_insert" ON public.team_lists
    FOR INSERT TO authenticated
    WITH CHECK (public.is_company_owner(company_id) AND created_by = (SELECT auth.uid()));
CREATE POLICY "team_lists_update" ON public.team_lists
    FOR UPDATE TO authenticated
    USING (public.is_company_owner(company_id)) WITH CHECK (public.is_company_owner(company_id));
CREATE POLICY "team_lists_delete" ON public.team_lists
    FOR DELETE TO authenticated USING (public.is_company_owner(company_id));

CREATE POLICY "team_list_members_select" ON public.team_list_members
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.team_lists tl
                    WHERE tl.id = team_list_members.list_id
                      AND public.is_company_owner(tl.company_id)));
-- Trava de elenco fechado (espelha shift_call_targets_insert de 20260817000100): só aceita
-- worker_id com team_connections.status='accepted' para a MESMA empresa da lista.
CREATE POLICY "team_list_members_insert" ON public.team_list_members
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.team_lists tl
        JOIN public.team_connections tc
          ON tc.company_id = tl.company_id
         AND tc.worker_id  = team_list_members.worker_id
         AND tc.status     = 'accepted'
        WHERE tl.id = team_list_members.list_id
          AND public.is_company_owner(tl.company_id)));
CREATE POLICY "team_list_members_delete" ON public.team_list_members
    FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.team_lists tl
                    WHERE tl.id = team_list_members.list_id
                      AND public.is_company_owner(tl.company_id)));
-- Sem policy de UPDATE (LM-11, ver cabeçalho): trocar membro é sempre DELETE + INSERT.

ALTER TABLE public.team_lists        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_lists        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.team_list_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_list_members NO FORCE ROW LEVEL SECURITY;

-- =============================================
-- 5. GRANTS
--    NÃO fazer `REVOKE ALL ... FROM PUBLIC` (lição de 20260318000000: derruba service_role).
-- =============================================

REVOKE ALL ON public.team_lists        FROM anon;
REVOKE ALL ON public.team_list_members FROM anon;
GRANT SELECT, INSERT, DELETE ON public.team_lists TO authenticated;

-- GRANT de COLUNA é ADITIVO em Postgres (F-1, revisão do evaluator): ele só restringe algo se
-- `authenticated` NÃO tiver UPDATE em nível de TABELA. Este projeto tem precedente de tabelas em
-- `public` terminando com privilégio para `authenticated` sem nenhum GRANT explícito no
-- histórico de migrations (20260816210200_lockdown_legacy_prisma_tables.sql documenta
-- "FreelancerReview"/"ClientReview" com SELECT/UPDATE/DELETE órfãos). Por isso o REVOKE roda
-- SEMPRE antes do GRANT de coluna — é no-op se o privilégio de tabela nunca existiu, e é a
-- única garantia real se existir. Mesmo padrão de `20260311300000_restrict_wallet_update_columns.sql`.
REVOKE UPDATE ON public.team_lists FROM authenticated;
-- Só `name` é editável pelo client (LM-1). `company_id`/`created_by`/`created_at` são imutáveis
-- pós-criação; `updated_at` é escrito só pelo trigger (seção 3).
GRANT UPDATE (name) ON public.team_lists TO authenticated;

GRANT SELECT, INSERT, DELETE ON public.team_list_members TO authenticated;
-- LM-11: nenhuma policy de UPDATE existe para esta tabela — trocar membro é sempre DELETE+INSERT
-- (ver seção 4). O REVOKE abaixo é defesa em profundidade pelo mesmo motivo do REVOKE acima:
-- sem ele, a garantia do LM-11 dependeria só da ausência de policy, nunca declarada no grant.
REVOKE UPDATE ON public.team_list_members FROM authenticated;

GRANT ALL ON public.team_lists TO service_role;
GRANT ALL ON public.team_list_members TO service_role;
