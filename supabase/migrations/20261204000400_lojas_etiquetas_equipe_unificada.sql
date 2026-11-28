-- Migration: Lojas como etiquetas + equipe unificada (Gestor e Encarregado num convite so)
-- File: supabase/migrations/20261204000400_lojas_etiquetas_equipe_unificada.sql
-- ADR:  .harness/memory-bank/decisions/ADR-20261127-lojas-como-etiquetas-e-equipe-unificada.md
--
-- Pre-requisitos aplicados em producao: 20261123000100..000600 (E0-E5) e
-- 20261127000200_convite_encarregado_preso_ao_email.sql. Nao toca saldo (Article 8).
--
-- ORDEM DE DEPLOY
--   1. Aplicar esta migration (corpos e GRANTs foram conferidos no catalogo de producao em 27/11/2026).
--   2. supabase functions deploy accept-team-invite --no-verify-jwt   (so o comentario de cabecalho muda)
--   3. Publicar o frontend. Frontend NOVO contra banco ANTIGO falha (p_default_tag_id, rename_company_tag,
--      set_member_default_tag inexistentes): migration sempre antes.
--
-- DESVIO DO ADR (D7): o ADR manda revogar `accept_company_invite_by_token`. No catalogo e no codigo essa
-- funcao e o ACEITE DO ELENCO PELO FREELA (`accept_company_invite_by_token(p_token) RETURNS team_connections`,
-- migration 20260702120000, chamada por teamConnectionService.ts). Revoga-la quebraria o convite de elenco.
-- A funcao de aceite de GESTOR da F13 e `accept_manager_invite(text)`: e ela que e revogada aqui.
--
-- Mudancas de seguranca: (1) gerente so conta como Gestor com confirmed_at (D6); (2) fecha EXECUTE de
-- invite_company_manager / accept_manager_invite / revoke_company_manager (D7); (3) trava de loja do
-- encarregado e heranca de loja no INSERT do turno (D2).

-- ============================================================================
-- 1. Esquema: loja padrao do membro
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.company_tags'::regclass
                      AND conname = 'company_tags_company_id_id_key') THEN
        ALTER TABLE public.company_tags
            ADD CONSTRAINT company_tags_company_id_id_key UNIQUE (company_id, id);
    END IF;
END $$;

ALTER TABLE public.company_members ADD COLUMN IF NOT EXISTS default_tag_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.company_members'::regclass
                      AND conname = 'company_members_default_tag_fk') THEN
        ALTER TABLE public.company_members
            ADD CONSTRAINT company_members_default_tag_fk
            FOREIGN KEY (company_id, default_tag_id)
            REFERENCES public.company_tags (company_id, id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.company_members'::regclass
                      AND conname = 'company_members_default_tag_role_chk') THEN
        ALTER TABLE public.company_members
            ADD CONSTRAINT company_members_default_tag_role_chk
            CHECK (default_tag_id IS NULL OR role = 'encarregado');
    END IF;
END $$;

COMMENT ON COLUMN public.company_members.default_tag_id IS
    'Loja padrao do encarregado (ADR-20261127-lojas). Herdada no INSERT de jobs pelo jobs_responsible_guard. '
    'NUNCA concede acesso: o seam nao le esta coluna. Escrita so por RPC (set_member_default_tag / invite_company_member).';

-- ============================================================================
-- 2. Seam (D6): gerente so conta como Gestor se confirmado
-- ============================================================================
CREATE OR REPLACE FUNCTION public.session_operates_company_membership(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $fn$
    SELECT (SELECT auth.uid()) IS NOT NULL
       AND p_company_id IS NOT NULL
       AND (
            EXISTS (
                SELECT 1 FROM public.company_members cm
                 WHERE cm.company_id = p_company_id
                   AND cm.user_id = (SELECT auth.uid())
                   AND cm.status  = 'active' AND cm.role = 'manager'
                   AND cm.confirmed_at IS NOT NULL
            )
         OR EXISTS (
                SELECT 1
                  FROM public.organization_members om
                  JOIN public.companies c ON c.organization_id = om.organization_id
                 WHERE c.id = p_company_id
                   AND om.user_id = (SELECT auth.uid())
                   AND om.status  = 'active'
                   AND om.role IN ('owner', 'operator')
            )
       );
$fn$;

CREATE OR REPLACE FUNCTION public.internal_company_gestor_ids(p_company_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $fn$
    SELECT COALESCE(c.owner_id, c.id)
      FROM public.companies c
     WHERE c.id = p_company_id
    UNION
    SELECT cm.user_id
      FROM public.company_members cm
     WHERE cm.company_id = p_company_id
       AND cm.status = 'active'
       AND cm.role   = 'manager'
       AND cm.confirmed_at IS NOT NULL
       AND cm.user_id IS NOT NULL
    UNION
    SELECT om.user_id
      FROM public.organization_members om
      JOIN public.companies c2 ON c2.organization_id = om.organization_id
     WHERE c2.id = p_company_id
       AND om.status = 'active'
       AND om.role IN ('owner', 'operator')
       AND om.user_id IS NOT NULL;
$fn$;

CREATE OR REPLACE FUNCTION public.notification_recipients_for_job(p_job_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $fn$
    WITH j AS (
        SELECT jb.company_id, jb.responsible_id
          FROM public.jobs jb
         WHERE jb.id = p_job_id
    )
    SELECT COALESCE(c.owner_id, c.id)
      FROM public.companies c
      JOIN j ON j.company_id = c.id
    UNION
    -- Gestores ativos E CONFIRMADOS (ADR-20261127 D6)
    SELECT cm.user_id
      FROM public.company_members cm
      JOIN j ON j.company_id = cm.company_id
     WHERE cm.status = 'active'
       AND cm.role   = 'manager'
       AND cm.confirmed_at IS NOT NULL
       AND cm.user_id IS NOT NULL
    UNION
    SELECT om.user_id
      FROM public.organization_members om
      JOIN public.companies c2 ON c2.organization_id = om.organization_id
      JOIN j ON j.company_id = c2.id
     WHERE om.status = 'active'
       AND om.role IN ('owner', 'operator')
       AND om.user_id IS NOT NULL
    UNION
    SELECT j.responsible_id
      FROM j
     WHERE j.responsible_id IS NOT NULL
       AND public.internal_company_confirmed_operator(j.company_id, j.responsible_id);
$fn$;

-- "Confirmado" agora vale para os dois papeis de membro (antes so encarregado).
CREATE OR REPLACE FUNCTION public.internal_company_confirmed_operator(p_company_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $fn$
    SELECT public.internal_company_active_operator(p_company_id, p_user_id)
       AND NOT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id   = p_company_id
               AND cm.user_id      = p_user_id
               AND cm.status       = 'active'
               AND cm.role         IN ('encarregado', 'manager')
               AND cm.confirmed_at IS NULL
       );
$fn$;

CREATE OR REPLACE FUNCTION public.internal_company_has_gestor_besides_member(p_company_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $fn$
    SELECT EXISTS (SELECT 1 FROM public.companies c
                     JOIN auth.users u ON u.id = COALESCE(c.owner_id, c.id)
                    WHERE c.id = p_company_id AND c.anonymized_at IS NULL)
        OR EXISTS (SELECT 1 FROM public.organization_members om
                     JOIN public.companies c2 ON c2.organization_id = om.organization_id
                    WHERE c2.id = p_company_id AND om.status = 'active'
                      AND om.role IN ('owner', 'operator') AND om.user_id IS NOT NULL)
        OR EXISTS (SELECT 1 FROM public.company_members cm
                    WHERE cm.company_id = p_company_id AND cm.status = 'active'
                      AND cm.role = 'manager' AND cm.confirmed_at IS NOT NULL
                      AND cm.user_id IS DISTINCT FROM p_user_id);
$fn$;

CREATE OR REPLACE FUNCTION public.is_organization_member(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $fn$
    SELECT (SELECT auth.uid()) IS NOT NULL
       AND p_organization_id IS NOT NULL
       AND (
            EXISTS (SELECT 1 FROM public.organization_members om
                     WHERE om.organization_id = p_organization_id
                       AND om.user_id = (SELECT auth.uid())
                       AND om.status  = 'active')
         OR EXISTS (SELECT 1 FROM public.company_members cm
                      JOIN public.companies c ON c.id = cm.company_id
                     WHERE c.organization_id = p_organization_id
                       AND cm.user_id = (SELECT auth.uid())
                       AND cm.status  = 'active' AND cm.role = 'manager'
                       AND cm.confirmed_at IS NOT NULL)
         OR EXISTS (SELECT 1 FROM public.companies c2
                     WHERE c2.organization_id = p_organization_id
                       AND (c2.owner_id = (SELECT auth.uid()) OR c2.id = (SELECT auth.uid())))
       );
$fn$;

CREATE OR REPLACE FUNCTION public.get_my_companies()
RETURNS TABLE(company_id uuid, company_name text, role text, organization_id uuid, organization_name text,
              onboarding_completed boolean, accepted_tos boolean, confirmed boolean, team_enabled boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $fn$
    SELECT b.id,
           b.name,
           CASE
               WHEN b.is_owner          THEN 'owner'
               WHEN b.is_operator       THEN 'operator'
               WHEN b.m_role = 'manager' THEN 'manager'
               ELSE 'encarregado'
           END AS role,
           b.organization_id,
           b.org_name,
           COALESCE(b.onboarding_completed, false),
           -- Article 12 por PESSOA: membro (Gestor ou Encarregado) nao herda o aceite de Termos da empresa.
           CASE
               WHEN NOT b.is_owner AND NOT b.is_operator AND b.m_role IN ('manager', 'encarregado')
                   THEN b.m_tos_at IS NOT NULL
               ELSE COALESCE(b.accepted_tos, false) OR b.m_tos_at IS NOT NULL
           END,
           -- ADR-20261127 D6: so dono e operador de organizacao sao confirmados por definicao.
           -- Gestor e Encarregado convidados dependem de confirmed_at.
           (b.is_owner OR b.is_operator OR b.m_confirmed_at IS NOT NULL),
           b.has_team
      FROM (
            SELECT c.id,
                   c.name,
                   c.organization_id,
                   o.name AS org_name,
                   c.onboarding_completed,
                   c.accepted_tos,
                   COALESCE((c.owner_id = (SELECT auth.uid()) OR c.id = (SELECT auth.uid())), false) AS is_owner,
                   EXISTS (SELECT 1 FROM public.organization_members om
                            WHERE om.organization_id = c.organization_id
                              AND om.user_id = (SELECT auth.uid())
                              AND om.status  = 'active'
                              AND om.role IN ('owner', 'operator')) AS is_operator,
                   mm.m_role,
                   mm.m_confirmed_at,
                   mm.m_tos_at,
                   EXISTS (SELECT 1 FROM public.company_members cx
                            WHERE cx.company_id = c.id AND cx.status <> 'removed') AS has_team
              FROM public.companies c
              LEFT JOIN public.organizations o ON o.id = c.organization_id
              LEFT JOIN LATERAL (
                       SELECT cm.role AS m_role, cm.confirmed_at AS m_confirmed_at,
                              cm.accepted_tos_at AS m_tos_at
                         FROM public.company_members cm
                        WHERE cm.company_id = c.id
                          AND cm.user_id    = (SELECT auth.uid())
                          AND cm.status     = 'active'
                        ORDER BY (cm.role = 'manager') DESC
                        LIMIT 1
                   ) mm ON true
             WHERE (SELECT auth.uid()) IS NOT NULL
           ) b
     WHERE b.is_owner OR b.is_operator OR b.m_role IS NOT NULL
     ORDER BY CASE WHEN b.is_owner          THEN 1
                   WHEN b.is_operator       THEN 2
                   WHEN b.m_role = 'manager' THEN 3
                   ELSE 4 END,
              b.name, b.id;
$fn$;

-- ============================================================================
-- 3. D7: fecha a porta antiga de Gestor (F13 Fase 3)
--    NAO revoga accept_company_invite_by_token (e o aceite do Elenco do FREELA; ver cabecalho).
-- ============================================================================
REVOKE ALL ON FUNCTION public.invite_company_manager(uuid, text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_manager_invite(text)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_company_manager(uuid, uuid)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invite_company_manager(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_manager_invite(text)        TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_company_manager(uuid, uuid) TO service_role;

-- ============================================================================
-- 4. Helper: loja padrao vigente de um encarregado (interna)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.internal_member_default_tag(p_company_id uuid, p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $fn$
    SELECT cm.default_tag_id
      FROM public.company_members cm
      JOIN public.company_tags t
        ON t.id = cm.default_tag_id AND t.company_id = cm.company_id AND t.archived_at IS NULL
     WHERE cm.company_id = p_company_id
       AND cm.user_id    = p_user_id
       AND cm.status     = 'active'
       AND cm.role       = 'encarregado'
     LIMIT 1;
$fn$;

COMMENT ON FUNCTION public.internal_member_default_tag(uuid, uuid) IS
    'INTERNA. Loja padrao NAO arquivada de um encarregado ativo (NULL se nao houver). Usada pelo jobs_responsible_guard. '
    'Nao concede acesso (ADR-20261127 D3).';

REVOKE ALL ON FUNCTION public.internal_member_default_tag(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_member_default_tag(uuid, uuid) TO service_role;

-- ============================================================================
-- 5. D2: heranca de loja + trava do encarregado no jobs_responsible_guard
--    (o trigger ja existe e continua apontando para esta funcao)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.jobs_responsible_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
    v_uid          uuid := auth.uid();
    v_company      uuid;
    v_is_insert    boolean := (TG_OP = 'INSERT');
    v_resp_changed boolean;
    v_tag_changed  boolean;
    v_moved        boolean := false;
    v_default      uuid;
    v_own_default  uuid;
BEGIN
    IF v_uid IS NULL THEN
        -- Sessao nula (cron/service_role): sem validacoes, mas a heranca de loja vale (dado fiscal).
        IF v_is_insert AND NEW.tag_id IS NULL AND NEW.responsible_id IS NOT NULL THEN
            NEW.tag_id := public.internal_member_default_tag(NEW.company_id, NEW.responsible_id);
        END IF;
        RETURN NEW;
    END IF;

    IF v_is_insert THEN
        v_company      := NEW.company_id;
        v_resp_changed := NEW.responsible_id IS NOT NULL;
        v_tag_changed  := NEW.tag_id IS NOT NULL;
    ELSE
        v_company      := OLD.company_id;
        v_resp_changed := NEW.responsible_id IS DISTINCT FROM OLD.responsible_id;
        v_tag_changed  := NEW.tag_id IS DISTINCT FROM OLD.tag_id;
        v_moved        := NEW.company_id IS DISTINCT FROM OLD.company_id
                          OR NEW.series_id IS DISTINCT FROM OLD.series_id;
    END IF;

    -- R3: o cliente NAO e a fonte da verdade do responsavel.
    IF v_is_insert
       AND NEW.responsible_id IS NULL
       AND public.internal_company_confirmed_operator(NEW.company_id, v_uid) THEN
        NEW.responsible_id := v_uid;
        v_resp_changed := true;
    END IF;

    -- D2: heranca da loja padrao DO RESPONSAVEL (nao de quem clicou). Explicito vence padrao.
    -- So no INSERT: "Passar para..." e mudar a loja padrao de alguem nao reescrevem turno existente.
    IF v_is_insert AND NEW.tag_id IS NULL AND NEW.responsible_id IS NOT NULL THEN
        v_default := public.internal_member_default_tag(NEW.company_id, NEW.responsible_id);
        IF v_default IS NOT NULL THEN
            NEW.tag_id     := v_default;
            v_tag_changed  := true;
        END IF;
    END IF;

    IF public.session_company_member_role(v_company) = 'encarregado'
       AND NOT public.is_company_owner(v_company) THEN
        IF (CASE WHEN v_is_insert THEN false ELSE (v_moved OR (v_resp_changed AND COALESCE(current_setting('app.job_reassign', true), '') <> NEW.id::text)) END) THEN
            RAISE EXCEPTION 'jobs: encarregado não altera company_id, responsible_id nem series_id (use "Passar para...").'
                USING ERRCODE = '42501';
        END IF;
        IF v_is_insert AND NEW.series_id IS NOT NULL THEN
            RAISE EXCEPTION 'jobs: série recorrente é do Gestor (v1).'
                USING ERRCODE = '42501';
        END IF;
        -- D2: encarregado COM loja padrao nao grava outra loja (INSERT ou UPDATE), inclusive a herdada de
        -- OUTRO responsavel (o Gestor e quem lanca turno em outra loja). Sem padrao: livre.
        IF v_tag_changed THEN
            v_own_default := public.internal_member_default_tag(v_company, v_uid);
            IF v_own_default IS NOT NULL AND NEW.tag_id IS DISTINCT FROM v_own_default THEN
                RAISE EXCEPTION 'jobs: a loja do turno é definida pelo Gestor.'
                    USING ERRCODE = '42501';
            END IF;
        END IF;
    END IF;

    IF NEW.responsible_id IS NOT NULL AND v_resp_changed THEN
        IF NOT public.internal_company_confirmed_operator(NEW.company_id, NEW.responsible_id) THEN
            RAISE EXCEPTION 'jobs: responsible_id precisa ser operador ativo e confirmado da empresa.'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.tag_id IS NOT NULL AND v_tag_changed THEN
        IF NOT EXISTS (SELECT 1 FROM public.company_tags t
                        WHERE t.id = NEW.tag_id
                          AND t.company_id = NEW.company_id
                          AND t.archived_at IS NULL) THEN
            RAISE EXCEPTION 'jobs: tag inexistente, arquivada ou de outra empresa.'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$fn$;

-- ============================================================================
-- 6. Lojas (D4): rename_company_tag + archive_company_tag recusa loja padrao de alguem
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rename_company_tag(p_tag_id uuid, p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
    v_uid  uuid := (SELECT auth.uid());
    v_name text := btrim(regexp_replace(replace(COALESCE(p_name, ''), chr(160), ' '), '[[:space:]]+', ' ', 'g'));
    v_tag  public.company_tags%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_tag_id IS NULL OR length(v_name) < 1 OR length(v_name) > 40 OR v_name ~ '[[:cntrl:]]' THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT * INTO v_tag FROM public.company_tags WHERE id = p_tag_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF NOT public.is_company_owner(v_tag.company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    PERFORM 1 FROM public.company_tags t WHERE t.id = p_tag_id FOR UPDATE;

    -- Outra loja (arquivada ou nao) com o mesmo nome sem caixa: recusa. A propria loja pode mudar so a caixa.
    IF EXISTS (SELECT 1 FROM public.company_tags t
                WHERE t.company_id = v_tag.company_id
                  AND t.id <> p_tag_id
                  AND lower(btrim(t.name)) = lower(v_name)) THEN
        RETURN jsonb_build_object('outcome', 'already_exists');
    END IF;

    BEGIN
        UPDATE public.company_tags SET name = v_name WHERE id = p_tag_id;
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('outcome', 'already_exists');
    END;

    RETURN jsonb_build_object('outcome', 'renamed', 'tag_id', p_tag_id);
END;
$fn$;

COMMENT ON FUNCTION public.rename_company_tag(uuid, text) IS
    'Renomeia uma loja (company_tags). So Gestor (is_company_owner). O id e a chave fiscal; o nome e rotulo e muda em '
    'relatorios passados. Outcomes: renamed | already_exists | not_found | forbidden | invalid_input | unauthenticated.';

REVOKE ALL ON FUNCTION public.rename_company_tag(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_company_tag(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.archive_company_tag(p_tag_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_tag public.company_tags%ROWTYPE;
    v_n   integer;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_tag_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT * INTO v_tag FROM public.company_tags WHERE id = p_tag_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF NOT public.is_company_owner(v_tag.company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    -- So trava DEPOIS de autorizar; relê o estado sob o lock. FOR UPDATE conflita com o FOR SHARE de
    -- set_member_default_tag / invite_company_member: nao ha corrida entre "arquivar" e "virar padrao".
    SELECT t.archived_at INTO v_tag.archived_at FROM public.company_tags t WHERE t.id = p_tag_id FOR UPDATE;
    IF v_tag.archived_at IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'already_archived');
    END IF;

    -- ADR-20261127 D4: sem isto a heranca cairia em silencio para "sem loja".
    SELECT count(*) INTO v_n
      FROM public.company_members cm
     WHERE cm.company_id = v_tag.company_id
       AND cm.default_tag_id = p_tag_id
       AND cm.status IN ('invited', 'active');
    IF v_n > 0 THEN
        RETURN jsonb_build_object('outcome', 'default_of_members', 'count', v_n);
    END IF;

    UPDATE public.company_tags SET archived_at = now() WHERE id = p_tag_id;
    RETURN jsonb_build_object('outcome', 'archived');
END;
$fn$;

-- ============================================================================
-- 7. set_member_default_tag: Gestor muda a loja padrao de membro JA existente
--    Nao reescreve turnos ja criados; turnos criados depois herdam pelo guard.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_member_default_tag(p_company_id uuid, p_member_id uuid, p_tag_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_row public.company_members;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR p_member_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('worki:team:' || p_company_id::text)::bigint);
    IF NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm
     WHERE cm.id = p_member_id AND cm.company_id = p_company_id AND cm.status IN ('invited', 'active')
     FOR UPDATE;
    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF v_row.role <> 'encarregado' THEN
        RETURN jsonb_build_object('outcome', 'not_encarregado');
    END IF;

    IF p_tag_id IS NOT NULL THEN
        PERFORM 1 FROM public.company_tags t
         WHERE t.id = p_tag_id AND t.company_id = p_company_id AND t.archived_at IS NULL
         FOR SHARE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('outcome', 'invalid_tag');
        END IF;
    END IF;

    IF v_row.default_tag_id IS NOT DISTINCT FROM p_tag_id THEN
        RETURN jsonb_build_object('outcome', 'unchanged', 'member_id', v_row.id, 'default_tag_id', p_tag_id);
    END IF;

    UPDATE public.company_members SET default_tag_id = p_tag_id WHERE id = v_row.id;
    RETURN jsonb_build_object('outcome', 'updated', 'member_id', v_row.id, 'default_tag_id', p_tag_id);
END;
$fn$;

COMMENT ON FUNCTION public.set_member_default_tag(uuid, uuid, uuid) IS
    'Define (ou remove, com NULL) a loja padrao de um ENCARREGADO ja existente (convidado ou ativo). So Gestor '
    '(is_company_owner). A loja precisa ser da empresa e nao arquivada. NAO altera turnos ja criados; turnos criados '
    'depois herdam pelo jobs_responsible_guard. Outcomes: updated | unchanged | not_found | not_encarregado | '
    'invalid_tag | forbidden | invalid_input | unauthenticated.';

REVOKE ALL ON FUNCTION public.set_member_default_tag(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_default_tag(uuid, uuid, uuid) TO authenticated, service_role;

-- ============================================================================
-- 8. invite_company_member(uuid, text, text, text, uuid): convite unificado (D5)
-- ============================================================================
DROP FUNCTION IF EXISTS public.invite_company_member(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.invite_company_member(
    p_company_id     uuid,
    p_display_name   text,
    p_role           text,
    p_email          text DEFAULT NULL,
    p_default_tag_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
    v_uid     uuid := auth.uid();
    v_name    text := btrim(COALESCE(p_display_name, ''));
    v_email   text := NULLIF(lower(btrim(COALESCE(p_email, ''))), '');
    v_row     public.company_members;
    v_token   text;
    v_id      uuid;
    v_exp     timestamptz;
    v_cn      text;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL
       OR p_role IS NULL OR p_role NOT IN ('encarregado', 'manager')
       OR length(v_name) < 1 OR length(v_name) > 80
       OR v_name ~ '[[:cntrl:]]' THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;
    -- Loja padrao so existe para encarregado (CHECK company_members_default_tag_role_chk).
    IF p_role = 'manager' AND p_default_tag_id IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    IF v_email IS NULL THEN
        RETURN jsonb_build_object('outcome', 'email_required');
    END IF;
    IF length(v_email) < 3 OR length(v_email) > 254
       OR v_email ~ '[[:cntrl:]]'
       OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RETURN jsonb_build_object('outcome', 'invalid_email');
    END IF;

    PERFORM 1 FROM public.companies c WHERE c.id = p_company_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- Convidar Gestor ou Encarregado: Gestor confirmado (is_company_owner exige manager confirmado).
    IF NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    v_name := btrim(regexp_replace(replace(v_name, chr(160), ' '), '[[:space:]]+', ' ', 'g'));
    IF public.normalize_member_name(v_name) = '' THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('worki:team:' || p_company_id::text)::bigint);

    IF p_default_tag_id IS NOT NULL THEN
        PERFORM 1 FROM public.company_tags t
         WHERE t.id = p_default_tag_id AND t.company_id = p_company_id AND t.archived_at IS NULL
         FOR SHARE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('outcome', 'invalid_tag');
        END IF;
    END IF;

    -- Article 1: freela nao entra na equipe da empresa.
    IF EXISTS (
        SELECT 1
          FROM auth.users u
          JOIN public.workers w ON w.id = u.id
         WHERE lower(btrim(COALESCE(u.email, ''))) = v_email
    ) THEN
        RETURN jsonb_build_object('outcome', 'worker_cannot_be_manager');
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.company_members cm
          LEFT JOIN auth.users u ON u.id = cm.user_id
         WHERE cm.company_id = p_company_id
           AND cm.status = 'active'
           AND (
               lower(btrim(COALESCE(cm.accepted_email, ''))) = v_email
               OR lower(btrim(COALESCE(u.email, ''))) = v_email
           )
    ) THEN
        RETURN jsonb_build_object('outcome', 'already_member');
    END IF;

    -- Idempotencia por (empresa, e-mail), INDEPENDENTE do papel.
    SELECT * INTO v_row FROM public.company_members cm
     WHERE cm.company_id = p_company_id
       AND cm.status = 'invited'
       AND cm.invited_email IS NOT NULL
       AND lower(btrim(cm.invited_email)) = v_email
     ORDER BY cm.invited_at, cm.id
     LIMIT 1
     FOR UPDATE;

    IF v_row.id IS NOT NULL THEN
        IF v_row.expires_at IS NOT NULL AND v_row.expires_at > now() THEN
            -- Vigente: nao sobrescreve o papel (revogar e convidar de novo).
            IF v_row.role <> p_role THEN
                RETURN jsonb_build_object('outcome', 'already_invited_other_role',
                                          'member_id', v_row.id, 'role', v_row.role);
            END IF;
            IF p_role = 'encarregado' AND p_default_tag_id IS NOT NULL
               AND v_row.default_tag_id IS DISTINCT FROM p_default_tag_id THEN
                UPDATE public.company_members SET default_tag_id = p_default_tag_id WHERE id = v_row.id;
            END IF;
            RETURN jsonb_build_object('outcome', 'already_invited', 'member_id', v_row.id,
                                      'invite_token', v_row.invite_token, 'expires_at', v_row.expires_at);
        END IF;
        -- Vencido
        IF v_row.role <> p_role THEN
            UPDATE public.company_members
               SET status = 'removed', removed_at = now(), removed_by = v_uid, invite_token = NULL
             WHERE id = v_row.id;
        ELSE
            v_token := public.generate_invite_token();
            UPDATE public.company_members
               SET invite_token   = v_token,
                   expires_at     = now() + interval '14 days',
                   default_tag_id = CASE WHEN p_role = 'encarregado'
                                         THEN COALESCE(p_default_tag_id, default_tag_id) END
             WHERE id = v_row.id
            RETURNING expires_at INTO v_exp;
            RETURN jsonb_build_object('outcome', 'reinvited', 'member_id', v_row.id,
                                      'invite_token', v_token, 'expires_at', v_exp);
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.company_members cm
         WHERE cm.company_id = p_company_id
           AND cm.status = 'invited'
           AND cm.role = p_role
           AND cm.display_name IS NOT NULL
           AND public.normalize_member_name(cm.display_name) = public.normalize_member_name(v_name)
    ) THEN
        RETURN jsonb_build_object('outcome', 'name_already_invited');
    END IF;

    v_token := public.generate_invite_token();
    BEGIN
        INSERT INTO public.company_members
            (company_id, user_id, role, status, display_name, invited_email, invite_token, expires_at,
             created_by, default_tag_id)
        VALUES
            (p_company_id, NULL, p_role, 'invited', v_name, v_email, v_token, now() + interval '14 days',
             v_uid, CASE WHEN p_role = 'encarregado' THEN p_default_tag_id END)
        RETURNING id, expires_at INTO v_id, v_exp;
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_cn = CONSTRAINT_NAME;
        IF v_cn = 'uq_company_members_pending_email' THEN
            SELECT * INTO v_row FROM public.company_members cm
             WHERE cm.company_id = p_company_id
               AND cm.status = 'invited'
               AND cm.invited_email IS NOT NULL
               AND lower(btrim(cm.invited_email)) = v_email
             ORDER BY cm.invited_at, cm.id
             LIMIT 1;
            IF v_row.role <> p_role THEN
                RETURN jsonb_build_object('outcome', 'already_invited_other_role',
                                          'member_id', v_row.id, 'role', v_row.role);
            END IF;
            RETURN jsonb_build_object('outcome', 'already_invited', 'member_id', v_row.id,
                                      'invite_token', v_row.invite_token, 'expires_at', v_row.expires_at);
        ELSIF v_cn = 'uq_company_members_invited_name_role' THEN
            RETURN jsonb_build_object('outcome', 'name_already_invited');
        ELSE
            RAISE;
        END IF;
    END;

    RETURN jsonb_build_object('outcome', 'invited', 'member_id', v_id,
                              'invite_token', v_token, 'expires_at', v_exp);
END;
$fn$;

COMMENT ON FUNCTION public.invite_company_member(uuid, text, text, text, uuid) IS
    'Convite unico de equipe (ADR-20261127): nome + papel (encarregado | manager) + e-mail obrigatorio + loja padrao '
    'opcional (so encarregado). So Gestor confirmado/dono. Idempotente por (empresa, e-mail) independente do papel: '
    'outro papel pendente => already_invited_other_role. Outcomes: invited | already_invited | reinvited | '
    'already_invited_other_role | name_already_invited | already_member | worker_cannot_be_manager | email_required | '
    'invalid_email | invalid_tag | forbidden | invalid_input | not_found | unauthenticated.';

REVOKE ALL ON FUNCTION public.invite_company_member(uuid, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_company_member(uuid, text, text, text, uuid) TO authenticated, service_role;

-- ============================================================================
-- 9. Previa, checagem da edge function e aceite: os dois papeis
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_member_invite_preview(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
    v_tok          text := NULLIF(btrim(COALESCE(p_token, '')), '');
    v_row          public.company_members;
    v_name         text;
    v_email        text;
    v_email_masked text;
BEGIN
    IF v_tok IS NULL OR length(v_tok) <> 64 OR v_tok !~ '^[0-9a-f]+$' THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm WHERE cm.invite_token = v_tok;
    IF v_row.id IS NULL OR v_row.status <> 'invited' OR v_row.role NOT IN ('encarregado', 'manager') THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    SELECT c.name INTO v_name FROM public.companies c WHERE c.id = v_row.company_id;

    v_email := NULLIF(lower(btrim(COALESCE(v_row.invited_email, ''))), '');
    IF v_email IS NOT NULL AND position('@' IN v_email) > 1 THEN
        v_email_masked := left(split_part(v_email, '@', 1),
                               CASE WHEN length(split_part(v_email, '@', 1)) > 2 THEN 2 ELSE 1 END)
                          || '***@' || split_part(v_email, '@', 2);
    END IF;

    RETURN jsonb_build_object(
        'outcome',      CASE WHEN v_row.expires_at IS NOT NULL AND v_row.expires_at <= now()
                             THEN 'expired' ELSE 'ok' END,
        'company_name', v_name,
        'role',         v_row.role,
        'email_masked', v_email_masked,
        'email_bound',  (v_email IS NOT NULL)
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_member_invite_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_invite_preview(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.internal_team_invite_provision_check(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
    v_tok     text := NULLIF(btrim(COALESCE(p_token, '')), '');
    v_row     public.company_members;
    v_email   text;
    v_uid     uuid;
    v_conf_at timestamptz;
    v_account text;
BEGIN
    IF v_tok IS NULL OR length(v_tok) <> 64 OR v_tok !~ '^[0-9a-f]+$' THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm WHERE cm.invite_token = v_tok;
    IF v_row.id IS NULL OR v_row.status <> 'invited' OR v_row.role NOT IN ('encarregado', 'manager') THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    v_email := NULLIF(lower(btrim(COALESCE(v_row.invited_email, ''))), '');
    IF v_email IS NULL THEN
        RETURN jsonb_build_object('outcome', 'legacy_invite');
    END IF;

    SELECT u.id, u.email_confirmed_at
      INTO v_uid, v_conf_at
      FROM auth.users u
     WHERE lower(btrim(COALESCE(u.email, ''))) = v_email
     LIMIT 1;

    IF v_uid IS NULL THEN
        v_account := 'none';
        -- Gestor tem poder total: nao nasce de conta pre-criada com e-mail NAO verificado.
        -- A pessoa precisa ter uma conta de empresa verificada (cadastro normal) antes de aceitar.
        IF v_row.role = 'manager' THEN
            RETURN jsonb_build_object('outcome', 'manager_requires_verified_signup');
        END IF;
    ELSIF EXISTS (SELECT 1 FROM public.workers w WHERE w.id = v_uid) THEN
        v_account := 'worker';
    ELSIF v_conf_at IS NULL THEN
        v_account := 'unconfirmed';
    ELSE
        v_account := 'company';
    END IF;

    RETURN jsonb_build_object('outcome', 'ok', 'email', v_email, 'account', v_account);
END;
$fn$;

REVOKE ALL ON FUNCTION public.internal_team_invite_provision_check(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_team_invite_provision_check(text) TO service_role;

CREATE OR REPLACE FUNCTION public.accept_company_member_invite(
    p_token      text,
    p_accept_tos boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
    v_uid      uuid := auth.uid();
    v_tok      text := NULLIF(btrim(COALESCE(p_token, '')), '');
    v_hash     text;
    v_row      public.company_members;
    v_existing public.company_members;
    v_email    text;
    v_verified boolean;
    v_g        uuid;
    v_cn       text;
    v_company  uuid;
    v_masked   text;
    v_notice   text;
    v_label    text;
    v_ownership text;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF v_tok IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    v_hash := encode(sha256(convert_to(v_tok, 'UTF8')), 'hex');

    SELECT cm.company_id INTO v_company FROM public.company_members cm
     WHERE cm.invite_token = v_tok OR cm.invite_token_hash = v_hash
     LIMIT 1;
    IF v_company IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('worki:team:' || v_company::text)::bigint);

    SELECT * INTO v_row FROM public.company_members cm
     WHERE cm.company_id = v_company
       AND (cm.invite_token = v_tok OR cm.invite_token_hash = v_hash)
     FOR UPDATE;

    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_row.invite_token IS DISTINCT FROM v_tok THEN
        IF v_row.status = 'active' AND v_row.user_id = v_uid THEN
            RETURN jsonb_build_object('outcome', 'already_accepted',
                                      'company_id', v_row.company_id, 'member_id', v_row.id,
                                      'role', v_row.role, 'confirmed', v_row.confirmed_at IS NOT NULL);
        ELSIF v_row.status = 'active' THEN
            RETURN jsonb_build_object('outcome', 'token_already_used');
        ELSIF v_row.status = 'removed' THEN
            RETURN jsonb_build_object('outcome', 'revoked');
        END IF;
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_row.status <> 'invited' THEN
        RETURN jsonb_build_object('outcome', 'revoked');
    END IF;
    IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    -- ADR-20261127 D5: os dois papeis entram por aqui (sai o ramo use_manager_invite).
    IF v_row.role NOT IN ('encarregado', 'manager') THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- Convite de Gestor so existe preso a e-mail (sem ramo legado sem e-mail).
    IF v_row.role = 'manager' AND NULLIF(btrim(COALESCE(v_row.invited_email, '')), '') IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF p_accept_tos IS DISTINCT FROM true THEN
        RETURN jsonb_build_object('outcome', 'tos_required');
    END IF;

    IF EXISTS (SELECT 1 FROM public.workers w WHERE w.id = v_uid) THEN
        RETURN jsonb_build_object('outcome', 'worker_cannot_be_manager');
    END IF;

    IF public.is_company_owner(v_row.company_id) THEN
        RETURN jsonb_build_object('outcome', 'already_operator');
    END IF;

    SELECT lower(btrim(u.email)), (u.email_confirmed_at IS NOT NULL),
           (u.raw_app_meta_data->>'email_ownership')
      INTO v_email, v_verified, v_ownership
      FROM auth.users u WHERE u.id = v_uid;
    IF v_email IS NULL OR NOT COALESCE(v_verified, false) THEN
        RETURN jsonb_build_object('outcome', 'email_not_verified');
    END IF;
    -- Conta provisionada por convite (e-mail so informado, nao provado) nunca vira Gestor.
    IF v_row.role = 'manager' AND v_ownership = 'not_verified' THEN
        RETURN jsonb_build_object('outcome', 'email_not_verified');
    END IF;

    IF v_row.invited_email IS NOT NULL
       AND v_email <> lower(btrim(v_row.invited_email)) THEN
        RETURN jsonb_build_object('outcome', 'email_mismatch');
    END IF;

    -- Varredura: acesso proprio pendente de confirmacao ha mais de 72h (qualquer dos dois papeis).
    UPDATE public.company_members
       SET status = 'removed', removed_at = now(), removed_by = NULL, invite_token = NULL
     WHERE company_id = v_row.company_id
       AND user_id    = v_uid
       AND status     = 'active'
       AND role       IN ('encarregado', 'manager')
       AND confirmed_at IS NULL
       AND COALESCE(accepted_at, invited_at) <= now() - interval '72 hours'
       AND id <> v_row.id;

    SELECT * INTO v_existing
      FROM public.company_members cm
     WHERE cm.company_id = v_row.company_id
       AND cm.user_id    = v_uid
       AND cm.status     = 'active'
       AND cm.id <> v_row.id;
    IF v_existing.id IS NOT NULL THEN
        -- Pessoa ja ativa com OUTRO papel: nao queima o convite (o Gestor precisa decidir).
        IF v_existing.role <> v_row.role THEN
            RETURN jsonb_build_object('outcome', 'already_member_other_role',
                                      'company_id', v_row.company_id, 'role', v_existing.role);
        END IF;
        UPDATE public.company_members
           SET status = 'removed', removed_at = now(), invite_token = NULL, invite_token_hash = v_hash
         WHERE id = v_row.id;
        RETURN jsonb_build_object('outcome', 'already_accepted',
                                  'company_id', v_row.company_id, 'member_id', v_existing.id);
    END IF;

    PERFORM public.internal_revoke_member_coverages(v_row.company_id, v_uid);

    BEGIN
        UPDATE public.company_members
           SET user_id           = v_uid,
               status            = 'active',
               accepted_at       = now(),
               accepted_email    = v_email,
               accepted_tos_at   = now(),
               confirmed_at      = NULL,
               confirmed_by      = NULL,
               invite_token      = NULL,
               invite_token_hash = v_hash
         WHERE id = v_row.id;
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_cn = CONSTRAINT_NAME;
        IF v_cn IS DISTINCT FROM 'uq_company_members_company_user' THEN
            RAISE;
        END IF;
        SELECT * INTO v_existing
          FROM public.company_members cm
         WHERE cm.company_id = v_row.company_id AND cm.user_id = v_uid
           AND cm.status = 'active' AND cm.id <> v_row.id;
        UPDATE public.company_members
           SET status = 'removed', removed_at = now(), invite_token = NULL, invite_token_hash = v_hash
         WHERE id = v_row.id;
        RETURN jsonb_build_object('outcome', 'already_accepted',
                                  'company_id', v_row.company_id, 'member_id', v_existing.id);
    END;

    PERFORM public.internal_drop_empty_company_shell(v_uid);

    v_masked := left(split_part(v_email, '@', 1),
                     CASE WHEN length(split_part(v_email, '@', 1)) > 2 THEN 2 ELSE 1 END)
                || '***@' || split_part(v_email, '@', 2);
    v_label  := CASE WHEN v_row.role = 'manager'
                     THEN 'Gestor (acesso total à empresa)' ELSE 'Encarregado' END;

    IF v_row.invited_email IS NOT NULL THEN
        v_notice := format(
            '%s entrou na equipe como %s (%s — e-mail informado por você, não verificado). Entrada em %s (horário de São Paulo). É a pessoa certa? Confirme em até 72 horas ou revogue o acesso.',
            COALESCE(v_row.display_name, 'Alguém'), v_label, v_masked,
            to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
        );
    ELSE
        v_notice := format(
            '%s entrou na equipe como %s (%s). Entrada em %s (horário de São Paulo). É a pessoa certa? Confirme em até 72 horas ou revogue o acesso.',
            COALESCE(v_row.display_name, 'Alguém'), v_label, v_masked,
            to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
        );
    END IF;

    FOR v_g IN SELECT g FROM public.internal_company_gestor_ids(v_row.company_id) AS g WHERE g <> v_uid
    LOOP
        PERFORM public.internal_notify_member_event(
            v_g,
            'Nova pessoa na equipe',
            v_notice,
            '/company/configuracoes/equipe?membro=' || v_row.id::text
        );
    END LOOP;

    RETURN jsonb_build_object('outcome', 'accepted',
                              'company_id', v_row.company_id, 'member_id', v_row.id,
                              'role', v_row.role, 'confirmed', false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.accept_company_member_invite(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_company_member_invite(text, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.accept_company_member_invite(text, boolean) IS
    'Aceite do convite de equipe (ADR-20261127): Gestor e Encarregado. Deixa a pessoa active com confirmed_at NULL '
    '(opera ZERO ate o "e ele?"). Exige sessao == invited_email. Outcomes: accepted | already_accepted | '
    'already_member_other_role | already_operator | token_already_used | revoked | expired | not_found | tos_required | '
    'worker_cannot_be_manager | email_not_verified | email_mismatch | invalid_input | unauthenticated.';

-- ============================================================================
-- 10. Confirmar / rejeitar / remover / reenviar / revogar: os dois papeis
-- ============================================================================
CREATE OR REPLACE FUNCTION public.confirm_company_member(p_company_id uuid, p_user_id uuid, p_typed_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
    v_uid uuid := auth.uid();
    v_row public.company_members;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR p_user_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('worki:team:' || p_company_id::text)::bigint);
    -- is_company_owner = dono, operador de organizacao ou Gestor CONFIRMADO: um Gestor nao confirmado
    -- nunca confirma ninguem, e ninguem confirma a si mesmo.
    IF NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF p_user_id = v_uid THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm
     WHERE cm.company_id = p_company_id AND cm.user_id = p_user_id AND cm.status = 'active'
       AND cm.role IN ('encarregado', 'manager')
     FOR UPDATE;
    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_row.confirmed_at IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'already_confirmed', 'member_id', v_row.id);
    END IF;

    IF COALESCE(v_row.accepted_at, v_row.invited_at) <= now() - interval '72 hours' THEN
        UPDATE public.company_members
           SET status = 'removed', removed_at = now(), removed_by = NULL, invite_token = NULL
         WHERE id = v_row.id;
        PERFORM public.internal_revoke_member_coverages(p_company_id, p_user_id);
        RETURN jsonb_build_object('outcome', 'expired', 'member_id', v_row.id);
    END IF;

    IF public.normalize_member_name(p_typed_name) = ''
       OR public.normalize_member_name(p_typed_name)
          IS DISTINCT FROM public.normalize_member_name(v_row.display_name) THEN
        RETURN jsonb_build_object('outcome', 'name_mismatch', 'member_id', v_row.id);
    END IF;

    UPDATE public.company_members
       SET confirmed_at = now(), confirmed_by = v_uid
     WHERE id = v_row.id;

    PERFORM public.internal_notify_member_event(
        p_user_id,
        'Acesso confirmado',
        CASE WHEN v_row.role = 'manager'
             THEN 'Seu acesso como Gestor foi confirmado. Você já pode usar a empresa.'
             ELSE 'O Gestor confirmou o seu acesso à equipe. Você já pode usar o Elenco.' END,
        '/company/hoje'
    );

    RETURN jsonb_build_object('outcome', 'confirmed', 'member_id', v_row.id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.reject_company_member(p_company_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
    v_uid uuid := auth.uid();
    v_row public.company_members;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR p_user_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('worki:team:' || p_company_id::text)::bigint);
    IF NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF p_user_id = v_uid THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm
     WHERE cm.company_id = p_company_id AND cm.user_id = p_user_id AND cm.status = 'active'
       AND cm.role IN ('encarregado', 'manager')
     FOR UPDATE;
    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_row.confirmed_at IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'not_pending_confirmation', 'member_id', v_row.id);
    END IF;

    UPDATE public.company_members
       SET status = 'removed', removed_at = now(), removed_by = v_uid, invite_token = NULL
     WHERE id = v_row.id;
    PERFORM public.internal_revoke_member_coverages(p_company_id, p_user_id);

    RETURN jsonb_build_object('outcome', 'rejected', 'member_id', v_row.id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.remove_company_member(p_company_id uuid, p_user_id uuid, p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
    v_uid        uuid := auth.uid();
    v_row        public.company_members;
    v_open_jobs  integer;
    v_rotate     boolean;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR p_user_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;
    IF NOT COALESCE(p_dry_run, false) THEN
        PERFORM pg_advisory_xact_lock(hashtext('worki:team:' || p_company_id::text)::bigint);
    END IF;
    IF NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF p_user_id = v_uid THEN
        RETURN jsonb_build_object('outcome', 'cannot_remove_self');
    END IF;

    IF COALESCE(p_dry_run, false) THEN
        SELECT * INTO v_row FROM public.company_members cm
         WHERE cm.company_id = p_company_id AND cm.user_id = p_user_id AND cm.status = 'active';
    ELSE
        SELECT * INTO v_row FROM public.company_members cm
         WHERE cm.company_id = p_company_id AND cm.user_id = p_user_id AND cm.status = 'active'
         FOR UPDATE;
    END IF;
    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM public.company_members cm
                    WHERE cm.company_id = p_company_id AND cm.user_id = p_user_id
                      AND cm.status = 'removed') THEN
            RETURN jsonb_build_object(
                'outcome', CASE WHEN COALESCE(p_dry_run, false) THEN 'would_remove' ELSE 'removed' END,
                'already_removed', true);
        END IF;
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- ADR-20261127 D6: remover Gestor e do dono ou de outro Gestor confirmado (is_company_owner acima);
    -- ninguem remove o dono (nao e linha de company_members). O ramo "so operador de organizacao" saiu.
    IF v_row.role = 'manager'
       AND NOT public.internal_company_has_gestor_besides_member(p_company_id, p_user_id) THEN
        RETURN jsonb_build_object('outcome', 'last_manager');
    END IF;

    SELECT count(*) INTO v_open_jobs
      FROM public.jobs j
     WHERE j.company_id     = p_company_id
       AND j.responsible_id = p_user_id
       AND j.status        IN ('open', 'paused')
       AND j.start_date    >= now();

    v_rotate := (v_row.role = 'manager' OR v_row.confirmed_at IS NOT NULL);

    IF COALESCE(p_dry_run, false) THEN
        RETURN jsonb_build_object('outcome', 'would_remove', 'member_id', v_row.id,
                                  'display_name', v_row.display_name, 'role', v_row.role,
                                  'open_jobs', v_open_jobs,
                                  'elenco_link_rotation_advised', v_rotate);
    END IF;

    UPDATE public.company_members
       SET status = 'removed', removed_at = now(), removed_by = v_uid, invite_token = NULL
     WHERE id = v_row.id;
    PERFORM public.internal_revoke_member_coverages(p_company_id, p_user_id);

    RETURN jsonb_build_object('outcome', 'removed', 'member_id', v_row.id,
                              'display_name', v_row.display_name, 'role', v_row.role,
                              'open_jobs', v_open_jobs,
                              'elenco_link_rotation_advised', v_rotate);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.resend_member_invite(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
    v_uid     uuid := auth.uid();
    v_row     public.company_members;
    v_token   text;
    v_exp     timestamptz;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_member_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm WHERE cm.id = p_member_id FOR UPDATE;
    IF v_row.id IS NULL OR v_row.role NOT IN ('encarregado', 'manager') THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF NOT public.is_company_owner(v_row.company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF v_row.status <> 'invited' THEN
        RETURN jsonb_build_object('outcome', 'not_pending');
    END IF;

    v_token := public.generate_invite_token();
    UPDATE public.company_members
       SET invite_token = v_token,
           expires_at   = now() + interval '14 days'
     WHERE id = v_row.id
    RETURNING expires_at INTO v_exp;

    RETURN jsonb_build_object('outcome', 'resent', 'member_id', v_row.id,
                              'invite_token', v_token, 'expires_at', v_exp);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.revoke_member_invite(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
    v_uid     uuid := auth.uid();
    v_row     public.company_members;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_member_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm WHERE cm.id = p_member_id FOR UPDATE;
    IF v_row.id IS NULL OR v_row.role NOT IN ('encarregado', 'manager') THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF NOT public.is_company_owner(v_row.company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF v_row.status <> 'invited' THEN
        RETURN jsonb_build_object('outcome', 'not_pending');
    END IF;

    UPDATE public.company_members
       SET status            = 'removed',
           removed_at        = now(),
           removed_by        = v_uid,
           invite_token_hash = CASE WHEN invite_token IS NOT NULL
                                    THEN encode(sha256(convert_to(invite_token, 'UTF8')), 'hex')
                                    ELSE invite_token_hash END,
           invite_token      = NULL
     WHERE id = v_row.id;

    RETURN jsonb_build_object('outcome', 'revoked', 'member_id', v_row.id);
END;
$fn$;

-- ============================================================================
-- 11. list_company_members: awaiting_confirmation para manager tambem + loja padrao
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_company_members(p_company_id uuid, p_include_removed boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
    v_items jsonb;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    SELECT COALESCE(jsonb_agg(
               jsonb_build_object(
                   'member_id',      cm.id,
                   'user_id',        cm.user_id,
                   'display_name',   cm.display_name,
                   'role',           cm.role,
                   'status',         cm.status,
                   'state',          CASE
                                         WHEN cm.status = 'removed' THEN 'removed'
                                         WHEN cm.status = 'invited'
                                              AND (cm.expires_at IS NULL OR cm.expires_at <= now())
                                              THEN 'invite_expired'
                                         WHEN cm.status = 'invited' THEN 'invited'
                                         WHEN cm.confirmed_at IS NULL
                                              AND COALESCE(cm.accepted_at, cm.invited_at) <= now() - interval '72 hours'
                                              THEN 'pending_expired'
                                         WHEN cm.confirmed_at IS NULL
                                              THEN 'awaiting_confirmation'
                                         ELSE 'active'
                                     END,
                   'confirmed',      cm.confirmed_at IS NOT NULL,
                   'confirmation_expires_at',
                                     CASE WHEN cm.status = 'active' AND cm.confirmed_at IS NULL
                                          THEN COALESCE(cm.accepted_at, cm.invited_at) + interval '72 hours'
                                     END,
                   'accepted_email', cm.accepted_email,
                   'invited_email',  cm.invited_email,
                   'invited_at',     cm.invited_at,
                   'expires_at',     cm.expires_at,
                   'accepted_at',    cm.accepted_at,
                   'confirmed_at',   cm.confirmed_at,
                   'removed_at',     cm.removed_at,
                   'default_tag_id',   cm.default_tag_id,
                   'default_tag_name', tg.name
               )
               ORDER BY (cm.status = 'active' AND cm.confirmed_at IS NULL) DESC,
                        cm.status, lower(cm.display_name), cm.id
           ), '[]'::jsonb)
      INTO v_items
      FROM public.company_members cm
      LEFT JOIN public.company_tags tg ON tg.id = cm.default_tag_id AND tg.company_id = cm.company_id
     WHERE cm.company_id = p_company_id
       AND (COALESCE(p_include_removed, false) OR cm.status <> 'removed');

    RETURN jsonb_build_object(
        'outcome', 'ok',
        'items', v_items,
        'elenco_link_rotation_pending',
        EXISTS (
            SELECT 1 FROM public.company_members rm
             WHERE rm.company_id = p_company_id
               AND rm.status = 'removed'
               AND rm.role IN ('manager', 'encarregado')
               AND (rm.confirmed_at IS NOT NULL
                    OR (rm.role = 'manager' AND rm.accepted_at IS NOT NULL))
               AND rm.removed_at > COALESCE(
                       (SELECT l.rotated_at FROM public.company_invite_links l
                         WHERE l.company_id = p_company_id),
                       '-infinity'::timestamptz)
        )
    );
END;
$fn$;

-- ============================================================================
-- 12. Gestor convidado pendente nao enxerga lojas nem cobertura (company_tags_select e afins)
--     is_company_member = qualquer membro ativo (inclusive NAO confirmado); _confirmed exige confirmed_at.
-- ============================================================================
ALTER POLICY company_tags_select ON public.company_tags
    USING (public.is_company_member_confirmed(company_id));

ALTER POLICY rc_select_partes_ou_gestor ON public.responsibility_coverages
    USING (
        public.is_company_owner(company_id)
        OR (
            (from_user_id = (SELECT auth.uid()) OR to_user_id = (SELECT auth.uid()))
            AND public.is_company_member_confirmed(company_id)
        )
    );

-- ============================================================================
-- 13. get_invite_preview (anon): so tokens de ELENCO (48 hex). Token de Gestor (64 hex) nao revela mais nada.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_invite_preview(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
    c_not_found constant jsonb :=
        '{"outcome": "not_found", "inviter_name": null, "kind": null}'::jsonb;
    v_name text;
BEGIN
    IF p_token IS NULL OR octet_length(p_token) <> 48 OR p_token !~ '^[0-9a-f]+$' THEN
        RETURN c_not_found;
    END IF;

    SELECT c.name INTO v_name
      FROM public.company_invite_links l
      JOIN public.companies c ON c.id = l.company_id
     WHERE l.token = p_token
       AND c.anonymized_at IS NULL;

    v_name := NULLIF(btrim(COALESCE(v_name, '')), '');
    IF v_name IS NULL THEN
        RETURN c_not_found;
    END IF;

    RETURN jsonb_build_object('outcome', 'ok', 'inviter_name', v_name, 'kind', 'elenco');
END;
$fn$;

-- ============================================================================
-- 14. create_company_tag: mesma normalizacao de espacos de rename_company_tag
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_company_tag(p_company_id uuid, p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
    v_uid  uuid := (SELECT auth.uid());
    v_name text := btrim(regexp_replace(replace(COALESCE(p_name, ''), chr(160), ' '), '[[:space:]]+', ' ', 'g'));
    v_tag  public.company_tags%ROWTYPE;
    v_id   uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR length(v_name) < 1 OR length(v_name) > 40 OR v_name ~ '[[:cntrl:]]' THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;
    IF NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    SELECT * INTO v_tag FROM public.company_tags t
     WHERE t.company_id = p_company_id AND lower(btrim(t.name)) = lower(v_name)
     FOR UPDATE;
    IF FOUND THEN
        IF v_tag.archived_at IS NULL THEN
            RETURN jsonb_build_object('outcome', 'already_exists', 'tag_id', v_tag.id);
        END IF;
        UPDATE public.company_tags SET archived_at = NULL WHERE id = v_tag.id;
        RETURN jsonb_build_object('outcome', 'reactivated', 'tag_id', v_tag.id);
    END IF;

    BEGIN
        INSERT INTO public.company_tags (company_id, name, created_by)
        VALUES (p_company_id, v_name, v_uid)
        RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        SELECT t.id INTO v_id FROM public.company_tags t
         WHERE t.company_id = p_company_id AND lower(btrim(t.name)) = lower(v_name);
        RETURN jsonb_build_object('outcome', 'already_exists', 'tag_id', v_id);
    END;

    RETURN jsonb_build_object('outcome', 'created', 'tag_id', v_id);
END;
$fn$;

-- ============================================================================
-- DOWN: supabase/migrations/_rollback/20261204000400_down.sql (gerado das definicoes VIVAS antes de aplicar).
-- NAO executar enquanto houver manager confirmado por este fluxo ou loja padrao em uso.
-- ============================================================================
-- REVOKE EXECUTE ... e re-GRANT authenticated de invite_company_manager(uuid,text), accept_manager_invite(text),
--   revoke_company_manager(uuid,uuid) so se o dono quiser reabrir a F13 (nao recomendado).
-- DROP FUNCTION IF EXISTS public.set_member_default_tag(uuid, uuid, uuid);
-- DROP FUNCTION IF EXISTS public.rename_company_tag(uuid, text);
-- DROP FUNCTION IF EXISTS public.internal_member_default_tag(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.invite_company_member(uuid, text, text, text, uuid);
-- ALTER TABLE public.company_members DROP CONSTRAINT IF EXISTS company_members_default_tag_role_chk;
-- ALTER TABLE public.company_members DROP CONSTRAINT IF EXISTS company_members_default_tag_fk;
-- ALTER TABLE public.company_members DROP COLUMN IF EXISTS default_tag_id;
-- ALTER TABLE public.company_tags DROP CONSTRAINT IF EXISTS company_tags_company_id_id_key;
-- Restaurar corpos anteriores a partir de 20261123000300 / 000500 / 000600 / 20260818* e de
-- 20261127000200 (invite_company_member de 4 args, preview, provision_check, accept_company_member_invite),
-- recriando invite_company_member(uuid,text,text,text) e restaurando os corpos de: session_operates_company_membership,
-- internal_company_gestor_ids, internal_company_confirmed_operator, internal_company_has_gestor_besides_member,
-- is_organization_member, notification_recipients_for_job, get_my_companies, list_company_members, jobs_responsible_guard,
-- archive_company_tag, confirm/reject/remove_company_member, resend_member_invite, revoke_member_invite.
-- DOWN do seam so e seguro se nenhum manager existir.
