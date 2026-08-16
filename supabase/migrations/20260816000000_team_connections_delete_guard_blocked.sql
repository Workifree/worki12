-- Migration: Guarda de consentimento no DELETE de team_connections (R6 — SEGURANÇA)
-- File: supabase/migrations/20260816000000_team_connections_delete_guard_blocked.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260816-veto-freela-imutavel-delete.md
--
-- PROBLEMA (bypass de consentimento):
--   A migration 20260622000000_team_connections.sql documenta explicitamente que o
--   `blocked` é um VETO DO FREELA e que "a empresa NÃO pode desfazer esse bloqueio
--   reconvidando" — e implementa isso em `tc_update_company`, cujo USING exclui as
--   linhas `status = 'blocked'` do escopo de UPDATE da empresa.
--   Porém `tc_delete_company` NÃO tinha a mesma guarda:
--       USING (company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid()))
--   Com a funcionalidade "remover freela do elenco" (TeamConnectionService.removeFromTeam,
--   commit d00cdfa4), que faz DELETE FÍSICO, a empresa passou a poder:
--       1. DELETE da linha `blocked`  (permitido pela policy antiga)
--       2. INSERT de uma nova linha   (permitido por `tc_insert_company`, que só exige
--          status = 'pending')
--   → o veto do freela vira decorativo: ele volta a receber convites de equipe de quem
--   ele bloqueou. Problema de CONSENTIMENTO (LGPD/confiança), não de UX.
--   O UNIQUE (company_id, worker_id) fazia o DELETE ser o único caminho de "reset" —
--   por isso o DELETE precisava existir, mas com escopo correto.
--
-- SOLUÇÃO (guarda por AUTORIA DO BLOQUEIO, não por status):
--   O DELETE da empresa passa a excluir as linhas bloqueadas que NÃO foram bloqueadas
--   por ela mesma:
--       AND (status <> 'blocked' OR blocked_by = auth.uid())
--   - Veto do FREELA (blocked_by = worker) → linha IMUTÁVEL e INDELÉVEL para a empresa
--     (já era imutável no UPDATE; agora também no DELETE). Só o próprio freela reativa.
--   - Bloqueio feito pela PRÓPRIA empresa (blocked_by = auth.uid() do owner) → ela pode
--     deletar e reconvidar. Sem essa ressalva, a empresa se auto-trancaria: `tc_update_company`
--     permite (WITH CHECK) que ela grave `blocked`, mas o USING a impede de sair desse estado
--     — o DELETE é a única saída. Hoje nenhum caminho do frontend faz isso (só o worker grava
--     'blocked', via blockConnection, sempre com blocked_by = auth.uid() dele), mas a policy
--     de UPDATE autoriza; a ressalva mantém o remédio disponível se essa feature existir.
--   - Caso legítimo PRESERVADO: remover um membro `accepted`/`pending` e reconvidar depois
--     continua funcionando exatamente como antes (DELETE + INSERT 'pending').
--
-- FAIL-CLOSED em linha legada: `blocked` com `blocked_by IS NULL` → `blocked_by = auth.uid()`
--   é NULL → USING falso → DELETE negado. Correto por padrão: autoria desconhecida é tratada
--   como veto do freela (o caminho do worker sempre preenche blocked_by; o da empresa não existe).
--   Remediação de suporte, se necessária, via service_role (bypassa RLS).
--
-- POR QUE NÃO UM TRIGGER BEFORE DELETE: `team_connections.worker_id/company_id` são
--   ON DELETE CASCADE de workers/companies. Um trigger que levantasse exceção em linha
--   `blocked` quebraria a EXCLUSÃO DE CONTA (direito de apagamento, LGPD) e a limpeza
--   administrativa via service_role. A guarda tem de ficar na RLS (papel `authenticated`),
--   que é exatamente a fronteira do ator "empresa".
--
-- EFEITO COLATERAL CONHECIDO (tratado no frontend, fora desta migration): um DELETE que não
--   casa com o USING não é erro — afeta 0 linhas e o PostgREST responde 204. `removeFromTeam`
--   precisa de `.select()` para distinguir "removido" de "negado". Ver ADR, seção Consequências.
--
-- Sem alteração de schema, de dados, de RPC ou de saldo. Article 8 intacto (nada de
--   escrow/wallet aqui). Idempotente (DROP POLICY IF EXISTS antes do CREATE POLICY).
--
-- DOWN (rollback): ver bloco no final do arquivo.

-- =============================================
-- DELETE (empresa): remove quem ela quiser, MENOS quem a bloqueou
-- =============================================
DROP POLICY IF EXISTS "tc_delete_company" ON public.team_connections;
CREATE POLICY "tc_delete_company" ON public.team_connections
    FOR DELETE TO authenticated
    USING (
        company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
        AND (status <> 'blocked' OR blocked_by = auth.uid())
    );

COMMENT ON POLICY "tc_delete_company" ON public.team_connections IS
    'Empresa remove fisicamente conexões dela (pending/accepted), habilitando reconvite apesar do UNIQUE (company_id, worker_id). '
    'NÃO pode deletar uma conexão bloqueada por outra pessoa (veto do freela é indelével para a empresa); '
    'pode deletar um bloqueio de sua própria autoria (blocked_by = auth.uid()). Espelha a guarda de tc_update_company.';

-- =============================================
-- DOWN (rollback manual — restaura a policy da 20260622000000, COM o bypass):
--   DROP POLICY IF EXISTS "tc_delete_company" ON public.team_connections;
--   CREATE POLICY "tc_delete_company" ON public.team_connections
--       FOR DELETE TO authenticated
--       USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));
-- =============================================
