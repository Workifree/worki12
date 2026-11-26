-- Migration: travas de integridade (lacunas do mapa do copiloto, provadas em producao com rollback em 25/11/2026)
-- File: supabase/migrations/20261126000700_travas_de_integridade.sql
--
-- FALHAS CONFIRMADAS:
--   (1) team_connections: o freela trocava company_id (entrava no Elenco de qualquer empresa) e desfazia
--       bloqueio feito pela empresa; a empresa trocava o worker_id de um vinculo.
--   (2) workers/companies: a propria pessoa (ou o gerente) gravava nota, contagem de avaliacoes, selo de
--       identidade, XP, ganhos etc., no UPDATE e no INSERT.
--   (3) notifications: a contraparte vinculada gravava link arbitrario (inclusive /convite*, que aceita
--       convite ao abrir).
--   (4) shift_payments sem candidatura (ou com candidatura de outro turno): o trigger do termo (DEFINER)
--       copiava o CPF de um freela SEM vinculo para service_terms, legivel pela empresa.
--   (5) Conversation: um participante reapontava a conversa para candidatura em outra empresa, que
--       passava a ler o historico.
--   (6) storage avatars: qualquer logado criava arquivo na pasta de outra conta.
--
-- NAO MUDA regra de negocio. Seguem abertos (decisao de produto): editar turno aceito; pagamento sem
-- presenca ou sem teto; cpf, accepted_tos, onboarding_completed, cnpj e email graveveis; titulo/texto
-- livres em notificacao.
--
-- Distincao cliente x servidor: current_user em trigger SECURITY INVOKER (padrao de 20261125000100).
-- DEFINER (dono), service_role e manutencao passam. NENHUMA destas funcoes pode virar DEFINER.
-- Nome trg_zz_*: dispara depois dos trg_* e ANTES dos trigger_* (ex.: trigger_award_xp_on_photo, que
-- soma XP no upload de foto e por isso nao e barrado: o guard ve so o que o cliente mandou).
-- Article 8: nao toca saldo. Nenhuma linha existente e alterada.
--
-- DOWN (reabre as falhas):
--   DROP TRIGGER trg_zz_team_connections_guard ON public.team_connections;
--   DROP TRIGGER trg_zz_workers_trust_guard ON public.workers;
--   DROP TRIGGER trg_zz_companies_trust_guard ON public.companies;
--   DROP TRIGGER trg_zz_notifications_link_guard ON public.notifications;
--   DROP TRIGGER trg_zz_shift_payments_insert_guard ON public.shift_payments;
--   DROP FUNCTION public.team_connections_update_guard(), public.profile_trust_guard(),
--                 public.notifications_link_guard(), public.shift_payments_insert_guard();
--   Conversation: recriar "conversation_update_participants" (USING/CHECK can_access_application).
--   avatars: recriar INSERT com bucket_id='avatars' AND auth.role()='authenticated' e UPDATE sem CHECK.

BEGIN;

-- 0. Pre-condicao: quem escreve nestas tabelas por funcao tem de ser DEFINER privilegiada.
DO $$
DECLARE
    v_bad text;
BEGIN
    SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND regexp_replace(p.prosrc, '--[^\r\n]*', '', 'g')
           ~* '\m(insert\s+into|update)\s+("?public"?\.)?"?(workers|companies|team_connections|notifications|shift_payments)\M'
       AND (NOT p.prosecdef
            OR pg_catalog.pg_get_userbyid(p.proowner) NOT IN ('postgres', 'service_role', 'supabase_admin'));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'ASSERCAO: funcao(oes) escrevem em tabela travada sem ser DEFINER privilegiada: %. HALT.', v_bad;
    END IF;
END $$;

-- 1. team_connections
CREATE OR REPLACE FUNCTION public.team_connections_update_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_uid uuid;
BEGIN
    IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
        RETURN NEW;
    END IF;
    v_uid := (SELECT auth.uid());

    -- Lista de permitidos: so status, accepted_at, blocked_by e updated_at mudam pelo cliente.
    IF (pg_catalog.to_jsonb(NEW) - ARRAY['status', 'accepted_at', 'blocked_by', 'updated_at'])
       IS DISTINCT FROM
       (pg_catalog.to_jsonb(OLD) - ARRAY['status', 'accepted_at', 'blocked_by', 'updated_at'])
    THEN
        RAISE EXCEPTION 'team_connections: coluna do vinculo nao pode ser alterada.' USING ERRCODE = '42501';
    END IF;

    -- Bloqueio so e mexido por quem bloqueou (blocked_by NULL = ninguem pelo cliente).
    IF OLD.status = 'blocked' AND OLD.blocked_by IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'team_connections: bloqueio so pode ser alterado por quem bloqueou.' USING ERRCODE = '42501';
    END IF;

    -- Ninguem grava bloqueio em nome de outra pessoa.
    IF NEW.blocked_by IS DISTINCT FROM OLD.blocked_by
       AND NEW.blocked_by IS NOT NULL AND NEW.blocked_by IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'team_connections: blocked_by invalido.' USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zz_team_connections_guard ON public.team_connections;
CREATE TRIGGER trg_zz_team_connections_guard
    BEFORE UPDATE ON public.team_connections
    FOR EACH ROW EXECUTE FUNCTION public.team_connections_update_guard();

-- 2. workers e companies: colunas que o cliente pode escrever. Coluna nova nasce travada:
--    para o app grava-la, acrescente-a aqui (argumentos do trigger).
CREATE OR REPLACE FUNCTION public.profile_trust_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_permitidas text[] := TG_ARGV[0]::text[];
    v_col text;
    v_val jsonb;
BEGIN
    IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF (pg_catalog.to_jsonb(NEW) - v_permitidas) IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) - v_permitidas) THEN
            RAISE EXCEPTION '%: campo calculado pelo sistema nao pode ser alterado.', TG_TABLE_NAME
                USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    END IF;

    -- INSERT (vale tambem para upsert, que passa aqui com os defaults): fora da lista, so o valor
    -- inicial. created_at e imposto pelo servidor.
    FOR v_col, v_val IN
        SELECT e.key, e.value FROM pg_catalog.jsonb_each(pg_catalog.to_jsonb(NEW) - v_permitidas - 'created_at') e
    LOOP
        IF v_val <> 'null'::jsonb
           AND NOT COALESCE((TG_ARGV[1]::jsonb -> v_col) @> pg_catalog.jsonb_build_array(v_val), false)
        THEN
            RAISE EXCEPTION '%: campo % e calculado pelo sistema.', TG_TABLE_NAME, v_col USING ERRCODE = '42501';
        END IF;
    END LOOP;
    NEW.created_at := pg_catalog.now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zz_workers_trust_guard ON public.workers;
CREATE TRIGGER trg_zz_workers_trust_guard
    BEFORE INSERT OR UPDATE ON public.workers
    FOR EACH ROW EXECUTE FUNCTION public.profile_trust_guard(
        '{id,full_name,phone,city,primary_role,experience_years,bio,availability,availability_days,goal,roles,avatar_url,cover_url,pix_key,cpf,birth_date,onboarding_completed,accepted_tos,tos_version,tos_accepted_at,badges_hidden,accepts_referrals,discoverable_for_sos,updated_at}',
        '{"level":[1],"xp":[0],"earnings_total":[0],"completed_jobs_count":[0],"reviews_count":[0],"rating_average":[0],"recommendation_score":[0],"views":[0],"profile_views":[0],"verified_identity":[false],"tags":[[]]}');

-- owner_id/organization_id ficam na lista: enforce_company_hierarchy_immutability ja cuida deles.
DROP TRIGGER IF EXISTS trg_zz_companies_trust_guard ON public.companies;
CREATE TRIGGER trg_zz_companies_trust_guard
    BEFORE INSERT OR UPDATE ON public.companies
    FOR EACH ROW EXECUTE FUNCTION public.profile_trust_guard(
        '{id,owner_id,organization_id,name,cnpj,address,industry,size,description,website,email,logo_url,cover_url,company_type,city,default_briefing,link_risk_alert_enabled,link_risk_alert_threshold,onboarding_completed,accepted_tos,tos_version,tos_accepted_at}',
        '{"rating_average":[0,5],"reviews_count":[0]}');

-- 3. notifications: aviso de cliente para TERCEIRO so leva rota conhecida (as 2 que o app usa).
CREATE OR REPLACE FUNCTION public.notifications_link_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
        RETURN NEW;
    END IF;
    IF NEW.user_id IS DISTINCT FROM (SELECT auth.uid())
       AND NEW.link IS NOT NULL
       AND NEW.link !~ '^(/my-jobs|/company/jobs/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/candidates)$'
    THEN
        RAISE EXCEPTION 'notifications: link nao permitido em aviso para outra pessoa.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

-- UPDATE tambem: o destinatario so atualiza a propria linha, entao o ramo de terceiro nao o atinge.
DROP TRIGGER IF EXISTS trg_zz_notifications_link_guard ON public.notifications;
CREATE TRIGGER trg_zz_notifications_link_guard
    BEFORE INSERT OR UPDATE ON public.notifications
    FOR EACH ROW EXECUTE FUNCTION public.notifications_link_guard();

-- 4. shift_payments: o registro tem de apontar para a candidatura daquele freela naquele turno.
--    (Nao exige status nem presenca: isso e regra de produto.)
CREATE OR REPLACE FUNCTION public.shift_payments_insert_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
        RETURN NEW;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.applications a
         WHERE a.id = NEW.application_id AND a.job_id = NEW.job_id AND a.worker_id = NEW.worker_id
    ) THEN
        RAISE EXCEPTION 'shift_payments: pagamento exige a candidatura deste freela neste turno.'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zz_shift_payments_insert_guard ON public.shift_payments;
CREATE TRIGGER trg_zz_shift_payments_insert_guard
    BEFORE INSERT ON public.shift_payments
    FOR EACH ROW EXECUTE FUNCTION public.shift_payments_insert_guard();

-- 5. Conversation: nenhum cliente faz UPDATE (conferido na branch e na main).
DROP POLICY IF EXISTS "Participants can update conversations" ON public."Conversation";
DROP POLICY IF EXISTS "conversation_update_participants" ON public."Conversation";

-- 6. avatars: so na propria pasta ou na pasta de empresa que a sessao administra.
DROP POLICY IF EXISTS "Authenticated users can upload avatars" ON storage.objects;
CREATE POLICY "Authenticated users can upload avatars" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'avatars' AND position('/' in name) > 0
        AND (split_part(name, '/', 1) = (SELECT auth.uid())::text
             OR CASE WHEN split_part(name, '/', 1) ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                     THEN public.is_company_owner(split_part(name, '/', 1)::uuid)
                     ELSE false END)
    );

DROP POLICY IF EXISTS "Users can update own avatars" ON storage.objects;
CREATE POLICY "Users can update own avatars" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'avatars' AND (SELECT auth.uid()) = owner)
    WITH CHECK (
        bucket_id = 'avatars' AND (SELECT auth.uid()) = owner
        AND (split_part(name, '/', 1) = (SELECT auth.uid())::text
             OR CASE WHEN split_part(name, '/', 1) ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                     THEN public.is_company_owner(split_part(name, '/', 1)::uuid)
                     ELSE false END)
    );

-- 7. Verificacao
DO $$
DECLARE
    v_n integer;
BEGIN
    SELECT count(*) INTO v_n
      FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
     WHERE t.tgname IN ('trg_zz_team_connections_guard', 'trg_zz_workers_trust_guard',
                        'trg_zz_companies_trust_guard', 'trg_zz_notifications_link_guard',
                        'trg_zz_shift_payments_insert_guard')
       AND t.tgenabled = 'O' AND NOT p.prosecdef;
    IF v_n <> 5 THEN
        RAISE EXCEPTION 'VERIFICACAO: esperava 5 guards INVOKER ativos, achei %. HALT.', v_n;
    END IF;

    -- polcmd: w=UPDATE, *=ALL
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy
                WHERE polrelid = 'public."Conversation"'::regclass AND polcmd IN ('w', '*')) THEN
        RAISE EXCEPTION 'VERIFICACAO: Conversation ainda tem policy de UPDATE/ALL. HALT.';
    END IF;

    SELECT count(*) INTO v_n FROM pg_catalog.pg_policy
     WHERE polrelid = 'storage.objects'::regclass AND polcmd IN ('a', '*')
       AND polname <> 'Authenticated users can upload avatars'
       AND pg_catalog.pg_get_expr(polwithcheck, polrelid) ~ 'avatars';
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'VERIFICACAO: outra policy de INSERT em avatars. HALT.';
    END IF;
END $$;

COMMIT;
