-- Migration: Equipe e encarregados, E1 — schema aditivo (nada existente e removido ou reescrito)
-- File: supabase/migrations/20261123000200_equipe_e1_schema_aditivo.sql
-- Spec:  .harness/spec/equipe-encarregados/spec.md (R2, R20)
-- Gate:  .harness/spec/equipe-encarregados/gate-architect.md (G7, G8, D6)
-- ADRs:  ADR-20261123-elenco-unico-da-company, ADR-20261123-remover-pessoa-so-corta-acesso,
--        ADR-20261123-responsavel-efetivo-derivado-no-seam
--
-- O QUE ENTRA (UP)
-- ----------------------------------------------------------------------------
--   Tabelas novas : company_tags, responsibility_coverages
--   Colunas novas : jobs.responsible_id, jobs.tag_id (FK company_tags, RESTRICT),
--                   team_connections.invited_by,
--                   company_members.{display_name, accepted_tos_at, confirmed_at, confirmed_by,
--                                    accepted_email, removed_at}
--   Indices       : re-convite (G7): uq_company_members_company_user vira PARCIAL
--                   (status <> 'removed') + idempotencia de convite por (empresa, nome, papel);
--                   suporte do seam (membership ativa, responsavel, cobertura).
--   Helpers       : session_company_member_confirmed, is_company_member, is_company_member_confirmed
--                   (leitura) e internal_company_active_operator (so para funcoes DEFINER).
--                   + internal_company_confirmed_operator (par "confirmado" de active_operator).
--   LGPD          : anonymize_account cita NOMINALMENTE as tabelas/colunas novas (company_members.
--                   display_name/accepted_email, responsibility_coverages, jobs.responsible_id,
--                   team_connections.invited_by) com ASSERCAO que falha se faltar, e
--                   lgpd_guard_auth_user_delete passa a tratar membro de company_members (qualquer papel) como perfil vivo.
--                   (ADR-20261123-encarregado-confirmado-e-pii, decisao 4 — corrige G8.)
--                   NOTA: o ADR diz status 'revoked'; o CHECK de company_members.status so aceita
--                   invited|active|removed, entao a marca e status='removed' + removed_at.
--
-- O QUE NAO ENTRA
--   * `company_members.role` NAO e alargado aqui. O CHECK continua `role = 'manager'`; o alargamento
--     e o ULTIMO passo de E4, depois do portao (condicao D5 do gate).
--   * Nenhuma policy existente e tocada. As policies NOVAS (company_tags, responsibility_coverages)
--     sao criadas ANTES do ENABLE RLS.
--
-- NO-OP COMPORTAMENTAL: colunas nullable sem default, tabelas vazias, indice parcial mais FROUXO que
-- o anterior (nao pode falhar em dado existente), helpers que nenhuma policy chama ainda.
--
-- Article 8: nada aqui toca wallets / escrow_transactions / wallet_transactions / shift_payments.
--
-- DOWN (rollback) — seguro enquanto nenhum E2/E3/E4 estiver aplicado (nada referencia):
--   -- ordem: E3 -> E2 primeiro (eles dependem destes objetos), depois:
--   DROP FUNCTION IF EXISTS public.is_company_member_confirmed(uuid);
--   DROP FUNCTION IF EXISTS public.is_company_member(uuid);
--   DROP FUNCTION IF EXISTS public.session_company_member_confirmed(uuid);
--   DROP FUNCTION IF EXISTS public.internal_company_confirmed_operator(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.internal_company_active_operator(uuid, uuid);
--   -- lgpd_guard_auth_user_delete: replace literal inverso (remover o ramo UNION ALL
--   --   'company_members(vivo)').
--   DROP TABLE IF EXISTS public.responsibility_coverages;
--   ALTER TABLE public.jobs DROP COLUMN IF EXISTS tag_id;          -- antes de dropar company_tags
--   DROP TABLE IF EXISTS public.company_tags;
--   ALTER TABLE public.jobs DROP COLUMN IF EXISTS responsible_id;  -- perde o que E2 gravou (= criador)
--   ALTER TABLE public.team_connections DROP COLUMN IF EXISTS invited_by;
--   ALTER TABLE public.company_members
--       DROP COLUMN IF EXISTS display_name, DROP COLUMN IF EXISTS accepted_tos_at,
--       DROP COLUMN IF EXISTS confirmed_at, DROP COLUMN IF EXISTS confirmed_by,
--       DROP COLUMN IF EXISTS accepted_email, DROP COLUMN IF EXISTS removed_at;
--   DROP INDEX IF EXISTS public.uq_company_members_invited_name_role;
--   DROP INDEX IF EXISTS public.idx_company_members_user_company_active;
--   DROP INDEX IF EXISTS public.idx_jobs_responsible;  DROP INDEX IF EXISTS public.idx_jobs_tag;
--   DROP INDEX IF EXISTS public.uq_company_members_company_user;
--   CREATE UNIQUE INDEX uq_company_members_company_user
--       ON public.company_members (company_id, user_id) WHERE user_id IS NOT NULL;
--   -- anonymize_account: reverter por replace literal inverso (ver bloco 7) ou recriar de
--   --   20260902000200_fix_anonymize_account_colunas_dropadas.sql.

-- ============================================================================
-- 0. ASSERCOES
-- ============================================================================
DO $mig$
DECLARE
    v_def text;
BEGIN
    IF to_regclass('public.company_members') IS NULL
       OR to_regclass('public.team_connections') IS NULL
       OR to_regclass('public.jobs') IS NULL
       OR to_regclass('public.companies') IS NULL THEN
        RAISE EXCEPTION 'ASSERCAO E1: tabela base ausente (company_members/team_connections/jobs/companies). HALT.';
    END IF;

    IF to_regprocedure('public.session_company_member_role(uuid)') IS NULL THEN
        RAISE EXCEPTION 'ASSERCAO E1: E0 (20261123000100) nao aplicada: session_company_member_role ausente. HALT.';
    END IF;

    -- jobs NAO pode ter as colunas ainda (verificado em producao 23/11/2026). Se ja tem, alguem
    -- aplicou parte desta migration por fora: reconferir em vez de seguir as cegas.
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='jobs'
                  AND column_name IN ('responsible_id','tag_id')) THEN
        RAISE NOTICE 'E1: jobs ja tem responsible_id/tag_id (reaplicacao idempotente).';
    END IF;

    -- start_date precisa ser timestamptz: o seam converte para data local de Sao Paulo.
    IF (SELECT data_type FROM information_schema.columns
         WHERE table_schema='public' AND table_name='jobs' AND column_name='start_date')
       IS DISTINCT FROM 'timestamp with time zone' THEN
        RAISE EXCEPTION 'ASSERCAO E1: jobs.start_date nao e timestamptz. HALT -> architect.';
    END IF;

    -- anonymize_account precisa ter o corpo de 20260902000200 (bloco 7 edita por replace).
    v_def := pg_get_functiondef('public.anonymize_account(uuid)'::regprocedure);
    IF position('public.company_members cm' IN v_def) = 0 THEN
        RAISE EXCEPTION 'ASSERCAO E1: anonymize_account nao tem o bloco company_members esperado. HALT.';
    END IF;
END
$mig$;

-- ============================================================================
-- 1. TABELAS (antes das funcoes: corpo LANGUAGE sql e parseado no CREATE)
-- ============================================================================

-- 1.1 company_tags — dimensao de filtro/relatorio. Nunca apagada (R20): sem policy de DELETE, sem
--     GRANT DELETE, FK RESTRICT em jobs.tag_id. "Sair de uso" = archived_at.
CREATE TABLE IF NOT EXISTS public.company_tags (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
    name        text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
    archived_at timestamptz,
    created_by  uuid        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Unicidade por (empresa, nome sem caixa): "Evento" e "evento" sao a mesma tag.
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_tags_company_name
    ON public.company_tags (company_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS idx_company_tags_company
    ON public.company_tags (company_id) WHERE archived_at IS NULL;

COMMENT ON TABLE public.company_tags IS
    'Tag de turno (ex.: Evento, Loja): dimensao de filtro/relatorio, NAO regra de visibilidade (v1). '
    'Nunca apagada — sem policy/GRANT de DELETE e FK RESTRICT em jobs.tag_id; arquivar = '
    'archived_at. Escrita so Gestor. LGPD (G8, classificacao): RETIDA — created_by e uuid '
    'pseudonimo apontando para lapide (mesma regua de worker_certifications.verified_by_company_id); '
    'name e rotulo operacional da empresa, nao dado de pessoa. Equipe e encarregados (E1).';

-- jobs.tag_id depende de company_tags.
ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS responsible_id uuid,
    ADD COLUMN IF NOT EXISTS tag_id uuid;

DO $mig$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_tag_id_fkey') THEN
        ALTER TABLE public.jobs
            ADD CONSTRAINT jobs_tag_id_fkey
            FOREIGN KEY (tag_id) REFERENCES public.company_tags(id) ON DELETE RESTRICT;
    END IF;
END
$mig$;

COMMENT ON COLUMN public.jobs.responsible_id IS
    'uuid de PESSOA (auth.users) responsavel pelo turno. SEM FK de proposito: o dono unico nao tem '
    'linha em company_members e uuid de pessoa nao leva FK para auth.users (H2 da LGPD). NULL = '
    'turno legado = Gestor. RESPONSAVEL EFETIVO e derivado no seam (responsible_id se for operador '
    'ativo da empresa; senao o Gestor) — nunca reescrito na remocao da pessoa. Escrita: trigger '
    'jobs_responsible_guard (E2) e reassign_job_responsible (E5). LGPD: pseudonimo retido.';
COMMENT ON COLUMN public.jobs.tag_id IS
    'Tag do turno (company_tags). Dimensao de filtro/relatorio; nao concede nem nega acesso.';

CREATE INDEX IF NOT EXISTS idx_jobs_responsible
    ON public.jobs (company_id, responsible_id) WHERE responsible_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_tag
    ON public.jobs (tag_id) WHERE tag_id IS NOT NULL;

-- 1.2 responsibility_coverages — "Cobrir X de A a B": janela por DATA, sem cron (R18).
--     LGPD: a guarda por vocabulario de 20260821000000 compara nome de coluna por IGUALDADE EXATA e
--     roda UMA vez (bloco DO da propria migration) — nao reavalia tabela criada depois. A premissa
--     G8 original ("nomear *_user_id cai no vocabulario") era falsa (ADR-20261123-encarregado-
--     confirmado-e-pii, decisao 4). A cobertura e NOMINAL no corpo de anonymize_account (bloco 7).
CREATE TABLE IF NOT EXISTS public.responsibility_coverages (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
    from_user_id  uuid        NOT NULL,
    to_user_id    uuid        NOT NULL,
    starts_on     date        NOT NULL,
    ends_on       date        NOT NULL,
    created_by    uuid        NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    revoked_at    timestamptz,
    CONSTRAINT responsibility_coverages_window CHECK (ends_on >= starts_on),
    -- janela maxima de 60 dias corridos, inclusive (Assumido na spec, R18).
    CONSTRAINT responsibility_coverages_max_60d CHECK ((ends_on - starts_on) + 1 <= 60),
    CONSTRAINT responsibility_coverages_distinct CHECK (from_user_id <> to_user_id)
);

CREATE INDEX IF NOT EXISTS idx_rc_to_active
    ON public.responsibility_coverages (to_user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rc_company
    ON public.responsibility_coverages (company_id);

COMMENT ON TABLE public.responsibility_coverages IS
    'Cobertura de responsabilidade: to_user_id opera os turnos de from_user_id entre starts_on e '
    'ends_on (datas locais America/Sao_Paulo, avaliadas no PREDICADO do seam — sem cron, sem '
    'reversao). O responsavel registrado do turno NAO muda. Inerte se from ou to deixar de ser '
    'operador ativo. Escrita so por RPC DEFINER (E5); sem policy de INSERT/UPDATE/DELETE e sem '
    'GRANT DELETE. LGPD: from_user_id/to_user_id/created_by sao uuid pseudonimo; anonymize_account '
    'cita esta tabela NOMINALMENTE, REVOGA (revoked_at) as coberturas do titular e RETEM a linha '
    '(historico de quem cobriu quem). Equipe e encarregados (E1).';

-- 1.3 Colunas novas em team_connections e company_members.
ALTER TABLE public.team_connections
    ADD COLUMN IF NOT EXISTS invited_by uuid;

COMMENT ON COLUMN public.team_connections.invited_by IS
    'RASTRO de quem da empresa trouxe o freela. DADO PESSOAL (pseudonimo de pessoa natural: liga uma '
    'pessoa a uma relacao de trabalho): anonymize_account a anula (NULL) para o titular. SO '
    'auditoria: NENHUM predicado de autorizacao (policy USING/WITH CHECK, funcao de seam, RPC) pode '
    'usar esta coluna (ADR-20261123-elenco-unico-da-company, decisao 2; spec R10c). Preenchida e '
    'travada por trigger (E3): BEFORE INSERT forca auth.uid(), BEFORE UPDATE a torna imutavel. O '
    'Elenco e da company; a saida da pessoa nao leva freela nenhum.';

ALTER TABLE public.company_members
    ADD COLUMN IF NOT EXISTS display_name    text,
    ADD COLUMN IF NOT EXISTS accepted_tos_at timestamptz,
    ADD COLUMN IF NOT EXISTS confirmed_at    timestamptz,
    ADD COLUMN IF NOT EXISTS confirmed_by    uuid,
    ADD COLUMN IF NOT EXISTS accepted_email  text,
    ADD COLUMN IF NOT EXISTS removed_at      timestamptz;

DO $mig$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.company_members'::regclass
                      AND conname = 'company_members_display_name_len') THEN
        ALTER TABLE public.company_members
            ADD CONSTRAINT company_members_display_name_len
            CHECK (display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 80);
    END IF;
END
$mig$;

COMMENT ON COLUMN public.company_members.display_name IS
    'Nome que o Gestor deu ao convidar. PII de pessoa natural (G8): permanece apos a remocao (rotulo '
    '"ex-{nome}", rastro de quem criou o turno) e e ANULADO por anonymize_account. Teto de 80 chars.';
COMMENT ON COLUMN public.company_members.accepted_email IS
    'E-mail verificado por OTP no aceite. PII (G8): anulado por anonymize_account.';
COMMENT ON COLUMN public.company_members.accepted_tos_at IS
    'Aceite individual dos Termos de Uso/Privacidade (Article 12 por pessoa, R13).';
COMMENT ON COLUMN public.company_members.confirmed_at IS
    'Confirmacao do Gestor ("Fulano entrou, e ele?", R22). NULL = ativo mas NAO confirmado: opera '
    'ZERO turnos e NAO le Elenco nem PII de freela (ADR-20261123-encarregado-confirmado-e-pii, '
    'decisao 1); so apos confirmed_at o encarregado passa pelo seam.';
COMMENT ON COLUMN public.company_members.removed_at IS
    'Quando o acesso foi cortado (status=removed). Remocao e SOFT, nunca DELETE (ADR-20261123-'
    'remover-pessoa-so-corta-acesso).';

-- ============================================================================
-- 2. INDICES de company_members (G7) e do seam
--    Sem CONCURRENTLY: migrations rodam em transacao e company_members esta VAZIA.
-- ============================================================================
-- G7: o UNIQUE (company_id, user_id) nao excluia 'removed' e impediria re-convidar quem foi
-- removido. Vira PARCIAL. E mais FROUXO que o anterior: nenhum dado existente pode violar.
DROP INDEX IF EXISTS public.uq_company_members_company_user;
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_members_company_user
    ON public.company_members (company_id, user_id)
    WHERE user_id IS NOT NULL AND status <> 'removed';

-- Idempotencia do convite SEM e-mail: um convite pendente por (empresa, nome, papel).
-- uq_company_members_pending_email continua valendo para convites COM e-mail (lower(NULL) = NULL,
-- logo nao conflita com os sem e-mail).
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_members_invited_name_role
    ON public.company_members (company_id, lower(btrim(display_name)), role)
    WHERE status = 'invited' AND display_name IS NOT NULL;

-- Custo do seam em policy quente (ADR responsavel-efetivo, "Negativas"): lookup por
-- (usuario, empresa) so entre ativos.
CREATE INDEX IF NOT EXISTS idx_company_members_user_company_active
    ON public.company_members (user_id, company_id) WHERE status = 'active';

-- ============================================================================
-- 3. HELPERS (depois das tabelas; antes das policies)
-- ============================================================================

-- 3.1 "Sou encarregado ATIVO E CONFIRMADO desta empresa?" — DEFINER, sobre auth.uid().
CREATE OR REPLACE FUNCTION public.session_company_member_confirmed(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT (SELECT auth.uid()) IS NOT NULL
       AND p_company_id IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id   = p_company_id
               AND cm.user_id      = (SELECT auth.uid())
               AND cm.status       = 'active'
               AND cm.confirmed_at IS NOT NULL
       );
$$;

COMMENT ON FUNCTION public.session_company_member_confirmed(uuid) IS
    'A sessao e membro ATIVO e CONFIRMADO pelo Gestor (confirmed_at NOT NULL) desta empresa? DEFINER '
    '(evita 42P17 na RLS de company_members); sempre sobre auth.uid(). Base de '
    'is_company_member_confirmed (leitura de Elenco, R7/R22).';

-- 3.2 is_company_member — "opero esta empresa em QUALQUER papel ativo?" (Gestor OU encarregado).
--     INVOKER + BEGIN ATOMIC: registra dependencia em pg_depend como o par is_company_owner /
--     is_job_owner (DROP de is_company_owner passa a falhar alto em vez de quebrar em runtime).
CREATE OR REPLACE FUNCTION public.is_company_member(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
BEGIN ATOMIC
    SELECT public.is_company_owner(p_company_id)
        OR public.session_company_member_role(p_company_id) IS NOT NULL;
END;

COMMENT ON FUNCTION public.is_company_member(uuid) IS
    'Opero esta empresa em algum papel ativo: Gestor (is_company_owner: dono, manager, operador de '
    'organizacao) OU encarregado ativo. NAO diz "posso operar um turno especifico" — isso e '
    'is_job_owner. Encarregado NAO confirmado passa aqui (esta ativo), mas NAO opera turno nenhum e NAO '
    'passa em is_company_member_confirmed.';

-- 3.3 is_company_member_confirmed — leitura do Elenco (R7, ADR elenco-unico decisao 4).
CREATE OR REPLACE FUNCTION public.is_company_member_confirmed(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
BEGIN ATOMIC
    SELECT public.is_company_owner(p_company_id)
        OR public.session_company_member_confirmed(p_company_id);
END;

COMMENT ON FUNCTION public.is_company_member_confirmed(uuid) IS
    'Gestor OU encarregado ativo CONFIRMADO. E o predicado de LEITURA do Elenco compartilhado '
    '(team_connections, team_lists, company_invite_links, list_team_connection_cards). O ramo 1 de '
    'can_view_worker_profile (PII do elenco) continua Gestor-only: confirmado le o Elenco, nao o CPF/PIX.';

-- 3.4 internal_company_active_operator — "a PESSOA p_user_id opera esta empresa agora?".
--     ATENCAO: aceita "por qual usuario perguntar" — por isso NAO e exposta a authenticated/anon
--     (REVOKE abaixo). Existe so para funcoes DEFINER do proprio schema (trigger de responsavel,
--     seam de cobertura, destinatarios de notificacao), que a chamam com o privilegio do dono.
CREATE OR REPLACE FUNCTION public.internal_company_active_operator(p_company_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p_company_id IS NOT NULL
       AND p_user_id IS NOT NULL
       AND (
            -- dono (ancoragem dupla, mesmo conjunto de is_company_owner) — a linha PRECISA existir
            EXISTS (SELECT 1 FROM public.companies c
                     WHERE c.id = p_company_id
                       AND (c.owner_id = p_user_id OR c.id = p_user_id))
            -- membro ativo em qualquer papel (manager | encarregado)
         OR EXISTS (SELECT 1 FROM public.company_members cm
                     WHERE cm.company_id = p_company_id
                       AND cm.user_id    = p_user_id
                       AND cm.status     = 'active')
            -- socio/operador da organizacao dona da unidade
         OR EXISTS (SELECT 1
                      FROM public.organization_members om
                      JOIN public.companies c2 ON c2.organization_id = om.organization_id
                     WHERE c2.id      = p_company_id
                       AND om.user_id = p_user_id
                       AND om.status  = 'active'
                       AND om.role IN ('owner', 'operator'))
       );
$$;

COMMENT ON FUNCTION public.internal_company_active_operator(uuid, uuid) IS
    'INTERNA. A pessoa p_user_id e operador ATIVO da empresa (dono, membro ativo, operador de '
    'organizacao)? Aceita uid de terceiro, por isso SEM EXECUTE para authenticated/anon: so funcoes '
    'DEFINER do schema a chamam. Base da validacao de jobs.responsible_id e do "responsavel '
    'efetivo" (removido/revogado deixa de ser operador -> cai no Gestor).';

-- 3.5 internal_company_confirmed_operator — par "confirmado" (ADR encarregado-confirmado, decisao 1).
--     = internal_company_active_operator AND (nao e encarregado OU confirmed_at NOT NULL).
--     Dono, manager e operador de organizacao entram como confirmados por definicao. Usada em:
--     validacao de jobs.responsible_id (trigger E2) e escolha de destinatarios de aviso (E2).
--     Mesmo bloqueio de acesso da irma: sem EXECUTE para authenticated/anon.
CREATE OR REPLACE FUNCTION public.internal_company_confirmed_operator(p_company_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.internal_company_active_operator(p_company_id, p_user_id)
       AND NOT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id   = p_company_id
               AND cm.user_id      = p_user_id
               AND cm.status       = 'active'
               AND cm.role         = 'encarregado'
               AND cm.confirmed_at IS NULL
       );
$$;

COMMENT ON FUNCTION public.internal_company_confirmed_operator(uuid, uuid) IS
    'INTERNA. A pessoa e operador ATIVO e, se encarregado, CONFIRMADO pelo Gestor? Aceita uid de '
    'terceiro, por isso SEM EXECUTE para authenticated/anon. internal_company_active_operator segue '
    'respondendo so "ativo". ADR-20261123-encarregado-confirmado-e-pii.';

REVOKE ALL ON FUNCTION public.internal_company_confirmed_operator(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_company_confirmed_operator(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.session_company_member_confirmed(uuid)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_company_member(uuid)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_company_member_confirmed(uuid)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.internal_company_active_operator(uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.session_company_member_confirmed(uuid)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_company_member(uuid)                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_company_member_confirmed(uuid)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.internal_company_active_operator(uuid, uuid) TO service_role;

-- ============================================================================
-- 4. GRANTS das tabelas novas (REVOKE ALL antes: default privileges do Supabase dao ALL a
--    anon/authenticated/service_role em tabela nova — sem isto sobraria DELETE)
-- ============================================================================
-- (nunca FROM PUBLIC em tabela — licao de 20260318000000: derruba service_role; os GRANTs abaixo
-- repoem exatamente o que cada papel pode.)
REVOKE ALL ON public.company_tags             FROM anon, authenticated, service_role;
REVOKE ALL ON public.responsibility_coverages FROM anon, authenticated, service_role;

-- company_tags: o Gestor cria e arquiva. Colunas de INSERT enumeradas (id/created_at por default;
-- archived_at NUNCA nasce preenchido). UPDATE so de archived_at (nome e imutavel).
GRANT SELECT ON public.company_tags TO authenticated;
GRANT INSERT (company_id, name, created_by) ON public.company_tags TO authenticated;
GRANT UPDATE (archived_at) ON public.company_tags TO authenticated;
-- SEM GRANT DELETE a ninguem (R20). service_role sem DELETE tambem: tag nunca se apaga.
GRANT SELECT, INSERT, UPDATE ON public.company_tags TO service_role;

-- responsibility_coverages: leitura para as partes/Gestor; toda escrita via RPC DEFINER (E5).
GRANT SELECT ON public.responsibility_coverages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.responsibility_coverages TO service_role;

-- ============================================================================
-- 5. POLICIES (ANTES do ENABLE RLS — landmine do projeto)
-- ============================================================================
DROP POLICY IF EXISTS "company_tags_select" ON public.company_tags;
CREATE POLICY "company_tags_select" ON public.company_tags
    FOR SELECT TO authenticated
    USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS "company_tags_insert_gestor" ON public.company_tags;
CREATE POLICY "company_tags_insert_gestor" ON public.company_tags
    FOR INSERT TO authenticated
    WITH CHECK (
        public.is_company_owner(company_id)
        AND created_by = (SELECT auth.uid())
        AND archived_at IS NULL
    );

DROP POLICY IF EXISTS "company_tags_update_gestor" ON public.company_tags;
CREATE POLICY "company_tags_update_gestor" ON public.company_tags
    FOR UPDATE TO authenticated
    USING (public.is_company_owner(company_id))
    WITH CHECK (public.is_company_owner(company_id));
-- SEM policy de DELETE (R20).

DROP POLICY IF EXISTS "rc_select_partes_ou_gestor" ON public.responsibility_coverages;
CREATE POLICY "rc_select_partes_ou_gestor" ON public.responsibility_coverages
    FOR SELECT TO authenticated
    USING (
        public.is_company_owner(company_id)
        -- B1: as PARTES so leem enquanto ainda operam a empresa (removido nao le o proprio historico
        -- de cobertura). from/to aqui sao so "sou a parte"; a autorizacao e is_company_member.
        OR (
            (from_user_id = (SELECT auth.uid()) OR to_user_id = (SELECT auth.uid()))
            AND public.is_company_member(company_id)
        )
    );
-- SEM policy de INSERT/UPDATE/DELETE: create/end_responsibility_coverage sao RPCs DEFINER (E5).

-- ============================================================================
-- 6. RLS (depois das policies; SEM FORCE — ver 20260318000000)
-- ============================================================================
ALTER TABLE public.company_tags             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_tags             NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.responsibility_coverages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responsibility_coverages NO FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- 7. LGPD — anonymize_account cita NOMINALMENTE as tabelas/colunas novas (ADR-20261123-
--    encarregado-confirmado-e-pii, decisao 4; corrige G8). Edicao sobre o corpo do CATALOGO (D4).
--    Quatro edicoes, cada uma com assercao de contagem do trecho antigo:
--      (a) UPDATE de company_members: display_name := NULL, accepted_email := NULL, removed_at
--          carimbado quando a linha vira 'removed' (o CHECK de status nao tem 'revoked': a marca
--          e status='removed');
--      (b) o filtro do mesmo UPDATE alcanca linha ja removida que ainda guarda esses campos;
--      (c) coberturas em que o titular e from/to (ou da empresa que sai): revoked_at := now(),
--          SEM DELETE (auditoria);
--      (d) jobs.responsible_id = titular -> NULL (o seam cai no Gestor) e
--          team_connections.invited_by = titular -> NULL.
--    Em seguida uma ASSERCAO que falha se o corpo nao citar cada item.
--    Regex sem barra invertida e sem retrovisao (ver cabecalho de E0).
-- ============================================================================
DO $mig$
DECLARE
    v_def   text;
    v_novo  text;
    v_hit   text;
    v_n     integer;
    v_pat_a text :=
        'UPDATE public[.]company_members cm[[:space:]]+SET status = CASE WHEN cm[.]status IN [(]''invited'', ''active''[)]'
        '[[:space:]]+THEN ''removed'' ELSE cm[.]status END,';
    v_pat_b text :=
        'OR cm[.]invite_token[[:space:]]+IS NOT NULL[)]';
    v_pat_c text :=
        'v_counts := v_counts [|][|] jsonb_build_object[(]''company_members'', v_n[)];[[:space:]]+END IF;';
BEGIN
    v_def := pg_get_functiondef('public.anonymize_account(uuid)'::regprocedure);

    IF position('cm.display_name' IN v_def) > 0 THEN
        RAISE NOTICE 'E1: anonymize_account ja estendida; so a asserção final roda.';
        v_novo := v_def;
    ELSE
        -- (a)
        SELECT count(*) INTO v_n FROM regexp_matches(v_def, v_pat_a, 'g');
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'ASSERCAO E1(a): % ocorrencia(s) do UPDATE de company_members em anonymize_account (esperado 1). Funcao mudou -- HALT.', v_n;
        END IF;
        v_hit  := (regexp_match(v_def, v_pat_a))[1];
        v_novo := replace(v_def, v_hit,
            v_hit || chr(10) ||
            '                   display_name   = NULL,' || chr(10) ||
            '                   accepted_email = NULL,' || chr(10) ||
            '                   removed_at     = CASE WHEN cm.status IN (''invited'', ''active'')' || chr(10) ||
            '                                         THEN now() ELSE cm.removed_at END,');

        -- (b)
        SELECT count(*) INTO v_n FROM regexp_matches(v_novo, v_pat_b, 'g');
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'ASSERCAO E1(b): % ocorrencia(s) do filtro de company_members (esperado 1). Funcao mudou -- HALT.', v_n;
        END IF;
        v_hit  := (regexp_match(v_novo, v_pat_b))[1];
        v_novo := replace(v_novo, v_hit,
            'OR cm.invite_token IS NOT NULL' || chr(10) ||
            '                    OR cm.display_name  IS NOT NULL' || chr(10) ||
            '                    OR cm.accepted_email IS NOT NULL)');

        -- (c) + (d)
        SELECT count(*) INTO v_n FROM regexp_matches(v_novo, v_pat_c, 'g');
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'ASSERCAO E1(c): % ancora(s) do bloco company_members (esperado 1). Funcao mudou -- HALT.', v_n;
        END IF;
        v_hit  := (regexp_match(v_novo, v_pat_c))[1];
        v_novo := replace(v_novo, v_hit,
            v_hit || chr(10) || chr(10) ||
            '    -- ---- EQUIPE E ENCARREGADOS (E1): tabelas/colunas novas, NOMINAIS ----' || chr(10) ||
            '    -- Coberturas: revoga (nunca DELETE; quem cobriu quem e historico), mas cobertura de' || chr(10) ||
            '    -- conta anonimizada nao pode seguir concedendo acesso.' || chr(10) ||
            '    UPDATE public.responsibility_coverages rc' || chr(10) ||
            '       SET revoked_at = now()' || chr(10) ||
            '     WHERE rc.revoked_at IS NULL' || chr(10) ||
            '       AND (rc.from_user_id = p_user_id OR rc.to_user_id = p_user_id' || chr(10) ||
            '            OR rc.company_id = ANY (v_company_ids));' || chr(10) ||
            '    GET DIAGNOSTICS v_n = ROW_COUNT;' || chr(10) ||
            '    v_counts := v_counts || jsonb_build_object(''responsibility_coverages'', v_n);' || chr(10) ||
            '    -- jobs.responsible_id = titular -> NULL: o seam trata NULL como Gestor (ADR responsavel-efetivo).' || chr(10) ||
            '    UPDATE public.jobs j SET responsible_id = NULL WHERE j.responsible_id = p_user_id;' || chr(10) ||
            '    GET DIAGNOSTICS v_n = ROW_COUNT;' || chr(10) ||
            '    v_counts := v_counts || jsonb_build_object(''jobs_responsible_nulled'', v_n);' || chr(10) ||
            '    -- team_connections.invited_by = titular -> NULL (rastro e dado pessoal; a linha e da company).' || chr(10) ||
            '    UPDATE public.team_connections tcb SET invited_by = NULL WHERE tcb.invited_by = p_user_id;' || chr(10) ||
            '    GET DIAGNOSTICS v_n = ROW_COUNT;' || chr(10) ||
            '    v_counts := v_counts || jsonb_build_object(''team_connections_invited_by_nulled'', v_n);');
    END IF;

    -- ASSERCAO DE GATE (decisao 4): o corpo PRECISA citar cada item novo. Falha = HALT.
    IF position('display_name' IN v_novo) = 0
       OR position('accepted_email' IN v_novo) = 0
       OR position('public.responsibility_coverages' IN v_novo) = 0
       OR position('responsible_id = NULL' IN v_novo) = 0
       OR position('invited_by = NULL' IN v_novo) = 0 THEN
        RAISE EXCEPTION
          'ASSERCAO E1 (LGPD): anonymize_account nao cita nominalmente company_members.display_name/'
          'accepted_email, responsibility_coverages, jobs.responsible_id e team_connections.invited_by. HALT.';
    END IF;

    IF v_novo IS DISTINCT FROM v_def THEN
        EXECUTE v_novo;
    END IF;
END
$mig$;

-- 7b. lgpd_guard_auth_user_delete: membro ATIVO (qualquer papel) ou com PII residual e "perfil vivo".
--     A guarda so olhava workers/companies: encarregado nao tem nenhum dos dois (a casca de
--     companies e apagada no aceite), entao a credencial dele poderia ser apagada sem passar por
--     anonymize_account, deixando display_name/accepted_email. Edicao do corpo do catalogo.
DO $mig$
DECLARE
    v_def   text;
    v_pat   text := 'WHERE c[.]owner_id = OLD[.]id AND c[.]anonymized_at IS NULL';
    v_hit   text;
    v_n     integer;
BEGIN
    v_def := pg_get_functiondef('public.lgpd_guard_auth_user_delete()'::regprocedure);
    IF position('company_members(vivo)' IN v_def) > 0 THEN
        RAISE NOTICE 'E1: lgpd_guard ja cobre company_members; nada a fazer.';
        RETURN;
    END IF;
    SELECT count(*) INTO v_n FROM regexp_matches(v_def, v_pat, 'g');
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'ASSERCAO E1(guard): % ocorrencia(s) do ramo companies(owner_id) (esperado 1). HALT.', v_n;
    END IF;
    v_hit := (regexp_match(v_def, v_pat))[1];
    EXECUTE replace(v_def, v_hit,
        v_hit || chr(10) ||
        '        UNION ALL' || chr(10) ||
        '        SELECT ''company_members(vivo)'' FROM public.company_members cm' || chr(10) ||
        '          WHERE cm.user_id = OLD.id' || chr(10) ||
        '            AND (cm.status = ''active'' OR cm.display_name IS NOT NULL OR cm.accepted_email IS NOT NULL)');
END
$mig$;

-- ============================================================================
-- VERIFICACAO pos-aplicacao (read-only)
-- ----------------------------------------------------------------------------
--   -- CHECK de role INTACTO (so manager) — alargar e o ULTIMO passo de E4:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='public.company_members'::regclass AND conname='company_members_role_check';
--   -- tabelas novas sem GRANT DELETE:
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema='public' AND table_name IN ('company_tags','responsibility_coverages')
--      AND privilege_type='DELETE';                              -- 0 linhas
--   -- policies de DELETE inexistentes:
--   SELECT tablename, policyname FROM pg_policies
--    WHERE tablename IN ('company_tags','responsibility_coverages') AND cmd='DELETE';   -- 0 linhas
--   -- internal_company_active_operator inacessivel ao client:
--   SELECT has_function_privilege('authenticated','public.internal_company_active_operator(uuid,uuid)','EXECUTE'); -- false
-- ============================================================================
