-- Migration: remove as policies legadas que autorizam empresa POR FORA do seam
-- File: supabase/migrations/20260822000000_drop_policies_fora_do_seam.sql
-- Contrato: .harness/spec/multi-unidade/ddl-aprovado.md §6, criterio Q3/A6
--
-- ACHADO (22/08/2026, rodando Q3 contra producao DEPOIS de aplicar a Fase 2):
-- a 20260818100200 CRIOU jobs_insert/update/delete_company_owner (via is_company_owner) mas
-- NAO removeu as legadas. Sobraram, em producao:
--
--   companies | "Company owner can view own company" | SELECT | owner_id = auth.uid()
--   jobs      | "Company owner can manage jobs"      | ALL    | company_id IN (SELECT id FROM
--                                                               companies WHERE owner_id = auth.uid())
--
-- POR QUE ISSO NAO E VAZAMENTO HOJE, E MESMO ASSIM SAI:
-- Ambas sao SUBCONJUNTO ESTRITO do que ja vigora. `is_company_owner` contem o ramo
-- `c.owner_id = auth.uid()`, entao a policy de `jobs` nao concede um unico byte alem das tres
-- novas; e `companies` tem "Authenticated users can view companies" USING (true), que engole
-- a de SELECT inteira. Elas nao ABREM nada.
--
-- O problema e de DIRECAO, nao de alcance: enquanto existirem, ha uma segunda porta de
-- autorizacao de empresa que NAO passa por `is_company_owner`. No dia em que alguem APERTAR o
-- seam -- e apertar e o movimento previsto, foi o que a DS-PII fez com
-- `can_view_worker_profile` em 20260821000300 -- a policy legada continua concedendo pelo
-- criterio antigo, em silencio, e o aperto vira teatro. O seam so e seam se for o UNICO caminho.
-- E o motivo de Q3/A6 existirem: "nenhuma linha de empresa contem 'owner_id' inline".
--
-- O QUE NAO SAI, E POR QUE:
--   companies | "Users can create their company" | INSERT | WITH CHECK (owner_id = auth.uid())
-- Esta NAO e subconjunto da irma "Companies can insert own profile by id" (id = auth.uid()):
-- uma linha com owner_id = eu e id <> eu passa nela e falha na outra. Hoje nenhuma das 7
-- empresas esta nesse formato (Q1 = 0), mas o caminho de signup depende do INSERT e o custo de
-- errar aqui e "ninguem consegue mais criar empresa". Fica, registrada como divida de limpeza.
--
-- Article 8: nao toca saldo. Nenhuma tabela nova, nenhuma funcao nova.

-- Falha fechado: so remove se o substituto do seam estiver mesmo no lugar.
DO $$
BEGIN
    -- Contagem explicita, e nao `HAVING count(*) = 3` dentro de EXISTS: o HAVING sem GROUP BY
    -- ate funciona aqui, mas so porque `policyname` e UNIQUE por tabela em Postgres -- uma
    -- invariante externa que o proximo leitor teria de conhecer para confiar no guarda. Guarda
    -- que depende de premissa nao escrita e guarda que alguem copia para onde a premissa nao vale.
    IF (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'jobs'
           AND policyname IN ('jobs_insert_company_owner',
                              'jobs_update_company_owner',
                              'jobs_delete_company_owner')) <> 3 THEN
        RAISE EXCEPTION
          'ASSERCAO: as tres policies de jobs pelo seam nao estao todas presentes. Aplicar '
          '20260818100200 antes. Remover a legada agora tiraria acesso da empresa. HALT.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'companies'
           AND policyname = 'Authenticated users can view companies' AND qual = 'true'
    ) THEN
        RAISE EXCEPTION
          'ASSERCAO: companies nao tem mais o SELECT USING(true) que engole a policy legada. '
          'Remove-la agora tiraria leitura da propria empresa. HALT -> architect.';
    END IF;
END $$;

DROP POLICY IF EXISTS "Company owner can manage jobs"      ON public.jobs;
DROP POLICY IF EXISTS "Company owner can view own company" ON public.companies;

-- ============================================================================
-- DOWN (rollback):
--   CREATE POLICY "Company owner can manage jobs" ON public.jobs FOR ALL
--       USING      (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()))
--       WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));
--   CREATE POLICY "Company owner can view own company" ON public.companies FOR SELECT
--       USING (owner_id = auth.uid());
-- VERIFICACAO pos-aplicacao (Q3 do contrato) — precisa devolver ZERO linhas:
--   SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname='public' AND tablename IN ('companies','jobs')
--      AND coalesce(qual,'')||coalesce(with_check,'') LIKE '%owner_id%'
--      AND policyname <> 'Users can create their company';
-- ============================================================================
