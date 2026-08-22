-- Migration: SOS — descoberta de freelas em urgência (F11)
-- File: supabase/migrations/20260817001600_sos_discovery.sql
-- Spec: .harness/spec/sos-descoberta/spec.md
-- DDL aprovado: .harness/spec/sos-descoberta/ddl-aprovado.md
-- ADR: .harness/memory-bank/decisions/ADR-20260821-sos-abertura-controlada-do-grafo.md
--
-- NOTA DE TIMESTAMP: o ddl-aprovado.md nomeia este arquivo `20260817001400_sos_discovery.sql`,
-- mas `20260817001400` e `20260817001500` já foram ocupados nesta branch por F12
-- (`worker_company_badges`) e F10 (`worker_referrals`). Esta é a ÚNICA divergência autorizada em
-- relação ao contrato — todo o restante (SQL, ordem, comentários) é cópia byte a byte.
--
-- ============================================================================
-- O QUE ESTA MIGRATION FAZ
-- ============================================================================
--   (a) `workers` ganha o opt-in `discoverable_for_sos` (boolean, default false).
--   (b) `shift_calls` e `shift_call_targets` ganham `origin ('team'|'sos')`; um BEFORE INSERT
--       copia o origin do chamado para o alvo (o cliente não escolhe).
--   (c) Um normalizador de cidade IMMUTABLE (trim + lower + acentos), sem extensão.
--   (d) TRÊS policies do F1 são REESCRITAS (ver "A PROMESSA" abaixo).
--   (e) `create_sos_call` (SECURITY DEFINER): calcula o pool, cria o chamado, insere alvos e
--       notificações, devolve SÓ contagem. `sos_call_eligibility` (leitura) alimenta o botão.
--   (f) Três índices parciais.
--
--   NÃO cria tabela. NÃO altera `claim_shift_slot` (só os DOIS textos de notificação — §6).
--   NÃO toca saldo/escrow. NÃO cria cron. NÃO faz backfill.
--
-- ============================================================================
-- A PROMESSA, E POR QUE ELA NÃO SE SUSTENTAVA SEM ESTAS TRÊS POLICIES
-- ============================================================================
--   A feature promete: "a empresa recebe quem ACEITOU, nunca quem foi CHAMADO". Sem isso, o SOS
--   entrega à Empresa A uma lista de freelas com quem ela não tem vínculo nenhum — o oposto do
--   que `20260816120000` (workers_select_by_relationship) fechou.
--
--   (1) `shift_call_targets_select` vigente entrega ao dono do turno TODOS os alvos:
--           USING (worker_id = auth.uid() OR is_job_owner(shift_call_job_id(call_id)))
--       Um `GET /rest/v1/shift_call_targets?call_id=eq.<meu_sos>` devolveria o pool inteiro.
--       A RPC devolver só a contagem não adianta NADA: a tabela é legível por PostgREST.
--       ⇒ para origin='sos', o dono só enxerga alvo com response = 'accepted'.
--
--   (2) `shift_calls_insert_company` vigente deixa a empresa inserir o chamado direto do client.
--       Com a coluna nova sem trava, ela escolheria o origin. ⇒ client só escreve 'team'.
--
--   (3) `shift_call_targets_insert` vigente deixa o dono anexar alvos a QUALQUER chamado de um
--       turno seu — inclusive a um SOS legítimo, contornando pool, corte de qualidade e cota
--       (e criando alvos que ela própria não conseguiria ler, por (1)). ⇒ só 'team'.
--
--   ORDEM QUE SUSTENTA (2) E (3): para INSERT, o Postgres roda os BEFORE ROW triggers e SÓ
--   DEPOIS avalia o WITH CHECK da RLS (ExecBRInsertTriggers → ExecConstraints). Por isso o
--   `origin = 'team'` no WITH CHECK avalia o valor JÁ SINCRONIZADO pelo trigger, não o que o
--   cliente mandou. Isto é load-bearing: se algum dia o trigger virar AFTER, as duas policies
--   deixam de valer silenciosamente.
--
-- ============================================================================
-- POR QUE O ORIGIN É DENORMALIZADO NO ALVO (e não uma função DEFINER a mais)
-- ============================================================================
--   A policy de SELECT precisa do origin, e ler `shift_calls` de dentro da policy de
--   `shift_call_targets` é o ciclo A→B→A que dá 42P17 EM RUNTIME (não no CREATE) — foi por isso
--   que o F1 criou `shift_call_job_id`. Criar um `shift_call_origin` seria o terceiro objeto
--   privilegiado. A coluna resolve sem nenhum objeto novo E torna a cota por freela indexável
--   (contar "quantos SOS este freela recebeu em 7 dias" sem join). O trigger elimina o drift.
--
--   Consequência que o gate exigiu por escrito: NENHUMA função nova aceita "por qual usuário
--   perguntar". `is_shift_call_target` continua sendo sobre auth.uid() e continua INTACTA.
--
-- ============================================================================
-- POR QUE `CREATE INDEX` E NÃO `CONCURRENTLY`
-- ============================================================================
--   Migrations do Supabase rodam dentro de transação e CONCURRENTLY é proibido em bloco
--   transacional. Mesma decisão, mesma justificativa, de 20260816120000. Volume do piloto é
--   pequeno; se crescer, o índice se recria fora de migration.
--
-- Article 8 INTACTO. Risk: MEDIUM-HIGH (altera policies de tabela em produção).
--
-- ============================================================================
-- DOWN (rollback)
-- ============================================================================
--   -- 1. Kill switch (basta isto para parar a feature; não precisa reverter o resto):
--   REVOKE EXECUTE ON FUNCTION public.create_sos_call(uuid, text, text) FROM authenticated;
--   -- 2. Reversão completa:
--   DROP FUNCTION IF EXISTS public.create_sos_call(uuid, text, text);
--   DROP FUNCTION IF EXISTS public.sos_call_eligibility(uuid);
--   DROP TRIGGER  IF EXISTS trg_sync_shift_call_target_origin ON public.shift_call_targets;
--   DROP FUNCTION IF EXISTS public.sync_shift_call_target_origin();
--   DROP FUNCTION IF EXISTS public.normalize_city(text);
--   DROP INDEX    IF EXISTS public.idx_shift_calls_sos_company;
--   DROP INDEX    IF EXISTS public.idx_shift_call_targets_sos_worker;
--   DROP INDEX    IF EXISTS public.idx_workers_discoverable_sos;
--   ALTER TABLE public.shift_call_targets DROP COLUMN IF EXISTS origin;
--   ALTER TABLE public.shift_calls        DROP COLUMN IF EXISTS origin;
--   ALTER TABLE public.workers            DROP COLUMN IF EXISTS discoverable_for_sos;
--   -- e restaurar as 3 policies originais de 20260817000100 (copiar de lá, verbatim).
-- ============================================================================


-- =============================================
-- 1. COLUNAS
-- =============================================

-- Opt-in do freela. NOT NULL DEFAULT false: em Postgres 11+ não reescreve a tabela.
-- Sem CHECK (boolean já é o domínio). Sem GRANT por coluna (aditivo, não restringe — lição F5/F7).
-- Quem escreve: o próprio freela, via PATCH em workers, sob a policy `id = auth.uid()`.
ALTER TABLE public.workers
    ADD COLUMN IF NOT EXISTS discoverable_for_sos boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.workers.discoverable_for_sos IS
    'Opt-in EXPLÍCITO para ser alcançado por SOS (F11) de empresas fora do Elenco. false = '
    'invisível para o pool de descoberta. Desligar tem efeito imediato: o pool é calculado no '
    'momento do disparo, sem cache. Ver ADR-20260821-sos-abertura-controlada-do-grafo.';

ALTER TABLE public.shift_calls
    ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'team';
ALTER TABLE public.shift_calls
    DROP CONSTRAINT IF EXISTS shift_calls_origin_check;
ALTER TABLE public.shift_calls
    ADD CONSTRAINT shift_calls_origin_check CHECK (origin IN ('team', 'sos'));

COMMENT ON COLUMN public.shift_calls.origin IS
    'team = chamado ao Elenco (F1). sos = alcance ampliado fora do Elenco (F11). O cliente só '
    'consegue escrever ''team'' (policy shift_calls_insert_company); ''sos'' nasce exclusivamente '
    'dentro de create_sos_call.';

ALTER TABLE public.shift_call_targets
    ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'team';
ALTER TABLE public.shift_call_targets
    DROP CONSTRAINT IF EXISTS shift_call_targets_origin_check;
ALTER TABLE public.shift_call_targets
    ADD CONSTRAINT shift_call_targets_origin_check CHECK (origin IN ('team', 'sos'));

COMMENT ON COLUMN public.shift_call_targets.origin IS
    'Cópia do origin do chamado, gravada pelo trigger trg_sync_shift_call_target_origin. '
    'DENORMALIZADO de propósito: (a) a policy de SELECT precisa dele SEM ler shift_calls (o ciclo '
    'de policy A→B→A dá 42P17 em runtime); (b) a cota "2 SOS por freela em 7 dias" fica '
    'indexável sem join. Nunca é escrito pelo cliente.';


-- =============================================
-- 2. TRIGGER DE SINCRONIA DO ORIGIN
--    BEFORE INSERT: roda ANTES do WITH CHECK da RLS (ver cabeçalho). É o que faz as policies
--    de INSERT valerem sobre o valor real, e não sobre o que o cliente mandou no corpo.
--    Não há trigger de UPDATE porque não há policy de UPDATE nesta tabela (F1, de propósito).
-- =============================================
CREATE OR REPLACE FUNCTION public.sync_shift_call_target_origin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    SELECT sc.origin INTO NEW.origin
      FROM public.shift_calls sc
     WHERE sc.id = NEW.call_id;

    -- SELECT INTO sem linha deixa a variável NULL. A FK pegaria isso depois, mas a coluna é
    -- NOT NULL e a mensagem daqui é mais honesta do que uma violação de NOT NULL.
    IF NEW.origin IS NULL THEN
        RAISE EXCEPTION 'shift_call_targets.call_id % nao corresponde a nenhum chamado', NEW.call_id;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_shift_call_target_origin() IS
    'Copia shift_calls.origin para o alvo no INSERT, ignorando o que o cliente enviou. É a '
    'garantia de que shift_call_targets.origin é fiel — as policies de SELECT e INSERT dependem '
    'disso. SECURITY DEFINER: lê shift_calls sem depender da RLS de quem insere.';

DROP TRIGGER IF EXISTS trg_sync_shift_call_target_origin ON public.shift_call_targets;
CREATE TRIGGER trg_sync_shift_call_target_origin
    BEFORE INSERT ON public.shift_call_targets
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_shift_call_target_origin();

-- Função de TRIGGER precisa de EXECUTE para o papel que dispara o INSERT. Lição de
-- 20260816201420 / 20260816201457: revogar EXECUTE de trigger function quebra o caminho do
-- `authenticated` em runtime, sem erro no CREATE.
REVOKE ALL ON FUNCTION public.sync_shift_call_target_origin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_shift_call_target_origin() TO authenticated, service_role;


-- =============================================
-- 3. NORMALIZADOR DE CIDADE
--    `workers.city` é TEXTO LIVRE digitado pelo freela em Profile.tsx (nenhuma validação,
--    nenhuma lista, nenhum autocomplete). `companies.city` é TEXT nullable (20260317140000).
--    lower() sozinho não junta "São Paulo" / "Sao Paulo" / " sao  paulo ".
--
--    translate() em vez da extensão `unaccent`: expressão pura, sem dependência de extensão
--    habilitada no projeto, e IMMUTABLE de verdade (unaccent é STABLE por depender do dicionário).
--
--    LIMITE ASSUMIDO: "São Paulo/SP" e "São Paulo" continuam diferentes. Não tratamos UF colada
--    nesta fatia — é ruído de dado, não de código, e o efeito é alcance MENOR (falha segura).
-- =============================================
CREATE OR REPLACE FUNCTION public.normalize_city(p_city text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
    SELECT nullif(
        btrim(
            regexp_replace(
                translate(
                    lower(p_city),
                    'áàâãäéèêëíìîïóòôõöúùûüçñ',
                    'aaaaaeeeeiiiiooooouuuucn'
                ),
                '\s+', ' ', 'g'
            )
        ),
        ''
    );
$$;

COMMENT ON FUNCTION public.normalize_city(text) IS
    'Normaliza cidade para comparação: trim + espaços colapsados + lower + acentos removidos. '
    'Devolve NULL para NULL e para string vazia/só espaços — "não declarou" e "declarou vazio" '
    'colapsam no mesmo NULL, e NULL nunca casa com NULL numa igualdade (falha segura).';

REVOKE ALL ON FUNCTION public.normalize_city(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_city(text) TO authenticated, service_role;


-- =============================================
-- 4. POLICIES REESCRITAS (as três do cabeçalho)
--    Policies permissivas são OR'd: enquanto a antiga existir, a nova não restringe nada.
--    Por isso cada uma é DROPADA pelo NOME EXATO de 20260817000100 antes de recriada.
-- =============================================

DROP POLICY IF EXISTS "shift_calls_insert_company" ON public.shift_calls;
CREATE POLICY "shift_calls_insert_company" ON public.shift_calls
    FOR INSERT TO authenticated
    WITH CHECK (
        public.is_job_owner(job_id)
        AND created_by = (SELECT auth.uid())
        AND status = 'open'
        -- NOVO (F11): o cliente só abre chamado ao Elenco. 'sos' é exclusivo de create_sos_call.
        AND origin = 'team'
        AND company_id = (SELECT j.company_id FROM public.jobs j WHERE j.id = job_id)
    );

DROP POLICY IF EXISTS "shift_call_targets_select" ON public.shift_call_targets;
CREATE POLICY "shift_call_targets_select" ON public.shift_call_targets
    FOR SELECT TO authenticated
    USING (
        -- O freela sempre vê a PRÓPRIA linha (inclusive de SOS) — é como ele responde.
        worker_id = (SELECT auth.uid())
        OR (
            public.is_job_owner(public.shift_call_job_id(call_id))
            AND (
                -- Chamado ao Elenco: a empresa já conhece essa gente. Comportamento do F1 intacto.
                origin = 'team'
                -- SOS: a empresa recebe quem ACEITOU, nunca quem foi CHAMADO.
                -- Esta linha é a feature inteira. Não afrouxar sem novo ADR.
                OR response = 'accepted'
            )
        )
    );

DROP POLICY IF EXISTS "shift_call_targets_insert" ON public.shift_call_targets;
CREATE POLICY "shift_call_targets_insert" ON public.shift_call_targets
    FOR INSERT TO authenticated
    WITH CHECK (
        response IS NULL
        AND responded_at IS NULL
        -- NOVO (F11): alvo de SOS só nasce dentro de create_sos_call. Avaliado DEPOIS do
        -- BEFORE trigger, logo sobre o origin real do chamado.
        AND origin = 'team'
        AND public.is_job_owner(public.shift_call_job_id(call_id))
        AND EXISTS (
            SELECT 1
            FROM public.team_connections tc
            WHERE tc.worker_id  = shift_call_targets.worker_id
              AND tc.status     = 'accepted'
              AND tc.company_id = (
                    SELECT j.company_id
                    FROM public.jobs j
                    WHERE j.id = public.shift_call_job_id(shift_call_targets.call_id)
                )
        )
    );


-- =============================================
-- 5. ÍNDICES (parciais — o conjunto SOS é pequeno por desenho)
-- =============================================

-- Cota por empresa (R10): "quantos SOS abri nos últimos 7 dias / quantos estão abertos".
CREATE INDEX IF NOT EXISTS idx_shift_calls_sos_company
    ON public.shift_calls (company_id, created_at DESC)
    WHERE origin = 'sos';

-- Cota por freela (R11): "quantos SOS este freela recebeu em 7 dias". Sem o origin
-- denormalizado, isto seria um join no caminho mais quente do produto.
CREATE INDEX IF NOT EXISTS idx_shift_call_targets_sos_worker
    ON public.shift_call_targets (worker_id, notified_at DESC)
    WHERE origin = 'sos';

-- Pool: o predicado parcial poda para o conjunto opt-in (pequeno). A comparação de cidade é
-- por FUNÇÃO e portanto NÃO é sargável com este índice — assumido de propósito. Índice de
-- EXPRESSÃO sobre normalize_city foi rejeitado: CREATE OR REPLACE da função não reindexa
-- (mesmo foot-gun que 20260817001200 documentou para CHECK com função de usuário).
CREATE INDEX IF NOT EXISTS idx_workers_discoverable_sos
    ON public.workers (city)
    WHERE discoverable_for_sos;


-- =============================================
-- 6. sos_call_eligibility — leitura que alimenta o botão (R8/R9)
--    Existe para o cliente NÃO reimplementar a regra. O cliente usa isto para MOSTRAR o botão;
--    create_sos_call reverifica tudo de novo, porque botão é UX e regra é regra.
-- =============================================
CREATE OR REPLACE FUNCTION public.sos_call_eligibility(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid        uuid := (SELECT auth.uid());
    v_now        timestamptz := now();
    v_job        record;
    v_filled     integer;
    v_team_any   boolean;
    v_team_live  boolean;
    v_open_sos   integer;
    v_week_sos   integer;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'unauthenticated');
    END IF;

    IF NOT public.is_job_owner(p_job_id) THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'forbidden');
    END IF;

    SELECT j.id, j.status, j.start_date, j.slots, j.company_id
      INTO v_job
      FROM public.jobs j
     WHERE j.id = p_job_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'not_found');
    END IF;

    IF v_job.status = 'deleted' THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'job_deleted');
    END IF;

    IF v_job.start_date <= v_now THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'job_started');
    END IF;

    -- R8.2 — janela de urgência FIXA. Não é configurável por empresa de propósito: cada empresa
    -- definindo o que é "urgente" transforma o SOS no canal padrão (gatilho G1 do ADR).
    IF v_job.start_date > v_now + interval '4 hours' THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'not_urgent');
    END IF;

    -- R8.3 — ainda falta gente. Fonte da verdade é applications, como no F1.
    SELECT count(*) INTO v_filled
      FROM public.applications a
     WHERE a.job_id = p_job_id
       AND a.status IN ('hired', 'in_progress', 'completed');

    IF v_filled >= v_job.slots THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'already_filled');
    END IF;

    -- R8.1 — o Elenco já foi tentado E não há mais nada vivo por lá.
    SELECT EXISTS (
        SELECT 1 FROM public.shift_calls sc
         WHERE sc.job_id = p_job_id AND sc.origin = 'team'
    ) INTO v_team_any;

    IF NOT v_team_any THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'team_not_tried');
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.shift_calls sc
         WHERE sc.job_id     = p_job_id
           AND sc.origin     = 'team'
           AND sc.status     = 'open'
           AND sc.expires_at > v_now
           AND EXISTS (
                SELECT 1 FROM public.shift_call_targets t
                 WHERE t.call_id = sc.id AND t.response IS NULL
           )
    ) INTO v_team_live;

    IF v_team_live THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'team_call_still_open');
    END IF;

    -- Cotas (R10). Ancoragem DUPLA: contar por igualdade simples de company_id daria duas cotas
    -- ao mesmo humano (jobs.company_id ora é o uuid da empresa, ora o uid do dono).
    SELECT count(*) FILTER (WHERE sc.status = 'open' AND sc.expires_at > v_now),
           count(*) FILTER (WHERE sc.created_at > v_now - interval '7 days')
      INTO v_open_sos, v_week_sos
      FROM public.shift_calls sc
     WHERE sc.origin = 'sos'
       AND (
             sc.company_id = v_uid
          OR sc.company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_id = v_uid)
       );

    IF v_open_sos >= 1 THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'quota_open');
    END IF;

    IF v_week_sos >= 3 THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'quota_week');
    END IF;

    RETURN jsonb_build_object(
        'eligible', true,
        'reason', 'ok',
        'quota_week_left', 3 - v_week_sos,
        'missing_slots', v_job.slots - v_filled
    );
END;
$$;

COMMENT ON FUNCTION public.sos_call_eligibility(uuid) IS
    'O botão "Chamar fora do Elenco" deve aparecer? Só para o dono do turno. NÃO devolve nada '
    'sobre o pool (nem tamanho) — saber "há N pessoas elegíveis" antes de disparar seria uma '
    'prévia do alcance, que o ADR-20260821 proíbe.';

REVOKE ALL ON FUNCTION public.sos_call_eligibility(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sos_call_eligibility(uuid) TO authenticated, service_role;


-- =============================================
-- 7. create_sos_call — o coração
--
--    A ÚNICA porta pela qual um alvo fora do Elenco nasce. Recebe job + motivo + recado;
--    devolve {outcome, call_id, targets_count, expires_at}. NUNCA devolve a lista.
--
--    SECURITY DEFINER DESLIGA A RLS (as tabelas são NO FORCE): toda autorização aqui é
--    explícita, na unha — is_job_owner no início, e nada depois assume policy.
--
--    LOCK: advisory lock por DONO (não por turno). O recurso escasso da cota é a EMPRESA, e
--    dois SOS simultâneos em turnos diferentes passariam pela cota "1 aberto" se o lock fosse
--    de jobs. Ordem de lock: advisory ANTES da linha de jobs — claim_shift_slot só toma a linha
--    de jobs, então não há ciclo possível.
-- =============================================
CREATE OR REPLACE FUNCTION public.create_sos_call(
    p_job_id  uuid,
    p_reason  text DEFAULT 'falta',
    p_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid          uuid := (SELECT auth.uid());
    v_now          timestamptz := now();
    v_job          record;
    v_filled       integer;
    v_team_any     boolean;
    v_team_live    boolean;
    v_open_sos     integer;
    v_week_sos     integer;
    v_city         text;
    v_city_raw     text;
    v_company_name text;
    v_pool         uuid[];
    v_count        integer;
    v_call_id      uuid;
    v_expires      timestamptz;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    IF p_reason IS NULL OR p_reason NOT IN
       ('falta','demissao','pico_previsto','evento','ferias','folga','reforco','outro') THEN
        RETURN jsonb_build_object('outcome', 'invalid_reason');
    END IF;

    IF NOT public.is_job_owner(p_job_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- Serializa por DONO antes de qualquer contagem de cota.
    PERFORM pg_advisory_xact_lock(hashtext('worki:sos:' || v_uid::text)::bigint);

    SELECT j.id, j.status, j.start_date, j.slots, j.company_id
      INTO v_job
      FROM public.jobs j
     WHERE j.id = p_job_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF v_job.status = 'deleted' THEN
        RETURN jsonb_build_object('outcome', 'job_deleted');
    END IF;
    IF v_job.start_date <= v_now THEN
        RETURN jsonb_build_object('outcome', 'job_started');
    END IF;
    IF v_job.start_date > v_now + interval '4 hours' THEN
        RETURN jsonb_build_object('outcome', 'not_urgent');
    END IF;

    SELECT count(*) INTO v_filled
      FROM public.applications a
     WHERE a.job_id = p_job_id
       AND a.status IN ('hired', 'in_progress', 'completed');
    IF v_filled >= v_job.slots THEN
        RETURN jsonb_build_object('outcome', 'already_filled');
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.shift_calls sc
         WHERE sc.job_id = p_job_id AND sc.origin = 'team'
    ) INTO v_team_any;
    IF NOT v_team_any THEN
        RETURN jsonb_build_object('outcome', 'team_not_tried');
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.shift_calls sc
         WHERE sc.job_id     = p_job_id
           AND sc.origin     = 'team'
           AND sc.status     = 'open'
           AND sc.expires_at > v_now
           AND EXISTS (
                SELECT 1 FROM public.shift_call_targets t
                 WHERE t.call_id = sc.id AND t.response IS NULL
           )
    ) INTO v_team_live;
    IF v_team_live THEN
        RETURN jsonb_build_object('outcome', 'team_call_still_open');
    END IF;

    -- ---------------------------------------------------------------------
    -- VARREDURA DE EXPIRADOS ANTES DA COTA.
    -- O F1 expira PREGUIÇOSAMENTE (só claim_shift_slot fecha o vencido). Um SOS que ninguém
    -- abriu fica 'open' para sempre e trancaria a empresa fora do SOS PERMANENTEMENTE.
    -- ---------------------------------------------------------------------
    UPDATE public.shift_calls sc
       SET status = 'expired', closed_at = v_now
     WHERE sc.origin     = 'sos'
       AND sc.status     = 'open'
       AND sc.expires_at <= v_now
       AND (
             sc.company_id = v_uid
          OR sc.company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_id = v_uid)
       );

    UPDATE public.shift_call_targets t
       SET response = 'closed', responded_at = v_now
      FROM public.shift_calls sc
     WHERE t.call_id    = sc.id
       AND sc.origin    = 'sos'
       AND sc.status    = 'expired'
       AND sc.closed_at = v_now
       AND t.response IS NULL;

    SELECT count(*) FILTER (WHERE sc.status = 'open'),
           count(*) FILTER (WHERE sc.created_at > v_now - interval '7 days')
      INTO v_open_sos, v_week_sos
      FROM public.shift_calls sc
     WHERE sc.origin = 'sos'
       AND (
             sc.company_id = v_uid
          OR sc.company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_id = v_uid)
       );

    IF v_open_sos >= 1 THEN
        RETURN jsonb_build_object('outcome', 'quota_exceeded', 'limit', 'open');
    END IF;
    IF v_week_sos >= 3 THEN
        RETURN jsonb_build_object('outcome', 'quota_exceeded', 'limit', 'week');
    END IF;

    -- ---------------------------------------------------------------------
    -- CIDADE. Resolve a empresa pelos DOIS formatos de ancoragem, preferindo o id exato.
    -- ---------------------------------------------------------------------
    SELECT c.city, c.name
      INTO v_city_raw, v_company_name
      FROM public.companies c
     WHERE c.id = v_job.company_id
        OR c.owner_id = v_job.company_id
     ORDER BY (c.id = v_job.company_id) DESC
     LIMIT 1;

    v_city := public.normalize_city(v_city_raw);
    IF v_city IS NULL THEN
        -- Sem cidade não há fronteira. Recusar é obrigatório: cair em "NULL = NULL" ou em
        -- "sem filtro" alcançaria a base inteira — o marketplace aberto por acidente.
        RETURN jsonb_build_object('outcome', 'company_city_missing');
    END IF;
    v_company_name := COALESCE(v_company_name, 'Uma empresa');

    -- ---------------------------------------------------------------------
    -- POOL (R1–R4, R11). Calculado aqui dentro e NUNCA devolvido.
    -- Teto de 30: sem ele, uma capital vira centenas de notificações num turno de 1 vaga.
    -- O ORDER BY é DESEMPATE do teto, não ranking (score contínuo é out-of-scope, R2).
    -- ---------------------------------------------------------------------
    SELECT array_agg(x.id) INTO v_pool
      FROM (
        SELECT w.id
          FROM public.workers w
         WHERE w.discoverable_for_sos                                  -- R4: opt-in explícito
           AND public.normalize_city(w.city) = v_city                  -- R1: mesma cidade
           AND w.completed_jobs_count >= 3                             -- R2.1: histórico real
           AND (COALESCE(w.reviews_count, 0) = 0
                OR COALESCE(w.rating_average, 5) >= 4.0)               -- R2.2: sem nota não pune
           AND w.id <> v_uid
           -- Fora do Elenco desta empresa, em QUALQUER status. 'blocked' é o veto do freela e
           -- é respeitado aqui (R2.3/A5); 'accepted'/'pending' já foram alcançados pelo
           -- chamado ao Elenco — rechamar seria notificação em dobro.
           AND NOT EXISTS (
                SELECT 1 FROM public.team_connections tc
                 WHERE tc.worker_id = w.id
                   AND (
                         tc.company_id = v_uid
                      OR tc.company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_id = v_uid)
                   )
           )
           -- Já tem relação com ESTE turno (candidatou, foi convidado, foi contratado, recusou
           -- ou cancelou). Rechamar produziria not_target/blocked_cancelled no aceite.
           AND NOT EXISTS (
                SELECT 1 FROM public.applications a
                 WHERE a.job_id = p_job_id AND a.worker_id = w.id
           )
           -- R11: cota do FREELA. Protege quem tem bom rating de virar alvo de spam de urgência.
           AND (
                SELECT count(*) FROM public.shift_call_targets t
                 WHERE t.worker_id   = w.id
                   AND t.origin      = 'sos'
                   AND t.notified_at > v_now - interval '7 days'
           ) < 2
         ORDER BY w.completed_jobs_count DESC, w.id
         LIMIT 30
      ) x;

    v_count := COALESCE(array_length(v_pool, 1), 0);
    IF v_count = 0 THEN
        -- Não criar o chamado: um SOS com zero alvos consumiria cota e mostraria à empresa
        -- "abri e ninguém veio" — falso, ninguém foi chamado.
        RETURN jsonb_build_object('outcome', 'pool_empty');
    END IF;

    -- Expira em 45 min, nunca depois do início do turno.
    v_expires := LEAST(v_now + interval '45 minutes', v_job.start_date);

    INSERT INTO public.shift_calls (
        job_id, company_id, created_by, slots, reason, message,
        targets_count, status, origin, expires_at
    ) VALUES (
        p_job_id, v_job.company_id, v_uid, v_job.slots, p_reason, p_message,
        v_count, 'open', 'sos', v_expires
    ) RETURNING id INTO v_call_id;

    -- O trigger grava origin='sos' em cada alvo.
    INSERT INTO public.shift_call_targets (call_id, worker_id)
    SELECT v_call_id, w FROM unnest(v_pool) AS w;

    -- ---------------------------------------------------------------------
    -- NOTIFICAÇÃO — TEM que ser aqui (R12).
    -- A policy notifications_insert_self_or_connected (20260702000000) só deixa a empresa
    -- escrever na caixa de quem tem team_connections 'accepted'. Um alvo de SOS, por definição,
    -- não tem. E o cliente precisaria da lista de ids para tentar — que é exatamente o que ele
    -- não pode ter. DEFINER não passa por essa RLS.
    --
    -- O TEXTO É REQUISITO, não cópia: o freela precisa entender por que uma empresa que ele não
    -- conhece está falando com ele, e como desligar isso. É o consentimento informado (R4) se
    -- pagando na prática.
    -- ---------------------------------------------------------------------
    INSERT INTO public.notifications (user_id, type, title, message, link)
    SELECT w,
           'status_change',
           'Chamado de urgência — ' || v_company_name,
           'Você não está no Elenco desta empresa. Recebeu este chamado porque tem boa reputação '
           || 'e está na mesma cidade, e você ativou a descoberta em urgência no seu perfil. '
           || 'Aceitar é opcional e recusar não tem nenhum efeito no seu perfil. Para parar de '
           || 'receber chamados de empresas fora do seu Elenco, desligue "Descoberta em '
           || 'urgência" no seu perfil.',
           '/my-jobs'
      FROM unnest(v_pool) AS w;

    RETURN jsonb_build_object(
        'outcome',       'created',
        'call_id',       v_call_id,
        'targets_count', v_count,
        'expires_at',    v_expires
    );
END;
$$;

COMMENT ON FUNCTION public.create_sos_call(uuid, text, text) IS
    'Abre um chamado de URGÊNCIA fora do Elenco (F11). Calcula o pool internamente (cidade + '
    'opt-in + corte de qualidade + cotas) e devolve SÓ {outcome, call_id, targets_count, '
    'expires_at} — NUNCA a lista de alvos. outcome: created | pool_empty | quota_exceeded | '
    'not_urgent | already_filled | team_not_tried | team_call_still_open | company_city_missing | '
    'job_started | job_deleted | invalid_reason | forbidden | not_found | unauthenticated. '
    'NÃO move saldo. NÃO cria team_connections. Kill switch: REVOKE EXECUTE FROM authenticated.';

REVOKE ALL ON FUNCTION public.create_sos_call(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sos_call(uuid, text, text) TO authenticated, service_role;


-- =============================================
-- 8. AJUSTES OBRIGATÓRIOS NOS TEXTOS DO F1 (C7 do ADR)
--    CREATE OR REPLACE das duas funções. `decline_shift_call` tem corpo verbatim de
--    20260817000200_shift_call_rpcs.sql (nenhuma migration posterior a redefine).
--    `claim_shift_slot` tem corpo verbatim de 20260817000500_claim_shift_slot_job_status.sql —
--    ESSE é o baseline vigente, não 000200: 000500 corrigiu um bug (turno soft-deletado com
--    chamado aberto voltava a ser reivindicável) e uma reescrita a partir de 000200 reverteria
--    esse fix silenciosamente (achado do gate de revisão desta feature, C7 do ADR-20260821).
--    Em ambas, alterando SÓ os blocos de texto abaixo (§2 do ddl-aprovado.md). Nenhuma outra
--    linha muda, nenhuma assinatura muda.
-- =============================================

-- 8.1 claim_shift_slot — aviso a quem perdeu a corrida, ramificado por origin.
CREATE OR REPLACE FUNCTION public.claim_shift_slot(p_call_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid           uuid := (SELECT auth.uid());
    v_now           timestamptz := now();
    v_call          public.shift_calls%ROWTYPE;
    v_target_id     uuid;
    v_target_resp   text;
    v_slots         integer;
    v_job_status    text;
    v_filled        integer;
    v_app_id        uuid;
    v_app_status    text;
    v_company_user  uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    SELECT * INTO v_call FROM public.shift_calls WHERE id = p_call_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- Ser alvo é pré-requisito e é checado ANTES do lock: um estranho não deve conseguir
    -- serializar a fila de um turno alheio só chamando a função em loop.
    SELECT t.id, t.response INTO v_target_id, v_target_resp
      FROM public.shift_call_targets t
     WHERE t.call_id = p_call_id AND t.worker_id = v_uid;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_target');
    END IF;

    IF v_target_resp IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'already_responded', 'response', v_target_resp);
    END IF;

    -- LOCK no turno (ver cabeçalho de 20260817000200). A partir daqui, um aceite por vez neste
    -- turno. Traz j.status junto (fix de 20260817000500) — mesmo SELECT, sem SELECT extra, sem
    -- mudar onde o lock mora.
    SELECT j.slots, j.status INTO v_slots, v_job_status
      FROM public.jobs j WHERE j.id = v_call.job_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- FIX (20260817000500): turno soft-deletado (status='deleted', ver 20260817000400 seção 2)
    -- com chamado ainda aberto não é mais reivindicável — fecha o chamado, mesma forma de
    -- fechamento preguiçoso já usada para expired/filled abaixo, e devolve 'cancelled' (outcome
    -- já existente no ShiftCallOutcome do frontend, nenhuma mudança de tipo necessária).
    IF v_job_status = 'deleted' THEN
        UPDATE public.shift_calls
           SET status = 'cancelled', closed_at = v_now
         WHERE id = p_call_id AND status = 'open';
        UPDATE public.shift_call_targets
           SET response = 'closed', responded_at = v_now
         WHERE call_id = p_call_id AND response IS NULL;
        RETURN jsonb_build_object('outcome', 'cancelled');
    END IF;

    -- Reler o chamado DEPOIS do lock: ele pode ter fechado enquanto esperávamos na fila.
    SELECT * INTO v_call FROM public.shift_calls WHERE id = p_call_id;

    IF v_call.status <> 'open' THEN
        RETURN jsonb_build_object(
            'outcome', CASE WHEN v_call.status = 'filled' THEN 'filled' ELSE v_call.status END
        );
    END IF;

    -- Expiração preguiçosa: quem chega atrasado fecha o chamado. Sem cron, sem job agendado.
    IF v_call.expires_at <= v_now THEN
        UPDATE public.shift_calls
           SET status = 'expired', closed_at = v_now
         WHERE id = p_call_id AND status = 'open';
        UPDATE public.shift_call_targets
           SET response = 'closed', responded_at = v_now
         WHERE call_id = p_call_id AND response IS NULL;
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    -- Quantas posições do turno já estão ocupadas (fonte da verdade: applications).
    SELECT count(*) INTO v_filled
      FROM public.applications a
     WHERE a.job_id = v_call.job_id
       AND a.status IN ('hired', 'in_progress', 'completed');

    IF v_filled >= v_slots THEN
        UPDATE public.shift_calls
           SET status = 'filled', closed_at = v_now
         WHERE id = p_call_id AND status = 'open';
        UPDATE public.shift_call_targets
           SET response = 'closed', responded_at = v_now
         WHERE call_id = p_call_id AND response IS NULL;
        RETURN jsonb_build_object('outcome', 'filled');
    END IF;

    SELECT a.id, a.status INTO v_app_id, v_app_status
      FROM public.applications a
     WHERE a.job_id = v_call.job_id AND a.worker_id = v_uid;

    IF v_app_id IS NULL THEN
        -- (a) do cabeçalho: INSERT não dispara os triggers de escrow (ambos são de UPDATE).
        INSERT INTO public.applications (
            job_id, worker_id, status,
            invited_by_company_at, invitation_response, invitation_responded_at, invitation_expires_at
        ) VALUES (
            v_call.job_id, v_uid, 'hired',
            v_call.created_at, 'accepted', v_now, v_call.expires_at
        ) RETURNING id INTO v_app_id;

    ELSIF v_app_status IN ('hired', 'in_progress', 'completed') THEN
        -- Já estava no turno (ex.: aceitou por outro chamado). Idempotente.
        UPDATE public.shift_call_targets
           SET response = 'accepted', responded_at = v_now
         WHERE id = v_target_id;
        RETURN jsonb_build_object('outcome', 'already_hired', 'application_id', v_app_id);

    ELSIF v_app_status = 'cancelled' THEN
        -- 'cancelled' é irreversível por decisão anterior do projeto (máquina de estados de
        -- cancelamento). Reabrir aqui contrabandearia uma exceção para essa regra.
        RETURN jsonb_build_object('outcome', 'blocked_cancelled');

    ELSE
        -- (b) do cabeçalho: dois UPDATEs para atravessar os triggers sem alterá-los.
        UPDATE public.applications
           SET status                = 'invited',
               invited_by_company_at = COALESCE(invited_by_company_at, v_call.created_at),
               invitation_expires_at = v_call.expires_at
         WHERE id = v_app_id;

        UPDATE public.applications
           SET status                  = 'hired',
               invitation_response     = 'accepted',
               invitation_responded_at = v_now
         WHERE id = v_app_id;
    END IF;

    UPDATE public.shift_call_targets
       SET response = 'accepted', responded_at = v_now
     WHERE id = v_target_id;

    v_filled := v_filled + 1;

    UPDATE public.shift_calls
       SET first_claim_at = COALESCE(first_claim_at, v_now)
     WHERE id = p_call_id;

    IF v_filled >= v_slots THEN
        -- O turno lotou: fecha TODOS os chamados abertos dele (podem ser mais de um) e os
        -- alvos pendentes de todos eles.
        UPDATE public.shift_call_targets t
           SET response = 'closed', responded_at = v_now
          FROM public.shift_calls sc
         WHERE t.call_id = sc.id
           AND sc.job_id = v_call.job_id
           AND t.response IS NULL;

        UPDATE public.shift_calls
           SET status = 'filled', closed_at = v_now
         WHERE job_id = v_call.job_id AND status = 'open';

        -- R10: quem ficou de fora é avisado. O texto é deliberadamente sem culpa — perder a
        -- corrida não é recusa e não conta contra o freela em lugar nenhum (R5). F11: quem foi
        -- alcançado por SOS não é "do elenco" — dizer isso seria mentira e corroeria o
        -- consentimento informado que o opt-in comprou (C7 do ADR).
        INSERT INTO public.notifications (user_id, type, title, message, link)
        SELECT t.worker_id,
               'status_change',
               'Vaga preenchida',
               'A vaga do turno que você recebeu foi preenchida por outro freela. '
               || CASE WHEN t.origin = 'sos'
                       THEN 'Nada muda para você — este era um chamado de urgência, não um convite do Elenco.'
                       ELSE 'Você continua no elenco e recebe os próximos chamados normalmente.'
                  END,
               '/my-jobs'
          FROM public.shift_call_targets t
          JOIN public.shift_calls sc ON sc.id = t.call_id
         WHERE sc.job_id      = v_call.job_id
           AND t.response     = 'closed'
           AND t.responded_at = v_now
           AND t.worker_id   <> v_uid;
    END IF;

    -- Avisar a empresa. `company_id` pode ser o id da empresa OU o uid do dono (ancoragem dupla
    -- histórica — ver 20260816210000); resolvemos os dois casos.
    SELECT c.owner_id INTO v_company_user
      FROM public.companies c WHERE c.id = v_call.company_id;
    IF v_company_user IS NULL THEN
        v_company_user := v_call.company_id;
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (
        v_company_user,
        'status_change',
        'Vaga preenchida no turno',
        'Um freela aceitou o chamado e ocupou uma vaga do turno.',
        '/company/jobs/' || v_call.job_id::text || '/candidates'
    );

    RETURN jsonb_build_object(
        'outcome', 'claimed',
        'application_id', v_app_id,
        'filled', v_filled,
        'slots', v_slots
    );
END;
$$;

-- 8.2 decline_shift_call — aviso à empresa quando o chamado esvazia, ramificado por origin.
CREATE OR REPLACE FUNCTION public.decline_shift_call(p_call_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid          uuid := (SELECT auth.uid());
    v_now          timestamptz := now();
    v_call         public.shift_calls%ROWTYPE;
    v_target_id    uuid;
    v_target_resp  text;
    v_pending      integer;
    v_accepted     integer;
    v_company_user uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    SELECT * INTO v_call FROM public.shift_calls WHERE id = p_call_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    SELECT t.id, t.response INTO v_target_id, v_target_resp
      FROM public.shift_call_targets t
     WHERE t.call_id = p_call_id AND t.worker_id = v_uid;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_target');
    END IF;
    IF v_target_resp IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'already_responded', 'response', v_target_resp);
    END IF;

    -- Recusa NÃO exige chamado aberto: se expirou, registrar a recusa é inofensivo e mantém
    -- o histórico honesto. Nenhuma punição, nenhum efeito em reputação/XP (R6).
    UPDATE public.shift_call_targets
       SET response = 'declined', responded_at = v_now
     WHERE id = v_target_id;

    SELECT count(*) FILTER (WHERE t.response IS NULL),
           count(*) FILTER (WHERE t.response = 'accepted')
      INTO v_pending, v_accepted
      FROM public.shift_call_targets t
     WHERE t.call_id = p_call_id;

    -- Chamado esvaziou (todo mundo respondeu, ninguém aceitou): a empresa precisa saber AGORA,
    -- não no fim da janela — é o caso em que ela tem de chamar mais gente.
    IF v_pending = 0 AND v_accepted = 0 AND v_call.status = 'open' THEN
        SELECT c.owner_id INTO v_company_user
          FROM public.companies c WHERE c.id = v_call.company_id;
        IF v_company_user IS NULL THEN
            v_company_user := v_call.company_id;
        END IF;

        INSERT INTO public.notifications (user_id, type, title, message, link)
        VALUES (
            v_company_user,
            'status_change',
            CASE WHEN v_call.origin = 'sos'
                 THEN 'Ninguém aceitou o chamado de urgência'
                 ELSE 'Ninguém aceitou o chamado'
            END,
            CASE WHEN v_call.origin = 'sos'
                 THEN 'Todos os freelas alcançados pelo chamado de urgência recusaram.'
                 ELSE 'Todos os freelas chamados para este turno recusaram. Chame mais gente do elenco.'
            END,
            '/company/jobs/' || v_call.job_id::text || '/candidates'
        );
    END IF;

    RETURN jsonb_build_object('outcome', 'declined', 'pending', v_pending);
END;
$$;

-- Refazer GRANT/COMMENT (idênticos ao F1 — a assinatura e o comportamento externo não mudam).
REVOKE ALL ON FUNCTION public.claim_shift_slot(uuid)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decline_shift_call(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_shift_slot(uuid)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_shift_call(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.claim_shift_slot(uuid) IS
    'Aceite de chamado com primeiro-aceite. Serializa no LOCK de jobs (as vagas são do turno, '
    'não do chamado). Devolve jsonb {outcome: claimed|filled|expired|cancelled|not_target|'
    'already_responded|already_hired|blocked_cancelled|not_found|unauthenticated}. '
    'NÃO move saldo: o caminho normal é INSERT, e os triggers de escrow são de UPDATE. '
    'F11: o aviso a quem perdeu a corrida é ramificado por origin (C7 do ADR-20260821).';
COMMENT ON FUNCTION public.decline_shift_call(uuid) IS
    'Recusa de chamado. NEUTRA — zero punição (R6/R7 do Slice 1). Avisa a empresa quando o '
    'chamado esvazia (todos responderam, ninguém aceitou). F11: título/corpo ramificados por '
    'origin quando o chamado é SOS (C7 do ADR-20260821).';
