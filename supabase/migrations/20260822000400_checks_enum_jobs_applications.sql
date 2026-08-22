-- Migration: CHECK de conjunto fechado em 3 colunas que hoje so tem garantia no cliente
-- Debito: Hh5 (.harness/spec/lgpd-producao/ddl-aprovado.md §5.5)
--
-- POR QUE EXISTE: `jobs.status`, `jobs.budget_type` e `applications.status` nao tem CHECK nenhum.
-- O que as mantem com cara de enum e CODIGO DE FRONTEND — e o Article 4 da constitution diz, com
-- todas as letras, que filtro no cliente e so UX e que a defesa dura e o banco. Um PATCH direto
-- via PostgREST (a empresa dona do turno passa na policy de UPDATE) escreve texto livre nelas
-- HOJE, e esse texto sobreviveria a exclusao de conta (foi por ai que o debito nasceu, na
-- classificacao de LGPD).
--
-- ⚠️ O DOMINIO NAO SAO OS DADOS DE HOJE. Levantamento exaustivo do codigo (migrations, edge
-- functions, frontend, testes, arvores legadas) encontrou valores que o codigo GRAVA e que nao
-- estao em nenhuma linha de producao. Um CHECK montado a partir de `SELECT DISTINCT` quebraria o
-- produto no primeiro clique que usasse o valor ausente. Cada valor abaixo tem origem rastreada.
--
-- ⚠️ DUAS COLUNAS FICARAM DE FORA DE PROPOSITO: `jobs.type` e `jobs.scope`.
-- Elas tem valores ORFAOS em producao — `'full-time'` e `'hybrid'` — que nao aparecem em NENHUMA
-- linha do repositorio: nem viva, nem morta, nem em teste, nem em `backend_legacy/`, nem em
-- `frontend-angular-backup/`. Foram gravados por uma UI que nao existe mais no git. E
-- `CompanyCreateJob.tsx` faz ROUND-TRIP na edicao (le a linha e regrava os mesmos campos), entao
-- um CHECK que os omitisse quebraria "editar turno" em toda linha legada. Como nao ha como provar
-- que sao os unicos orfaos, e como as duas nao tem UI, nem uniao de tipo, nem seletor — sao
-- TAXONOMIA ABERTA, mesma cara de `jobs.category`. CHECK ali congelaria vocabulario de produto
-- sobre coluna sem dono. Ficam declaradas como classe fraca no contrato de LGPD.
--
-- Article 8: nao toca saldo. Nenhuma linha e alterada — CHECK so restringe escrita futura.

-- =============================================
-- 1. ASSERCAO — falha fechado se algum dado vigente violar o CHECK que estamos prestes a criar
-- =============================================
-- Sem isto, o ALTER aborta com uma mensagem generica de constraint violada e sem dizer QUAL linha.
-- Pior: uma migration de LGPD/exclusao de conta que rode depois herdaria um banco onde o ALTER
-- falhou, e o sintoma apareceria longe da causa.
DO $$
DECLARE
    v_bad text;
BEGIN
    SELECT string_agg(DISTINCT quote_literal(status), ', ') INTO v_bad
      FROM public.jobs
     WHERE status IS NOT NULL
       AND status <> ALL (ARRAY['open', 'paused', 'deleted']);
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION
          'ASSERCAO: public.jobs.status tem valor fora do dominio proposto: %. O levantamento de '
          'codigo nao previu este valor. NAO amplie o CHECK as cegas — descubra QUEM o escreveu '
          'antes. HALT -> architect.', v_bad;
    END IF;

    SELECT string_agg(DISTINCT quote_literal(budget_type), ', ') INTO v_bad
      FROM public.jobs
     WHERE budget_type IS NOT NULL
       AND budget_type <> ALL (ARRAY['hourly', 'daily', 'project']);
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION
          'ASSERCAO: public.jobs.budget_type tem valor fora do dominio proposto: %. HALT.', v_bad;
    END IF;

    SELECT string_agg(DISTINCT quote_literal(status), ', ') INTO v_bad
      FROM public.applications
     WHERE status IS NOT NULL
       AND status <> ALL (ARRAY['pending', 'reviewing', 'interview', 'hired', 'in_progress',
                                'completed', 'rejected', 'invited', 'declined', 'cancelled',
                                'applied', 'accepted', 'approved']);
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION
          'ASSERCAO: public.applications.status tem valor fora do dominio proposto: %. HALT.', v_bad;
    END IF;
END $$;

-- =============================================
-- 2. jobs.status — ('open', 'paused', 'deleted')
-- =============================================
-- 'open'    — CompanyCreateJob.tsx:312 (INSERT e UPDATE) · CompanyJobs.tsx:303/437 ·
--             CompanyJobDetails.tsx:205/102 · create_job_series (20260817000400:603)
-- 'paused'  — CompanyJobs.tsx:303->437 e CompanyJobDetails.tsx:205->102 (toggle Pausar/Reativar).
--             ⚠️ NAO EXISTE nos dados de producao hoje: nenhuma empresa pausou turno ainda.
--             Esta aqui porque o BOTAO existe — omiti-lo quebraria "Pausar" no primeiro uso.
--             E o caso que prova por que dominio nao se levanta com SELECT DISTINCT.
-- 'deleted' — soft delete. CompanyJobs.tsx:470 · CompanyJobDetails.tsx:136 ·
--             delete-account/index.ts:225 · stop_job_series (20260817000400:846)
-- Nao entra 'closed': e nome de aba na URL (`?filter=closed`), resolvido no cliente como
-- `job.status !== 'open'` (CompanyJobs.tsx:535). Nunca vai ao banco.
ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_status_check
    CHECK (status IS NULL OR status IN ('open', 'paused', 'deleted'));

COMMENT ON CONSTRAINT jobs_status_check ON public.jobs IS
    'Dominio fechado do ciclo de vida do turno. `paused` nao existia nos dados quando o CHECK foi '
    'criado (20260822000400) — entrou porque o botao Pausar existe. Ver Hh5.';

-- =============================================
-- 3. jobs.budget_type — ('hourly', 'daily', 'project')
-- =============================================
-- Fechado por um <select> de 3 opcoes em CompanyCreateJob.tsx:503-505 ("Por Hora"/"Por Dia"/
-- "Projeto Fixo"), default 'daily' (:51). 'project' NAO esta nos dados de producao, mas e opcao
-- real do formulario — e o ramo "else -> Total" de CompanyJobDetails.tsx:244.
-- Nenhuma RPC escreve literal: create_job_series passa `v_rec.budget_type` do jsonb, e
-- update_job_series_future exclui a coluna do SET list por construcao (20260817000400:713-723).
ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_budget_type_check
    CHECK (budget_type IS NULL OR budget_type IN ('hourly', 'daily', 'project'));

-- =============================================
-- 4. applications.status — 13 valores
-- =============================================
-- ⚠️ A uniao TS `ApplicationStatus` (frontend/src/types/index.ts:229-239) tem 10 valores e NAO E
-- O DOMINIO. Faltam nela tres que o BANCO trata como legitimos:
--   'applied'  — predicado de vinculo nao-terminal em update_job_series_future e stop_job_series
--                (20260817000400:674, 806)
--   'accepted' — idem, mesmas duas linhas
--   'approved' — testado pelo trigger VIVO validate_application_update (20260622000300:92-93)
-- Nenhum dos tres e escrito por codigo hoje; os tres sao ESPERADOS por codigo que decide acesso e
-- transicao. Omiti-los faria um UPDATE legitimo falhar num caminho que grep de escrita nao revela.
-- Alem disso, `types/index.ts:252` declara `status: ApplicationStatus | string` — a uniao nao tipa
-- nada na pratica, o que explica como o desvio passou.
--
-- 'rejected' e 'interview' vem do fluxo pull legado, hoje atras da flag
-- `PULL_HIRE_ENABLED = false` (CompanyJobCandidates.tsx:173). Codigo DESLIGADO, nao removido — a
-- um `= true` de voltar a gravar. Entram.
ALTER TABLE public.applications
    ADD CONSTRAINT applications_status_check
    CHECK (status IS NULL OR status IN (
        'pending', 'reviewing', 'interview', 'hired', 'in_progress',
        'completed', 'rejected', 'invited', 'declined', 'cancelled',
        'applied', 'accepted', 'approved'
    ));

COMMENT ON CONSTRAINT applications_status_check ON public.applications IS
    'Dominio fechado. Inclui applied/accepted/approved, que NENHUM codigo escreve mas que RPCs de '
    'serie e o trigger validate_application_update esperam encontrar. A uniao TS ApplicationStatus '
    'tem so 10 valores e nao e o dominio — ver 20260822000400.';

-- ============================================================================
-- DOWN:
--   ALTER TABLE public.jobs         DROP CONSTRAINT IF EXISTS jobs_status_check;
--   ALTER TABLE public.jobs         DROP CONSTRAINT IF EXISTS jobs_budget_type_check;
--   ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_status_check;
--
-- VERIFICACAO pos-aplicacao:
--   1. Os tres CHECKs existem e enumeram valores (e a (b3) da migration de LGPD passa a poder
--      promover estas colunas de "classe fraca" para "classe forte"):
--      SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--       WHERE conrelid IN ('public.jobs'::regclass,'public.applications'::regclass)
--         AND contype='c' AND conname LIKE '%status%' OR conname LIKE '%budget%';
--   2. O caminho que mais importa continua funcionando — regravar um turno LEGADO.
--      ⚠️ NAO use `SET updated_at = now()`: `public.jobs` NAO TEM coluna `updated_at`
--         (a primeira versao desta verificacao usava, e falhou com 42703 na hora de rodar).
--      Use um round-trip de verdade, que e o risco real (CompanyCreateJob.tsx recarrega os
--      valores da linha e os regrava ao editar):
--
--      DO $$
--      DECLARE v_id uuid; v_scope text;
--      BEGIN
--          SELECT id, scope INTO v_id, v_scope FROM public.jobs
--           WHERE type = 'full-time' OR scope = 'hybrid' LIMIT 1;
--          IF v_id IS NULL THEN RAISE EXCEPTION 'ROLLBACK: sem linha legada para testar'; END IF;
--          UPDATE public.jobs
--             SET status = status, type = type, scope = scope, budget_type = budget_type
--           WHERE id = v_id;
--          RAISE EXCEPTION 'ROLLBACK PROPOSITAL: OK, regravou linha legada (scope=%)', v_scope;
--      END $$;
--
--      EXECUTADO em 22/08/2026, logo apos aplicar: passou numa linha com `scope='hybrid'`.
--      E por isso que `type` e `scope` NAO ganharam CHECK.
-- ============================================================================
