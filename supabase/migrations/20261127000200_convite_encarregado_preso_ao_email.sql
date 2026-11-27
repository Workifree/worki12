-- Migration: Convite de Encarregado preso ao e-mail, sem OTP e sem envio de e-mail
-- File: supabase/migrations/20261127000200_convite_encarregado_preso_ao_email.sql
-- ADR:  .harness/memory-bank/decisions/ADR-20261127-convite-encarregado-preso-ao-email.md
--
-- Pre-requisito: E4 (20261123000500_equipe_e4_convites_e_papel.sql) aplicada.
-- Nenhuma coluna nova e nenhum ALTER TABLE. Nao toca saldo (Article 8).
--
-- Ordem de deploy:
--   1. Aplicar esta migration
--   2. supabase functions deploy accept-team-invite --no-verify-jwt
--   3. Publicar frontend

-- ============================================================================
-- 1. invite_company_member(uuid, text, text, text DEFAULT NULL)
--    Convite novo exige e-mail (email_required / invalid_email).
--    Idempotencia por (empresa, e-mail). Recusa freela e membro ativo.
-- ============================================================================
DROP FUNCTION IF EXISTS public.invite_company_member(uuid, text, text);

CREATE OR REPLACE FUNCTION public.invite_company_member(
    p_company_id   uuid,
    p_display_name text,
    p_role         text,
    p_email        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
       OR p_role IS DISTINCT FROM 'encarregado'
       OR length(v_name) < 1 OR length(v_name) > 80
       OR v_name ~ '[[:cntrl:]]' THEN
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

    IF NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- Nome armazenado com espacos colapsados (acentos PRESERVADOS: e texto visivel).
    v_name := btrim(regexp_replace(replace(v_name, chr(160), ' '), '[[:space:]]+', ' ', 'g'));
    IF public.normalize_member_name(v_name) = '' THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('worki:team:' || p_company_id::text)::bigint);

    -- Recusa no convite se o e-mail ja e conta de freela (Article 1).
    IF EXISTS (
        SELECT 1
          FROM auth.users u
          JOIN public.workers w ON w.id = u.id
         WHERE lower(btrim(COALESCE(u.email, ''))) = v_email
    ) THEN
        RETURN jsonb_build_object('outcome', 'worker_cannot_be_manager');
    END IF;

    -- Se o e-mail ja pertence a um membro ATIVO desta empresa, devolve already_member.
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

    -- Idempotencia por (empresa, e-mail): se houver convite pendente para o mesmo e-mail,
    -- devolve o vigente ou reemite se vencido.
    SELECT * INTO v_row FROM public.company_members cm
     WHERE cm.company_id = p_company_id
       AND cm.status = 'invited'
       AND cm.role = p_role
       AND cm.invited_email IS NOT NULL
       AND lower(btrim(cm.invited_email)) = v_email
     ORDER BY cm.invited_at, cm.id
     LIMIT 1
     FOR UPDATE;

    IF v_row.id IS NOT NULL THEN
        IF v_row.expires_at IS NOT NULL AND v_row.expires_at > now() THEN
            RETURN jsonb_build_object('outcome', 'already_invited', 'member_id', v_row.id,
                                      'invite_token', v_row.invite_token, 'expires_at', v_row.expires_at);
        END IF;
        v_token := public.generate_invite_token();
        UPDATE public.company_members
           SET invite_token = v_token,
               expires_at   = now() + interval '14 days'
         WHERE id = v_row.id
        RETURNING expires_at INTO v_exp;
        RETURN jsonb_build_object('outcome', 'reinvited', 'member_id', v_row.id,
                                  'invite_token', v_token, 'expires_at', v_exp);
    END IF;

    -- Se houver convite pendente com o mesmo nome normalizado e outro e-mail, nao sobrescreve.
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
            (company_id, user_id, role, status, display_name, invited_email, invite_token, expires_at, created_by)
        VALUES
            (p_company_id, NULL, p_role, 'invited', v_name, v_email, v_token, now() + interval '14 days', v_uid)
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

COMMENT ON FUNCTION public.invite_company_member(uuid, text, text, text) IS
    'Convida ENCARREGADO para a equipe preso ao e-mail (ADR-20261127): nome + papel (so encarregado) '
    '+ e-mail obrigatorio. Idempotente por (empresa, e-mail). Recusa freela (worker_cannot_be_manager) '
    'e membro ativo (already_member). Outcomes: invited | already_invited | reinvited | '
    'name_already_invited | already_member | worker_cannot_be_manager | email_required | '
    'invalid_email | forbidden | invalid_input | not_found | unauthenticated.';

REVOKE ALL ON FUNCTION public.invite_company_member(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_company_member(uuid, text, text, text) TO authenticated, service_role;

-- ============================================================================
-- 2. get_member_invite_preview(text) — devolve email_masked e email_bound
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_member_invite_preview(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
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
    IF v_row.id IS NULL OR v_row.status <> 'invited' OR v_row.role <> 'encarregado' THEN
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

COMMENT ON FUNCTION public.get_member_invite_preview(text) IS
    'Previa do convite para a tela "{Empresa} te convidou como {Papel}": {outcome ok|expired|not_found, '
    'company_name, role, email_masked, email_bound}. Nunca devolve e-mail completo. EXECUTE para anon '
    'por EXCECAO unica e explicita (ADR-20261123-previa-publica-do-convite + ADR-20261127).';

REVOKE ALL ON FUNCTION public.get_member_invite_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_invite_preview(text) TO anon, authenticated, service_role;

-- ============================================================================
-- 3. accept_company_member_invite(text, boolean)
--    Exige sessao == invited_email quando invited_email IS NOT NULL (email_mismatch sem consumir token).
--    Aviso ao Gestor diz "e-mail informado por voce, nao verificado" para convites presos ao e-mail.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.accept_company_member_invite(
    p_token      text,
    p_accept_tos boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid      uuid := auth.uid();
    v_tok      text := NULLIF(btrim(COALESCE(p_token, '')), '');
    v_hash     text;
    v_row      public.company_members;
    v_existing uuid;
    v_email    text;
    v_verified boolean;
    v_g        uuid;
    v_cn       text;
    v_company  uuid;
    v_masked   text;
    v_notice   text;
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

    IF v_row.role <> 'encarregado' THEN
        RETURN jsonb_build_object('outcome', 'use_manager_invite');
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

    SELECT lower(btrim(u.email)), (u.email_confirmed_at IS NOT NULL)
      INTO v_email, v_verified
      FROM auth.users u WHERE u.id = v_uid;
    IF v_email IS NULL OR NOT COALESCE(v_verified, false) THEN
        RETURN jsonb_build_object('outcome', 'email_not_verified');
    END IF;

    -- ADR-20261127: convite preso ao e-mail exige sessao == invited_email (sem consumir o token).
    IF v_row.invited_email IS NOT NULL
       AND v_email <> lower(btrim(v_row.invited_email)) THEN
        RETURN jsonb_build_object('outcome', 'email_mismatch');
    END IF;

    UPDATE public.company_members
       SET status = 'removed', removed_at = now(), removed_by = NULL, invite_token = NULL
     WHERE company_id = v_row.company_id
       AND user_id    = v_uid
       AND status     = 'active'
       AND role       = 'encarregado'
       AND confirmed_at IS NULL
       AND COALESCE(accepted_at, invited_at) <= now() - interval '72 hours'
       AND id <> v_row.id;

    SELECT cm.id INTO v_existing
      FROM public.company_members cm
     WHERE cm.company_id = v_row.company_id
       AND cm.user_id    = v_uid
       AND cm.status     = 'active'
       AND cm.id <> v_row.id;
    IF v_existing IS NOT NULL THEN
        UPDATE public.company_members
           SET status = 'removed', removed_at = now(), invite_token = NULL, invite_token_hash = v_hash
         WHERE id = v_row.id;
        RETURN jsonb_build_object('outcome', 'already_accepted',
                                  'company_id', v_row.company_id, 'member_id', v_existing);
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
        SELECT cm.id INTO v_existing
          FROM public.company_members cm
         WHERE cm.company_id = v_row.company_id AND cm.user_id = v_uid
           AND cm.status = 'active' AND cm.id <> v_row.id;
        UPDATE public.company_members
           SET status = 'removed', removed_at = now(), invite_token = NULL, invite_token_hash = v_hash
         WHERE id = v_row.id;
        RETURN jsonb_build_object('outcome', 'already_accepted',
                                  'company_id', v_row.company_id, 'member_id', v_existing);
    END;

    PERFORM public.internal_drop_empty_company_shell(v_uid);

    v_masked := left(split_part(v_email, '@', 1),
                     CASE WHEN length(split_part(v_email, '@', 1)) > 2 THEN 2 ELSE 1 END)
                || '***@' || split_part(v_email, '@', 2);

    IF v_row.invited_email IS NOT NULL THEN
        v_notice := format(
            '%s entrou na equipe como Encarregado (%s — e-mail informado por você, não verificado). Entrada em %s (horário de São Paulo). É a pessoa certa? Confirme em até 72 horas ou revogue o acesso.',
            COALESCE(v_row.display_name, 'Alguém'),
            v_masked,
            to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
        );
    ELSE
        v_notice := format(
            '%s entrou na equipe como Encarregado (%s). Entrada em %s (horário de São Paulo). É a pessoa certa? Confirme em até 72 horas ou revogue o acesso.',
            COALESCE(v_row.display_name, 'Alguém'),
            v_masked,
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

COMMENT ON FUNCTION public.accept_company_member_invite(text, boolean) IS
    'Aceite do convite de equipe pela sessao autenticada (ADR-20261127). Quando invited_email IS NOT NULL, '
    'exige que o e-mail da sessao seja igual ao e-mail do convite (email_mismatch sem consumir o token). '
    'Outcomes: accepted | already_accepted | already_operator | token_already_used | revoked | expired | '
    'not_found | use_manager_invite | tos_required | worker_cannot_be_manager | email_not_verified | '
    'email_mismatch | invalid_input | unauthenticated.';

REVOKE ALL ON FUNCTION public.accept_company_member_invite(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_company_member_invite(text, boolean) TO authenticated, service_role;

-- ============================================================================
-- 4. internal_team_invite_provision_check(text)
--    Chamada EXCLUSIVAMENTE pela Edge Function accept-team-invite (service_role).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.internal_team_invite_provision_check(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
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
    IF v_row.id IS NULL OR v_row.status <> 'invited' OR v_row.role <> 'encarregado' THEN
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
    ELSIF EXISTS (SELECT 1 FROM public.workers w WHERE w.id = v_uid) THEN
        v_account := 'worker';
    ELSIF v_conf_at IS NULL THEN
        v_account := 'unconfirmed';
    ELSE
        v_account := 'company';
    END IF;

    RETURN jsonb_build_object(
        'outcome', 'ok',
        'email',   v_email,
        'account', v_account
    );
END;
$fn$;

COMMENT ON FUNCTION public.internal_team_invite_provision_check(text) IS
    'INTERNA (service_role). Valida token de convite de encarregado e classifica o e-mail em auth.users '
    'e public.workers (none | company | worker | unconfirmed) para a Edge Function accept-team-invite. '
    'ADR-20261127.';

REVOKE ALL ON FUNCTION public.internal_team_invite_provision_check(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_team_invite_provision_check(text) TO service_role;

-- ============================================================================
-- 5. list_company_members: passa a devolver invited_email (so Gestor chega aqui: is_company_owner)
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
                                         WHEN cm.role = 'encarregado' AND cm.confirmed_at IS NULL
                                              AND COALESCE(cm.accepted_at, cm.invited_at) <= now() - interval '72 hours'
                                              THEN 'pending_expired'
                                         WHEN cm.role = 'encarregado' AND cm.confirmed_at IS NULL
                                              THEN 'awaiting_confirmation'
                                         ELSE 'active'
                                     END,
                   'confirmed',      cm.confirmed_at IS NOT NULL,
                   'confirmation_expires_at',
                                     CASE WHEN cm.status = 'active' AND cm.role = 'encarregado'
                                               AND cm.confirmed_at IS NULL
                                          THEN COALESCE(cm.accepted_at, cm.invited_at) + interval '72 hours'
                                     END,
                   'accepted_email', cm.accepted_email,
                   'invited_email',  cm.invited_email,
                   'invited_at',     cm.invited_at,
                   'expires_at',     cm.expires_at,
                   'accepted_at',    cm.accepted_at,
                   'confirmed_at',   cm.confirmed_at,
                   'removed_at',     cm.removed_at
               )
               ORDER BY (cm.status = 'active' AND cm.confirmed_at IS NULL) DESC,
                        cm.status, lower(cm.display_name), cm.id
           ), '[]'::jsonb)
      INTO v_items
      FROM public.company_members cm
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
