-- Migration: Certificações externas (freela) e treinamentos internos (empresa) — F8
-- File: supabase/migrations/20260817001300_worker_certifications_trainings.sql
-- Spec: .harness/spec/certificacoes/spec.md
-- DDL aprovado (FONTE NORMATIVA, prevalece sobre a spec): .harness/spec/certificacoes/ddl-aprovado.md
-- ADR: .harness/memory-bank/decisions/ADR-20260821-certificacoes-metadado-sem-arquivo.md
--
-- ============================================================================
-- O QUE ESTA MIGRATION FAZ
-- ============================================================================
--   (1) Tabela `worker_trainings`   — treinamento INTERNO: a empresa declara "eu treinei este freela".
--   (2) Tabela `worker_certifications` — certificação EXTERNA: documento do freela (CREF, manipulação
--       de alimentos), auto-declarado, opcionalmente CONFERIDO visualmente por uma empresa nomeada.
--   (3) Dois triggers de partição por ator (quem pode mudar o quê).
--   (4) `jobs.certification_requirement` — texto livre ADVISORY (avisa, nunca bloqueia).
--   (5) `notify_certification_expiries()` + agendamento pg_cron (aviso de 30 dias e de vencimento).
--
--   NÃO cria bucket de storage. NÃO cria coluna de arquivo. NÃO cria coluna de status de validade.
--   NÃO toca `wallets`, `wallet_transactions`, `escrow_transactions`, `shift_payments` nem RPC de
--   saldo — Article 8 INTACTO (confirmação explícita, R14).
--
-- ============================================================================
-- ORDEM DOS BLOCOS (regra de patterns.md — já custou uma migration inaplicável)
-- ============================================================================
--   TABELAS -> ÍNDICES -> FUNÇÕES/TRIGGERS -> RLS -> GRANTS -> COLUNA EM `jobs` -> CRON.
--   `is_company_owner` (LANGUAGE sql, 20260817000300) e `can_view_worker_profile` (plpgsql,
--   20260816120000) JÁ EXISTEM — esta migration só as consome, não as redefine.
--
-- ============================================================================
-- SEM ARQUIVO NA v1 (decisão D1 do gate)
-- ============================================================================
--   Não existe `document_path`, não existe bucket `certification-docs`. A conferência é VISUAL e
--   acontece fora do Worki (o original é visto por WhatsApp/presencialmente, como já acontece hoje).
--   Guardar PDF com CPF/foto/assinatura não torna a conferência mais verdadeira e estrearia custódia
--   de documento sensível sobre um `delete-account` já quebrado (débito pré-piloto #5). Reabrir é uma
--   migration aditiva; desfazer custódia (inclusive backups) não é. Ver ADR, seção "Reabertura".
--
-- ============================================================================
-- VALIDADE É DERIVADA, NUNCA CONGELADA (decisão D2)
-- ============================================================================
--   Predicado canônico de vencida (usar SEMPRE este, no SQL e no client):
--       expires_at IS NOT NULL AND expires_at < (now() AT TIME ZONE 'America/Sao_Paulo')::date
--   `notified_30d_at` / `notified_expired_at` NÃO são status: são livro-caixa do agendador. Só o
--   agendador escreve nelas (não constam do GRANT UPDATE de coluna). Mudar `expires_at` (renovação)
--   ZERA as duas — sem isso, renovar significaria nunca mais ser avisado.
--
-- ============================================================================
-- LGPD — DADO DE SAÚDE É PROIBIDO NESTAS TABELAS
-- ============================================================================
--   Atestado médico, ASO, exame toxicológico, carteira de vacinação e laudo de deficiência são dado
--   SENSÍVEL (art. 5º, II) e estão FORA. Defesas: sem upload (D1), campos de texto com teto de
--   tamanho, COMMENT nas tabelas e copy explícita na UI. Ver debitos-pre-piloto.md §1.
--
-- Risk: LOW-MEDIUM. Duas tabelas novas (sem dado preexistente), uma coluna nullable em `jobs`
--   (ADD COLUMN sem default = sem reescrita de heap), um job de cron.
-- Backup required before production deploy: NO.
--
-- ============================================================================
-- DOWN (rollback — copiar/colar)
-- ============================================================================
--   SELECT cron.unschedule('certification-expiry-notices');
--   DROP FUNCTION IF EXISTS public.notify_certification_expiries();
--   ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_certification_requirement_len;
--   ALTER TABLE public.jobs DROP COLUMN IF EXISTS certification_requirement;
--   DROP TRIGGER IF EXISTS trg_enforce_certification_update_scope ON public.worker_certifications;
--   DROP TRIGGER IF EXISTS trg_enforce_training_rules ON public.worker_trainings;
--   DROP FUNCTION IF EXISTS public.enforce_certification_update_scope();
--   DROP FUNCTION IF EXISTS public.enforce_training_rules();
--   DROP TABLE IF EXISTS public.worker_certifications;
--   DROP TABLE IF EXISTS public.worker_trainings;
--
-- ============================================================================
-- COMO VERIFICAR (obrigatório após aplicar — ver §4 do ddl-aprovado.md)
-- ============================================================================

-- =============================================
-- 1. TABELA — TREINAMENTO INTERNO (empresa é dona)
--    Registro operacional da empresa SOBRE o freela. Mais perto de `reviews` do que de documento
--    pessoal: quem escreve é a empresa, quem é descrito é o freela, e ninguém mais lê.
--    CASCADE nos dois FKs (DS6): auditoria de treinamento não vale um bloqueio ao direito de
--    exclusão — `shift_payments` com RESTRICT já é o débito #5.
-- =============================================
CREATE TABLE IF NOT EXISTS public.worker_trainings (
    id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    -- dono do registro. FK OBRIGATÓRIA: é ela que impede um freela de se auto-atribuir treinamento
    -- passando o próprio uuid como company_id (o uuid de freela vive em `workers`, não aqui) — DS3.
    company_id     uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    worker_id      uuid        NOT NULL REFERENCES public.workers(id)   ON DELETE CASCADE,
    title          text        NOT NULL,
    -- data de conclusão declarada. Sem CHECK de "não-futuro": CHECK exige IMMUTABLE e
    -- `current_date` é STABLE -> a guarda vive no trigger (BEFORE INSERT).
    completed_at   date        NOT NULL,
    note           text,
    created_by     uuid        NOT NULL DEFAULT auth.uid(),
    created_at     timestamptz NOT NULL DEFAULT now(),
    -- revogação (empresa registrou errado). One-way; nunca reescreve conteúdo, nunca DELETE.
    revoked_at     timestamptz,
    revoked_reason text,
    CONSTRAINT worker_trainings_self_attribution_guard CHECK (worker_id <> company_id),
    CONSTRAINT worker_trainings_title_len  CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
    CONSTRAINT worker_trainings_note_len   CHECK (note IS NULL OR char_length(note) <= 500),
    CONSTRAINT worker_trainings_revoke_len CHECK (revoked_reason IS NULL OR char_length(revoked_reason) <= 300),
    CONSTRAINT worker_trainings_revoke_pair CHECK (revoked_reason IS NULL OR revoked_at IS NOT NULL)
);

COMMENT ON TABLE public.worker_trainings IS
    'F8 — treinamento INTERNO: a empresa declara que treinou este freela (ex.: "treinamento Divino '
    'Fogao", "boas praticas RDC 216"). Nao tem emissor externo nem validade. Visivel APENAS para a '
    'empresa que registrou e para o proprio freela (LGPD art. 18, II) — nunca para outra empresa, '
    'mesmo da mesma rede (A15; visao de rede exige ADR). Registro de auditoria: revoga-se, nao se '
    'apaga (sem policy de DELETE). PROIBIDO gravar dado de saude (atestado, ASO, exame, vacina) — '
    'dado sensivel LGPD art. 5o, II, fora do escopo deste produto. Nao toca saldo (Article 8).';

COMMENT ON COLUMN public.worker_trainings.company_id IS
    'Empresa que registrou. FK para companies e NAO decorativa: e a trava que impede um freela de '
    'inserir com company_id = auth.uid() e se auto-atribuir treinamento (DS3 do ddl-aprovado).';

-- =============================================
-- 2. TABELA — CERTIFICAÇÃO EXTERNA (freela é dono)
--    Documento pessoal e portavel do freela. Auto-declarado; a empresa pode CONFERIR visualmente,
--    sempre de forma ATRIBUIDA (nunca "verificado pelo Worki").
--    SEM `document_path` e SEM coluna de status de validade — D1 e D2.
-- =============================================
CREATE TABLE IF NOT EXISTS public.worker_certifications (
    id                     uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    worker_id              uuid        NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
    title                  text        NOT NULL,
    issuer                 text,
    -- numero de registro (ex.: CREF 012345-G/SP). E o que substitui o arquivo na v1: e publico e
    -- conferivel no site do conselho pelo proprio operador.
    registration_number    text,
    issued_at              date,
    expires_at             date,
    -- conferencia VISUAL por uma empresa nomeada. O par nulo/nao-nulo e travado por CHECK:
    -- conferencia ANONIMA e um estado inexpressavel, logo a UI nao consegue exibir selo generico.
    verified_by_company_id uuid        REFERENCES public.companies(id) ON DELETE SET NULL,
    verified_at            timestamptz,
    verified_note          text,
    -- livro-caixa do agendador (NAO e status de validade — ver D2).
    notified_30d_at        timestamptz,
    notified_expired_at    timestamptz,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT worker_certifications_title_len   CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
    CONSTRAINT worker_certifications_issuer_len  CHECK (issuer IS NULL OR char_length(issuer) <= 120),
    CONSTRAINT worker_certifications_regnum_len  CHECK (registration_number IS NULL OR char_length(registration_number) <= 60),
    CONSTRAINT worker_certifications_vnote_len   CHECK (verified_note IS NULL OR char_length(verified_note) <= 300),
    CONSTRAINT worker_certifications_date_order  CHECK (
        expires_at IS NULL OR issued_at IS NULL OR expires_at >= issued_at
    ),
    -- Nenhuma conferencia sem dono E data. A FK acima e SET NULL; o trigger limpa verified_at/
    -- verified_note ANTES deste CHECK rodar (BEFORE trigger precede constraint), entao apagar uma
    -- empresa nao quebra a linha — ela volta a "nao conferida", que e a verdade.
    CONSTRAINT worker_certifications_verified_pair CHECK (
        (verified_by_company_id IS NULL) = (verified_at IS NULL)
    ),
    CONSTRAINT worker_certifications_vnote_needs_verify CHECK (
        verified_note IS NULL OR verified_at IS NOT NULL
    )
);

COMMENT ON TABLE public.worker_certifications IS
    'F8 — certificacao EXTERNA do freela (CREF, manipulacao de alimentos, curso tecnico). '
    'AUTO-DECLARADA: quem cadastra e o proprio freela. Uma empresa com vinculo pode CONFERIR '
    'visualmente, e a conferencia e sempre ATRIBUIDA (verified_by_company_id + verified_at, par '
    'travado por CHECK) — o Worki NUNCA valida diploma nem consulta conselho de classe, e a UI e '
    'proibida de exibir selo generico de "verificado". Vencimento e DERIVADO em query '
    '(expires_at < data local), nunca coluna de status. Certificacao vencida NUNCA e ocultada (R8). '
    'v1 SEM ARQUIVO: nao ha document_path nem bucket — ver ADR-20260821. PROIBIDO gravar dado de '
    'saude (atestado, ASO, exame, vacina) — dado sensivel LGPD art. 5o, II. Article 8 intacto.';

COMMENT ON COLUMN public.worker_certifications.notified_30d_at IS
    'Livro-caixa do agendador: "ja avisei o marco de 30 dias". NAO e status de validade. Escrita '
    'exclusiva de notify_certification_expiries() (fora do GRANT UPDATE de coluna). Zerada pelo '
    'trigger quando expires_at muda (renovacao volta a avisar).';

-- =============================================
-- 3. ÍNDICES
--    Sem CONCURRENTLY: migration do Supabase roda em transação (CONCURRENTLY é proibido em bloco
--    transacional) e as duas tabelas nascem vazias.
-- =============================================
CREATE INDEX IF NOT EXISTS idx_worker_trainings_worker
    ON public.worker_trainings (worker_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_worker_trainings_company_worker
    ON public.worker_trainings (company_id, worker_id);

CREATE INDEX IF NOT EXISTS idx_worker_certifications_worker
    ON public.worker_certifications (worker_id, created_at DESC);

-- Índice do cron: só linhas com validade e com algum marco ainda não avisado.
CREATE INDEX IF NOT EXISTS idx_worker_certifications_expiry_pending
    ON public.worker_certifications (expires_at)
    WHERE expires_at IS NOT NULL
      AND (notified_30d_at IS NULL OR notified_expired_at IS NULL);

-- =============================================
-- 4. TRIGGER — REGRAS DE `worker_trainings`
--    INSERT: sanidade de data (CHECK não pode usar current_date). UPDATE: só revogação, one-way.
-- =============================================
CREATE OR REPLACE FUNCTION public.enforce_training_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.completed_at > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
            RAISE EXCEPTION 'worker_trainings: completed_at nao pode estar no futuro.';
        END IF;
        IF NEW.revoked_at IS NOT NULL OR NEW.revoked_reason IS NOT NULL THEN
            RAISE EXCEPTION 'worker_trainings: nao se registra um treinamento ja revogado.';
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE: linha já revogada é final.
    IF OLD.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'worker_trainings: treinamento revogado e final (revogacao e one-way).';
    END IF;

    -- Conteúdo é imutável: erro de registro se revoga, não se reescreve.
    IF NEW.id           IS DISTINCT FROM OLD.id
    OR NEW.company_id   IS DISTINCT FROM OLD.company_id
    OR NEW.worker_id    IS DISTINCT FROM OLD.worker_id
    OR NEW.title        IS DISTINCT FROM OLD.title
    OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
    OR NEW.note         IS DISTINCT FROM OLD.note
    OR NEW.created_by   IS DISTINCT FROM OLD.created_by
    OR NEW.created_at   IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'worker_trainings: registro imutavel — so revoked_at/revoked_reason mudam.';
    END IF;

    -- Só a empresa dona revoga. Sessão nula (service_role/delete-account) passa: não há caminho de
    -- `anon` até aqui (sem GRANT, sem policy).
    IF auth.uid() IS NOT NULL AND NOT public.is_company_owner(OLD.company_id) THEN
        RAISE EXCEPTION 'worker_trainings: so a empresa que registrou pode revogar.';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_training_rules() IS
    'F8 — BEFORE INSERT/UPDATE em worker_trainings. INSERT: completed_at nao pode ser futuro (CHECK '
    'nao aceita current_date, que e STABLE). UPDATE: conteudo imutavel, so revoked_at/revoked_reason '
    'mudam, revogacao e one-way, e so a empresa dona (is_company_owner) revoga. Nao toca saldo.';

REVOKE ALL ON FUNCTION public.enforce_training_rules() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_training_rules() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_training_rules ON public.worker_trainings;
CREATE TRIGGER trg_enforce_training_rules
    BEFORE INSERT OR UPDATE ON public.worker_trainings
    FOR EACH ROW EXECUTE FUNCTION public.enforce_training_rules();

-- =============================================
-- 5. TRIGGER — PARTIÇÃO POR ATOR EM `worker_certifications`
--    Mesmo padrão de `enforce_shift_payment_immutability` (20260712000000): a policy decide QUEM
--    alcança a linha; o trigger decide O QUE cada ator pode mudar.
--
--    (a) DONO (freela)  -> só conteúdo. Mexeu no conteúdo, a conferência anterior CAI (DS2).
--    (b) EMPRESA com vínculo -> só a conferência, e só em nome próprio.
--    (c) SEM SESSÃO (auth.uid() IS NULL) -> cron, delete-account e a ação SET NULL da FK. Nunca
--        pode CRIAR conferência; só limpar. Sem este ramo, a R9 e a R13 não funcionam (DS4).
--    (d) Qualquer outro -> exceção.
--
--    auth.uid() FUNCIONA dentro de SECURITY DEFINER (o DEFINER troca o ROLE, não as claims do JWT
--    em request.jwt.claims) — precedentes: validate_application_update,
--    enforce_shift_payment_immutability, notify_counterpart_on_application_cancel.
-- =============================================
CREATE OR REPLACE FUNCTION public.enforce_certification_update_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid              uuid := auth.uid();
    v_content_changed  boolean;
    v_verified_changed boolean;
    v_notify_changed   boolean;
BEGIN
    -- Âncoras: ninguém, em nenhum ramo.
    IF NEW.id         IS DISTINCT FROM OLD.id
    OR NEW.worker_id  IS DISTINCT FROM OLD.worker_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'worker_certifications: id/worker_id/created_at sao imutaveis.';
    END IF;

    v_content_changed :=
           NEW.title               IS DISTINCT FROM OLD.title
        OR NEW.issuer              IS DISTINCT FROM OLD.issuer
        OR NEW.registration_number IS DISTINCT FROM OLD.registration_number
        OR NEW.issued_at           IS DISTINCT FROM OLD.issued_at
        OR NEW.expires_at          IS DISTINCT FROM OLD.expires_at;

    v_verified_changed :=
           NEW.verified_by_company_id IS DISTINCT FROM OLD.verified_by_company_id
        OR NEW.verified_at            IS DISTINCT FROM OLD.verified_at
        OR NEW.verified_note          IS DISTINCT FROM OLD.verified_note;

    v_notify_changed :=
           NEW.notified_30d_at     IS DISTINCT FROM OLD.notified_30d_at
        OR NEW.notified_expired_at IS DISTINCT FROM OLD.notified_expired_at;

    IF v_uid IS NOT NULL AND v_uid = OLD.worker_id THEN
        -- (a) DONO
        IF v_verified_changed THEN
            RAISE EXCEPTION 'worker_certifications: o freela nao escreve verified_* (autoverificacao).';
        END IF;
        IF v_notify_changed THEN
            RAISE EXCEPTION 'worker_certifications: notified_* e controlado pelo agendador.';
        END IF;
        IF v_content_changed THEN
            -- DS2: o que a empresa conferiu deixou de existir. A conferencia cai junto.
            NEW.verified_by_company_id := NULL;
            NEW.verified_at            := NULL;
            NEW.verified_note          := NULL;
        END IF;
        IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
            -- renovacao volta a avisar
            NEW.notified_30d_at     := NULL;
            NEW.notified_expired_at := NULL;
        END IF;

    ELSIF v_uid IS NOT NULL AND public.can_view_worker_profile(OLD.worker_id) THEN
        -- (b) EMPRESA COM VÍNCULO
        IF v_content_changed THEN
            RAISE EXCEPTION 'worker_certifications: a empresa nao edita o conteudo da certificacao.';
        END IF;
        IF v_notify_changed THEN
            RAISE EXCEPTION 'worker_certifications: notified_* e controlado pelo agendador.';
        END IF;
        -- EMENDA 2026-08-21 (DS8) — CONFERENCIA ALHEIA E INTOCAVEL.
        -- Sem esta guarda, QUALQUER empresa que passe em can_view_worker_profile podia apagar
        -- (NEW.verified_by_company_id := NULL) ou SOBRESCREVER a conferencia feita por outra. A UI
        -- so escondia o botao quando verified_by_company_id <> companyId — filtro de client e UX,
        -- nao defesa (Article 4). Cobre os dois casos de uma vez: quem nao conferiu nao mexe.
        IF OLD.verified_by_company_id IS NOT NULL
           AND v_verified_changed
           AND NOT public.is_company_owner(OLD.verified_by_company_id) THEN
            RAISE EXCEPTION 'worker_certifications: so a empresa que conferiu pode desfazer ou alterar a propria conferencia.';
        END IF;
        IF NEW.verified_by_company_id IS NOT NULL
           AND NOT public.is_company_owner(NEW.verified_by_company_id) THEN
            RAISE EXCEPTION 'worker_certifications: so e possivel conferir em nome da propria empresa.';
        END IF;
        IF NEW.verified_by_company_id IS NOT NULL AND NEW.verified_at IS NULL THEN
            NEW.verified_at := now();
        END IF;
        IF NEW.verified_by_company_id IS NULL THEN
            NEW.verified_at   := NULL;
            NEW.verified_note := NULL;
        END IF;

    ELSIF v_uid IS NULL THEN
        -- (c) SEM SESSÃO: cron / delete-account / FK SET NULL. Nunca cria conferencia.
        IF v_content_changed THEN
            RAISE EXCEPTION 'worker_certifications: conteudo so muda com sessao do proprio freela.';
        END IF;
        IF NEW.verified_by_company_id IS NOT NULL AND v_verified_changed THEN
            RAISE EXCEPTION 'worker_certifications: conferencia exige empresa autenticada.';
        END IF;
        IF NEW.verified_by_company_id IS NULL THEN
            NEW.verified_at   := NULL;
            NEW.verified_note := NULL;
        END IF;

    ELSE
        RAISE EXCEPTION 'worker_certifications: ator sem vinculo nao pode alterar esta certificacao.';
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_certification_update_scope() IS
    'F8 — BEFORE UPDATE em worker_certifications: particiona por ator. Freela muda so conteudo (e '
    'ao muda-lo DERRUBA a conferencia anterior — o que a empresa atestou deixou de existir); '
    'empresa com vinculo muda so verified_* e so em nome proprio, e NAO alcanca conferencia de '
    'OUTRA empresa (DS8: so quem conferiu desfaz/altera); sessao nula (cron, '
    'delete-account, FK SET NULL) so limpa/marca notificacao, nunca cria conferencia. Mudar '
    'expires_at zera notified_* (renovacao volta a avisar). auth.uid() e confiavel dentro de '
    'SECURITY DEFINER (o DEFINER troca o ROLE, nao as claims do JWT). Nao toca saldo (Article 8).';

REVOKE ALL ON FUNCTION public.enforce_certification_update_scope() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_certification_update_scope() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_certification_update_scope ON public.worker_certifications;
CREATE TRIGGER trg_enforce_certification_update_scope
    BEFORE UPDATE ON public.worker_certifications
    FOR EACH ROW EXECUTE FUNCTION public.enforce_certification_update_scope();

-- =============================================
-- 6. RLS
--    NÃO usar FORCE ROW LEVEL SECURITY e NÃO usar `REVOKE ALL ... FROM PUBLIC` em tabela
--    (20260318000000: derrubou o service_role).
-- =============================================
ALTER TABLE public.worker_trainings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_certifications  ENABLE ROW LEVEL SECURITY;

-- --- worker_trainings ---
-- SELECT: a empresa dona (is_company_owner — ancora no REGISTRO, nao no freela: usar
-- can_view_worker_profile aqui deixaria a empresa B ler o treinamento da empresa A e violaria A15)
-- OU o proprio freela (dado pessoal sobre ele — LGPD art. 18, II).
DROP POLICY IF EXISTS wt_select ON public.worker_trainings;
CREATE POLICY wt_select ON public.worker_trainings
    FOR SELECT TO authenticated
    USING (worker_id = (SELECT auth.uid()) OR public.is_company_owner(company_id));

-- INSERT: empresa com vinculo real. As quatro condicoes sao necessarias (DS3):
--   is_company_owner        -> opera esta empresa (ancoragem dupla, seam do multi-unidade)
--   can_view_worker_profile -> tem vinculo real com o freela (elenco ou operacional)
--   created_by = auth.uid() -> trilha de quem registrou
--   worker_id <> company_id -> (com a FK para companies) mata a auto-atribuicao pelo freela
DROP POLICY IF EXISTS wt_insert_company ON public.worker_trainings;
CREATE POLICY wt_insert_company ON public.worker_trainings
    FOR INSERT TO authenticated
    WITH CHECK (
        public.is_company_owner(company_id)
        AND public.can_view_worker_profile(worker_id)
        AND created_by = (SELECT auth.uid())
        AND worker_id <> company_id
    );

-- UPDATE: so a empresa dona (revogacao). O trigger + o GRANT de coluna limitam O QUE muda.
DROP POLICY IF EXISTS wt_update_company ON public.worker_trainings;
CREATE POLICY wt_update_company ON public.worker_trainings
    FOR UPDATE TO authenticated
    USING (public.is_company_owner(company_id))
    WITH CHECK (public.is_company_owner(company_id));

-- SEM policy de DELETE: registro de auditoria. Revoga-se, nao se apaga.

-- --- worker_certifications ---
DROP POLICY IF EXISTS wc_select ON public.worker_certifications;
CREATE POLICY wc_select ON public.worker_certifications
    FOR SELECT TO authenticated
    USING (public.can_view_worker_profile(worker_id));

DROP POLICY IF EXISTS wc_insert_owner ON public.worker_certifications;
CREATE POLICY wc_insert_owner ON public.worker_certifications
    FOR INSERT TO authenticated
    WITH CHECK (
        worker_id = (SELECT auth.uid())
        AND verified_by_company_id IS NULL
        AND verified_at IS NULL
        AND verified_note IS NULL
        AND notified_30d_at IS NULL
        AND notified_expired_at IS NULL
    );

-- UPDATE: mesmo alcance da leitura; a PARTICAO por ator vive no trigger (5) e no GRANT (7).
DROP POLICY IF EXISTS wc_update_scoped ON public.worker_certifications;
CREATE POLICY wc_update_scoped ON public.worker_certifications
    FOR UPDATE TO authenticated
    USING (public.can_view_worker_profile(worker_id))
    WITH CHECK (public.can_view_worker_profile(worker_id));

-- DELETE: so o dono. Documento pessoal do freela (LGPD art. 18, VI).
DROP POLICY IF EXISTS wc_delete_owner ON public.worker_certifications;
CREATE POLICY wc_delete_owner ON public.worker_certifications
    FOR DELETE TO authenticated
    USING (worker_id = (SELECT auth.uid()));

-- =============================================
-- 7. GRANTS
--    GRANT de coluna e ADITIVO: so restringe depois do REVOKE do privilegio de tabela (licao da F2,
--    20260817000300). A ordem abaixo (REVOKE UPDATE -> GRANT UPDATE (colunas)) e obrigatoria.
--    NAO fazer `REVOKE ALL ... FROM PUBLIC` (20260318000000 derrubou o service_role assim).
-- =============================================
REVOKE ALL ON public.worker_trainings      FROM anon;
REVOKE ALL ON public.worker_certifications FROM anon;

GRANT SELECT, INSERT ON public.worker_trainings TO authenticated;
REVOKE UPDATE ON public.worker_trainings FROM authenticated;
GRANT UPDATE (revoked_at, revoked_reason) ON public.worker_trainings TO authenticated;
-- sem GRANT DELETE: nao ha policy de DELETE (defesa em profundidade).

GRANT SELECT, INSERT, DELETE ON public.worker_certifications TO authenticated;
REVOKE UPDATE ON public.worker_certifications FROM authenticated;
-- notified_30d_at / notified_expired_at FORA de proposito: sao do agendador (D2).
GRANT UPDATE (
    title, issuer, registration_number, issued_at, expires_at,
    verified_by_company_id, verified_at, verified_note
) ON public.worker_certifications TO authenticated;

GRANT ALL ON public.worker_trainings      TO service_role;
GRANT ALL ON public.worker_certifications TO service_role;

-- =============================================
-- 8. `jobs.certification_requirement` — AVISO, NUNCA TRAVA
--    Texto livre. ADD COLUMN nullable sem default: sem reescrita de heap.
--    NENHUM GRANT novo: `jobs` ja tem grant de tabela para authenticated e GRANT de coluna aditivo
--    seria decoracao que engana a proxima revisao (licao da F7).
-- =============================================
ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS certification_requirement text;

ALTER TABLE public.jobs
    DROP CONSTRAINT IF EXISTS jobs_certification_requirement_len;

ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_certification_requirement_len CHECK (
        certification_requirement IS NULL OR char_length(certification_requirement) <= 200
    );

COMMENT ON COLUMN public.jobs.certification_requirement IS
    'F8 — requisito de certificacao do turno, TEXTO LIVRE e ADVISORY (ex.: "CREF valido"). '
    'E AVISO, NUNCA TRAVA: aparece como UMA linha no topo do ShiftCallModal e nao filtra freela, '
    'nao gera badge por pessoa, nao desabilita selecao nem disparo (mesmo principio da guarda de '
    'vinculo). Nao ha validacao estruturada por tipo de certificacao (fora de escopo). Nao toca '
    'saldo (Article 8).';

-- =============================================
-- 9. AVISO DE VENCIMENTO (R9) — SO PARA O FREELA, IDEMPOTENTE POR MARCO
--    Idempotencia: a propria coluna de marco e a chave. O UPDATE ... RETURNING dentro de CTE
--    garante que quem marcou e quem notifica — sem janela de corrida entre SELECT e UPDATE
--    (mesmo motivo do padrao RETURNING ... INTO das RPCs de escrow).
--    `type = 'system'`: a CHECK de notifications so aceita status_change|message|payment|system.
-- =============================================
CREATE OR REPLACE FUNCTION public.notify_certification_expiries()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
    v_sent  integer := 0;
    v_batch integer := 0;
BEGIN
    -- (1) faltam 30 dias ou menos e ainda nao venceu
    WITH due AS (
        UPDATE public.worker_certifications c
           SET notified_30d_at = now()
         WHERE c.expires_at IS NOT NULL
           AND c.notified_30d_at IS NULL
           AND c.expires_at >  v_today
           AND c.expires_at <= v_today + 30
        RETURNING c.worker_id, c.title, c.expires_at
    )
    INSERT INTO public.notifications (user_id, type, title, message, link, read_at, created_at)
    SELECT d.worker_id,
           'system',
           'Certificacao vence em breve',
           'Sua certificacao "' || d.title || '" vence em ' ||
               to_char(d.expires_at, 'DD/MM/YYYY') || '. Renove e atualize no seu perfil.',
           '/profile',
           NULL,
           now()
      FROM due d;
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_sent := v_sent + v_batch;

    -- (2) venceu. O UPDATE marca TODAS as vencidas (inclusive antigas), mas so notifica as que
    --     venceram nos ultimos 30 dias: assim um freela que cadastra hoje um certificado vencido em
    --     2019 nao recebe um push sobre isso — e a linha fica marcada, entao nunca dispara depois.
    WITH due AS (
        UPDATE public.worker_certifications c
           SET notified_expired_at = now()
         WHERE c.expires_at IS NOT NULL
           AND c.notified_expired_at IS NULL
           AND c.expires_at <= v_today
        RETURNING c.worker_id, c.title, c.expires_at
    )
    INSERT INTO public.notifications (user_id, type, title, message, link, read_at, created_at)
    SELECT d.worker_id,
           'system',
           'Certificacao vencida',
           'Sua certificacao "' || d.title || '" venceu em ' ||
               to_char(d.expires_at, 'DD/MM/YYYY') || '. Atualize no seu perfil.',
           '/profile',
           NULL,
           now()
      FROM due d
     WHERE d.expires_at >= v_today - 30;
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_sent := v_sent + v_batch;

    RETURN v_sent;
END;
$$;

COMMENT ON FUNCTION public.notify_certification_expiries() IS
    'F8 — varredura diaria: avisa o FREELA (nunca a empresa) 30 dias antes do vencimento e no '
    'vencimento. Idempotente pelas colunas de marco (notified_30d_at / notified_expired_at), '
    'marcadas no MESMO statement que produz a notificacao (UPDATE ... RETURNING em CTE = sem janela '
    'de corrida). Vencimento e sempre recalculado da data local America/Sao_Paulo — nao existe '
    'status congelado. Nao toca saldo (Article 8).';

REVOKE ALL ON FUNCTION public.notify_certification_expiries() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_certification_expiries() TO service_role;

-- =============================================
-- 10. AGENDAMENTO (pg_cron) — mesmo padrao de 20260817000800
--     `pg_cron` esta DISPONIVEL mas pode nao estar INSTALADO: o bloco e guardado por IF EXISTS para
--     nao quebrar `supabase db reset`/CI, e avisa RUIDOSAMENTE no caminho de skip.
--     ATENCAO: aplicar esta migration via CLI (`supabase db push`/psql), NAO via MCP — o MCP engole
--     RAISE WARNING. A verificacao V6 (§4) e obrigatoria de qualquer forma.
--     Horario: 22:10 UTC = 19:10 BRT (Brasil sem DST desde 2019). Deslocado do job das 21:00 UTC
--     (confirmacao de vespera) para nao competir por conexao.
-- =============================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- cron.schedule(jobname, ...) faz upsert por nome (pg_cron >= 1.4) -> reaplicar e seguro.
        PERFORM cron.schedule(
            'certification-expiry-notices',
            '10 22 * * *',
            $cron$SELECT public.notify_certification_expiries();$cron$
        );
    ELSE
        RAISE WARNING 'pg_cron ausente: o aviso de vencimento de certificacao NAO sera disparado '
                      'automaticamente. Habilite a extensao e reaplique esta migration.';
    END IF;
END $$;
