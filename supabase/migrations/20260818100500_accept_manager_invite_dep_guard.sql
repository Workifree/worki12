-- Migration: accept_manager_invite - guarda de DELETE da casca vazia passa a ser exaustiva
-- File: supabase/migrations/20260818100500_accept_manager_invite_dep_guard.sql
-- Achado: security-reviewer (F13 pos-Fase-3), MEDIO.
--
-- O DEFEITO, EM UMA FRASE
-- ============================================================================
-- `accept_manager_invite` (20260818100300:148-156) apaga a casca vazia de `companies` sob SEIS
-- `NOT EXISTS` (jobs, team_connections, shift_payments, company_members, team_lists, job_series).
-- Mas ha FKs para `companies(id)` fora dessa lista: `payment_methods`, `company_spend_limits`,
-- `company_monthly_revenue`, `worker_certifications.verified_by_company_id`, `worker_referrals`
-- (duas colunas: referring_company_id, requesting_company_id), `worker_trainings` e
-- `worker_company_badge_prefs`. Risco baixo na pratica (casca recem-criada com
-- onboarding_completed=false dificilmente tem isso), mas e a MESMA classe de landmine que
-- 20260821000000 §1(c) foi escrita para cacar: lista a mao que envelhece a cada feature nova
-- (F10 worker_referrals e F12 worker_company_badge_prefs nasceram depois e passaram despercebidas
-- ate aquela migration).
--
-- O QUE ESTA MIGRATION FAZ
-- ============================================================================
--   1. Asserção de migração (mesmo padrão de 20260821000000 §1(c)): enumera `pg_constraint`
--      contra `companies` e falha se houver dependente fora da allow-list abaixo. Enumeração
--      automática decide *o que existe*; a allow-list decide *o que é seguro*. As duas juntas.
--   2. `accept_manager_invite` ganha os NOT EXISTS que faltavam, cobrindo TODAS as 13 tabelas
--      hoje dependentes de `companies(id)` (as 6 originais + as 7 que faltavam).
--
-- Article 8 intacto: nao toca saldo/escrow. Risk: LOW (torna a guarda MAIS restritiva, nunca
-- menos — na pior hipotese, deixa de apagar uma casca que ja tem dado, o que e o comportamento
-- CORRETO). Backup required before production deploy: NO.
-- ============================================================================


-- ============================================================================
-- 1. ASSERÇÃO — nenhuma tabela dependente de `companies` pode ficar fora da allow-list.
--    Mesmo mecanismo de 20260821000000 §1(c). Falha aqui = HALT, volta ao architect com a
--    lista real de dependentes — NÃO editar a allow-list às cegas para "fazer passar":
--    editar significa "eu decidi o que accept_manager_invite faz com essa tabela".
-- ============================================================================
DO $$
DECLARE
    -- As 13 tabelas HOJE dependentes de companies(id) — as 6 já cobertas por
    -- accept_manager_invite (20260818100300) + as 7 que faltavam (achado do security-reviewer).
    v_classified_deps text[] := ARRAY[
        'public.jobs',                        -- coberto (NOT EXISTS já existia)
        'public.team_connections',            -- coberto (NOT EXISTS já existia)
        'public.shift_payments',               -- coberto (NOT EXISTS já existia)
        'public.company_members',             -- coberto (NOT EXISTS já existia)
        'public.team_lists',                  -- coberto (NOT EXISTS já existia)
        'public.job_series',                  -- coberto (NOT EXISTS já existia)
        'public.payment_methods',             -- NOVO — sem NOT EXISTS até esta migration
        'public.company_spend_limits',        -- NOVO
        'public.company_monthly_revenue',     -- NOVO
        'public.worker_trainings',            -- NOVO (company_id)
        'public.worker_certifications',       -- NOVO (verified_by_company_id, ON DELETE SET NULL)
        'public.worker_company_badge_prefs',  -- NOVO
        'public.worker_referrals'             -- NOVO (referring_company_id + requesting_company_id)
    ];
    v_unknown text;
BEGIN
    SELECT string_agg(DISTINCT con.conrelid::regclass::text, ', ') INTO v_unknown
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.companies'::regclass
      AND con.conrelid::regclass::text <> ALL (v_classified_deps);

    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION
          'ASSERCAO: tabelas dependentes de companies NAO classificadas em accept_manager_invite: '
          '%. A casca vazia poderia ser apagada com dado pendurado nessa tabela. HALT -> architect.',
          v_unknown;
    END IF;
END $$;


-- ============================================================================
-- 2. accept_manager_invite — guarda exaustiva (as 13 tabelas da allow-list acima).
--    Corpo idêntico a 20260818100300, exceto a lista de NOT EXISTS na DELETE de companies.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.accept_manager_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_row public.company_members;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF NULLIF(trim(COALESCE(p_token, '')), '') IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm
     WHERE cm.invite_token = trim(p_token)
     FOR UPDATE;

    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- Idempotencia: mesmo usuario reaceitando o proprio convite.
    IF v_row.status = 'active' AND v_row.user_id = v_uid THEN
        RETURN jsonb_build_object('outcome', 'already_accepted',
                                  'company_id', v_row.company_id, 'member_id', v_row.id);
    END IF;
    -- NUNCA aceitar em silencio um token ja usado por outra pessoa.
    IF v_row.user_id IS NOT NULL AND v_row.user_id <> v_uid THEN
        RETURN jsonb_build_object('outcome', 'token_already_used');
    END IF;
    IF v_row.status <> 'invited' THEN
        RETURN jsonb_build_object('outcome', 'revoked');
    END IF;
    IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;
    -- Isolamento de papel (Article 1): quem tem perfil de freela nao vira gerente.
    IF EXISTS (SELECT 1 FROM public.workers w WHERE w.id = v_uid) THEN
        RETURN jsonb_build_object('outcome', 'worker_cannot_be_manager');
    END IF;

    UPDATE public.company_members
       SET user_id      = v_uid,
           status       = 'active',
           accepted_at  = now(),
           invite_token = NULL          -- token queima no uso
     WHERE id = v_row.id;

    -- Limpeza da CASCA de companies criada por handle_new_user para o signup user_type='hire'.
    -- Sem isto o gerente carrega uma "empresa" fantasma com onboarding_completed=false e volta
    -- ao loop de onboarding por outro caminho (ver ddl-aprovado.md D4).
    -- Guardas estritas: so remove se estiver COMPLETAMENTE vazia. Lista EXAUSTIVA (20260818100500)
    -- das 13 tabelas hoje dependentes de companies(id) — a asserção acima (§1) garante que nenhuma
    -- ficou fora; tabela nova FALHA a migration em vez de ficar despercebida.
    DELETE FROM public.companies c
     WHERE c.id = v_uid
       AND COALESCE(c.onboarding_completed, false) = false
       AND NOT EXISTS (SELECT 1 FROM public.jobs                      j  WHERE j.company_id  = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.team_connections          tc WHERE tc.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.shift_payments            sp WHERE sp.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.company_members           cm WHERE cm.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.team_lists                tl WHERE tl.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.job_series                js WHERE js.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.payment_methods           pm WHERE pm.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.company_spend_limits      csl WHERE csl.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.company_monthly_revenue   cmr WHERE cmr.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.worker_trainings          wt WHERE wt.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.worker_certifications     wc WHERE wc.verified_by_company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.worker_company_badge_prefs wcbp WHERE wcbp.company_id = c.id)
       AND NOT EXISTS (
             SELECT 1 FROM public.worker_referrals wr
              WHERE wr.referring_company_id = c.id OR wr.requesting_company_id = c.id
           );

    RETURN jsonb_build_object('outcome', 'accepted',
                              'company_id', v_row.company_id, 'member_id', v_row.id);
END;
$$;

COMMENT ON FUNCTION public.accept_manager_invite(text) IS
    'O gerente ja autenticado amarra o proprio user_id ao convite e (se a casca de companies '
    'criada por handle_new_user estiver vazia) a remove. Guarda de DELETE EXAUSTIVA '
    '(20260818100500): as 13 tabelas hoje dependentes de companies(id), validadas por asserção '
    'de pg_constraint na mesma migration — nenhuma tabela nova pode ficar fora sem falhar a '
    'migration primeiro.';

REVOKE ALL ON FUNCTION public.accept_manager_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_manager_invite(text) TO authenticated, service_role;


-- ============================================================================
-- COMO VERIFICAR (obrigatório após aplicar)
-- ----------------------------------------------------------------------------
-- V1. Assercao do §1 passa sem RAISE EXCEPTION (nenhum dependente novo fora da allow-list).
-- V2. Casca vazia (onboarding_completed=false, nenhuma das 13 tabelas com linha) + accept_manager_invite
--       ⇒ outcome='accepted' e a linha de companies É removida (comportamento inalterado).
-- V3. Casca com UMA linha em payment_methods (ou qualquer uma das 7 tabelas novas) apontando para
--       c.id = v_uid ⇒ accept_manager_invite ainda retorna outcome='accepted' (o convite é aceito
--       normalmente) mas a linha de companies NÃO é removida (antes: era removida em silêncio,
--       deixando o FK órfão logicamente ligado a uma unidade fantasma).
--
-- DOWN (rollback):
--   -- Restaura accept_manager_invite ao corpo de 20260818100300 (6 NOT EXISTS).
--   -- A asserção do §1 não deixa artefato persistente (DO block) — nada para reverter.
-- ============================================================================
