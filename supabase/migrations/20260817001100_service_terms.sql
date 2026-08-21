-- Migration: Termo de prestação de serviço com aceite eletrônico (F6, modo A)
-- File: supabase/migrations/20260817001100_service_terms.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260818-termo-congelado-no-aceite.md
-- DDL aprovado: .harness/spec/termo-prestacao/ddl-aprovado.md (normativo)
-- Depende de: 20260630000000_shift_payments.sql, 20260712000000_shift_payment_scheduled.sql,
--             20260816220000_shift_payments_unique_por_freela.sql,
--             20260817000300_team_lists.sql (is_company_owner),
--             20260817000600_shift_attendance_confirmations.sql (job_local_date)
-- Gate: harness-architect (18/08/2026) — APPROVED_WITH_CHANGES.
--
-- ============================================================================
-- FRONTEIRA CRÍTICA (Article 8/9/10) — INALTERADA
-- ----------------------------------------------------------------------------
--   NÃO move saldo: nenhum UPDATE em wallets, nenhuma linha em escrow_transactions,
--   nenhuma RPC de saldo. `service_terms.amount` é CÓPIA DECLARATÓRIA de
--   shift_payments.amount para auditoria — não é saldo e não entra em soma alguma.
--   `shift_payments` continua REGISTRO, não liquidação: esta migration só ACRESCENTA
--   dois triggers AFTER de leitura + uma UNIQUE logicamente inviolável (alvo de FK).
--   Não reescreve enforce_shift_payment_immutability, não altera policy nem constraint.
--
-- FRONTEIRA JURÍDICA (estrutural, não copy) — LER ANTES DE ADICIONAR COLUNA
-- ----------------------------------------------------------------------------
--   A Worki NÃO é parte deste termo. NÃO adicionar, nunca: validated_by/validated_at,
--   verified, approved_by, reviewed_at, status com 'approved'/'valid', is_valid,
--   company_accepted_at, term_text_sha256/signature_hash/certificate_id.
--   O estado do termo é a presença de `accepted_at` — e nada mais.
--   A cláusula "a Worki não é parte / não valida / não garante" vive DENTRO de
--   term_text (item 4 do render), congelada e impressa. Requisito de UI se perde
--   numa refatoração; texto congelado, não.
--
-- CONGELAMENTO (decisão central do ADR)
-- ----------------------------------------------------------------------------
--   term_text é RASCUNHO enquanto accepted_at IS NULL (o freela precisa ler o que vai
--   assinar) e CONGELA no aceite: accept_service_term re-renderiza com os dados
--   vigentes e grava term_text + accepted_at no MESMO UPDATE. Depois disso, imutável
--   para TODOS os papéis — inclusive service_role e owner (trigger, §4).
--   Congelar na geração produzia documento assinado com "CPF: não informado" sempre
--   que o bloqueio de missing_cpf disparava. Ver ADR §Contexto.
--
-- DOWN (rollback): ver rodapé.
-- ============================================================================

-- =============================================
-- 1. ALVO DA FK COMPOSTA (em shift_payments)
-- =============================================
-- UNIQUE (id, job_id, worker_id, company_id) é LOGICAMENTE INVIOLÁVEL — `id` já é PK.
-- Existe só para ser alvo de FK composta: garante que as colunas denormalizadas de
-- service_terms NÃO PODEM divergir do marcador de pagamento. Sem isso, um bug no
-- trigger gravaria company_id errado e a RLS entregaria o CPF do freela para a
-- empresa errada. Colunas materiais de shift_payments são imutáveis → não há drift.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.shift_payments'::regclass
           AND conname  = 'uq_shift_payments_identity'
    ) THEN
        ALTER TABLE public.shift_payments
            ADD CONSTRAINT uq_shift_payments_identity
            UNIQUE (id, job_id, worker_id, company_id);
    END IF;
END $$;

-- =============================================
-- 2. TABELA
-- =============================================
CREATE TABLE IF NOT EXISTS public.service_terms (
    id                  uuid          DEFAULT gen_random_uuid() PRIMARY KEY,

    -- 1:1 com o marcador de pagamento. RESTRICT (NÃO cascade): documento assinado é
    -- auditoria e não some em cascata — mesma regra das FKs de shift_payments.
    shift_payment_id    uuid          NOT NULL UNIQUE
                                      REFERENCES public.shift_payments(id) ON DELETE RESTRICT,

    -- Denormalizados: âncora barata de RLS + auto-contenção do snapshot.
    -- A FK COMPOSTA abaixo garante que casam com o marcador. Não remover.
    job_id              uuid          NOT NULL REFERENCES public.jobs(id)      ON DELETE RESTRICT,
    worker_id           uuid          NOT NULL REFERENCES public.workers(id)   ON DELETE RESTRICT,
    company_id          uuid          NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,

    -- 'modelo-worki-v1' — MODELO (sugestão), não "termo oficial da Worki".
    term_version        text          NOT NULL,

    -- Texto RENDERIZADO. Rascunho enquanto accepted_at IS NULL; congelado depois.
    term_text           text          NOT NULL,

    -- Cópia declaratória do valor no momento do aceite. NÃO É SALDO (Article 8).
    amount              numeric(12,2) NOT NULL CHECK (amount > 0),

    created_at          timestamptz   NOT NULL DEFAULT now(),

    -- NULL = pendente. É o ÚNICO estado do termo (não existe coluna `status`).
    accepted_at         timestamptz,

    -- BEST-EFFORT e FALSIFICÁVEIS. text (nunca inet): cast de header lixo derrubaria
    -- o aceite. Ver DDL aprovado §1 pergunta 2.
    accepted_ip         text,
    accepted_user_agent text,

    -- Única porta de reescrita de term_text depois do aceite (alavanca LGPD, ADR C5).
    -- Fechada ao client (não há policy de UPDATE para authenticated). NÃO usar por default.
    anonymized_at       timestamptz,

    -- IP/UA só existem se houve aceite.
    CONSTRAINT service_terms_accept_consistency CHECK (
        accepted_at IS NOT NULL
        OR (accepted_ip IS NULL AND accepted_user_agent IS NULL)
    ),
    -- Truncagem defensiva: User-Agent é atacante-controlado e ilimitado.
    CONSTRAINT service_terms_ip_len CHECK (accepted_ip IS NULL OR length(accepted_ip) <= 100),
    CONSTRAINT service_terms_ua_len CHECK (accepted_user_agent IS NULL OR length(accepted_user_agent) <= 512),

    -- Denormalização não pode divergir do marcador.
    CONSTRAINT service_terms_payment_identity
        FOREIGN KEY (shift_payment_id, job_id, worker_id, company_id)
        REFERENCES public.shift_payments (id, job_id, worker_id, company_id)
        ON DELETE RESTRICT
);

COMMENT ON TABLE public.service_terms IS
    'Termo de prestacao de servico autonomo + responsabilidade tributaria, 1:1 com shift_payments (modo A). '
    'REGISTRO DECLARATORIO entre empresa e freela: a Worki NAO e parte, nao valida e nao garante validade '
    'juridica (a clausula esta DENTRO de term_text). NAO move saldo (Article 8). Retencao pos-exclusao de '
    'conta: prova de transacao encerrada (LGPD Art. 7 VI / Art. 16 I-II) — ver ADR-20260818.';
COMMENT ON COLUMN public.service_terms.term_text IS
    'Texto renderizado. RASCUNHO enquanto accepted_at IS NULL; CONGELADO no aceite (accept_service_term '
    're-renderiza e grava junto com accepted_at). Imutavel depois, para TODOS os papeis (trigger).';
COMMENT ON COLUMN public.service_terms.accepted_at IS
    'Timestamp do aceite eletronico. NULL = pendente. UNICO estado do termo — nao existe coluna status.';
COMMENT ON COLUMN public.service_terms.accepted_ip IS
    'BEST-EFFORT e FALSIFICAVEL. Primeiro elemento de x-forwarded-for, que o proprio cliente pode forjar '
    '(proxies fazem append). NULL quando a chamada nao vem do PostgREST. Indicio, NAO prova. Nunca rotular '
    'como "IP verificado" na UI.';
COMMENT ON COLUMN public.service_terms.accepted_user_agent IS
    'BEST-EFFORT. Header user-agent truncado em 512 chars. NULL fora do PostgREST. Indicio, nao prova.';
COMMENT ON COLUMN public.service_terms.amount IS
    'Copia DECLARATORIA de shift_payments.amount no momento do aceite (auditoria). NAO e saldo — nenhuma RPC.';
COMMENT ON COLUMN public.service_terms.anonymized_at IS
    'Unica transicao que permite reescrever term_text apos o aceite (LGPD). NULL->ts, one-way, fechada ao '
    'client. Por DEFAULT nao e usada: termo assinado e retido como prova (ADR-20260818 §Consequencias).';

-- =============================================
-- 3. ÍNDICES (tabela nova/vazia → CREATE INDEX simples; sem CONCURRENTLY)
-- =============================================
CREATE INDEX IF NOT EXISTS idx_service_terms_worker  ON public.service_terms (worker_id);
CREATE INDEX IF NOT EXISTS idx_service_terms_company ON public.service_terms (company_id);
CREATE INDEX IF NOT EXISTS idx_service_terms_job     ON public.service_terms (job_id);
-- (shift_payment_id já tem índice único pela constraint UNIQUE.)
-- Pendentes — usado pela query de ops V4 e por qualquer painel futuro de cobrança de aceite.
CREATE INDEX IF NOT EXISTS idx_service_terms_pending
    ON public.service_terms (company_id, created_at)
    WHERE accepted_at IS NULL;

-- =============================================
-- 4. RENDER — função PURA (recebe escalares, NÃO lê tabela)
-- =============================================
-- Pura de propósito: é chamada de dentro do trigger de geração, e uma exceção ali
-- ABORTA o registro do pagamento. Sem leitura de tabela, sem cast de texto, concat/coalesce
-- (nunca `||`: 'x' || NULL = NULL, e term_text é NOT NULL → 23502 derrubando o pagamento).
--
-- STABLE, não IMMUTABLE: to_char(numeric, text) é STABLE (depende de lc_numeric).
-- Marcar IMMUTABLE seria mentira e habilitaria constant-folding indevido.
CREATE OR REPLACE FUNCTION public.render_service_term_text(
    p_worker_name   text,
    p_worker_cpf    text,
    p_company_name  text,
    p_company_cnpj  text,
    p_job_title     text,
    p_job_date      date,
    p_amount        numeric,
    p_term_version  text
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT concat(
        'TERMO DE PRESTAÇÃO DE SERVIÇO AUTÔNOMO E RESPONSABILIDADE TRIBUTÁRIA', E'\n',
        'Modelo ', coalesce(nullif(btrim(p_term_version), ''), 'modelo-worki-v1'), E'\n\n',

        'PRESTADOR: ', coalesce(nullif(btrim(p_worker_name), ''), 'não informado'), E'\n',
        'CPF: ', coalesce(
            nullif(regexp_replace(coalesce(p_worker_cpf, ''), '\D', '', 'g'), ''),
            'não informado'
        ), E'\n\n',

        'CONTRATANTE: ', coalesce(nullif(btrim(p_company_name), ''), 'não informado'), E'\n',
        'CNPJ: ', coalesce(
            nullif(regexp_replace(coalesce(p_company_cnpj, ''), '\D', '', 'g'), ''),
            'não informado'
        ), E'\n\n',

        'SERVIÇO: ', coalesce(nullif(btrim(p_job_title), ''), 'sem título'), E'\n',
        'DATA DA PRESTAÇÃO: ', coalesce(to_char(p_job_date, 'DD/MM/YYYY'), 'não informada'), E'\n',
        'VALOR BRUTO: R$ ', coalesce(replace(to_char(p_amount, 'FM9999999990.00'), '.', ','), '0,00'),
        E'\n\n',

        '1. O PRESTADOR declara que executou o serviço acima de forma AUTÔNOMA, sem subordinação, ',
        'habitualidade ou exclusividade, não se caracterizando vínculo empregatício com a CONTRATANTE.',
        E'\n\n',
        '2. O valor acima é BRUTO. O PRESTADOR declara ser o único responsável pelo recolhimento dos ',
        'tributos e das contribuições previdenciárias incidentes sobre o valor recebido, isentando a ',
        'CONTRATANTE de tal responsabilidade.',
        E'\n\n',
        '3. O PRESTADOR declara ter recebido o valor acima diretamente da CONTRATANTE, por meio externo ',
        'à plataforma Worki.',
        E'\n\n',
        '4. A plataforma Worki NÃO é parte deste termo. Ela apenas REGISTRA a declaração e o aceite entre ',
        'PRESTADOR e CONTRATANTE. A Worki não é empregadora, não intermedia o pagamento, não presta ',
        'consultoria jurídica e não garante a validade jurídica deste documento.',
        E'\n\n',
        'Aceite eletrônico registrado pela plataforma na data e hora indicadas neste recibo.'
    );
$$;

COMMENT ON FUNCTION public.render_service_term_text(text,text,text,text,text,date,numeric,text) IS
    'Renderiza o texto do termo a partir de ESCALARES (nao le tabela). Chamada de dentro de triggers/RPC '
    'SECURITY DEFINER, onde uma excecao abortaria o registro do pagamento — por isso concat/coalesce e zero '
    'cast. O item 4 do texto (fronteira juridica) e ESTRUTURAL: nao remover.';

-- Ambos os chamadores (generate_service_term_on_payment, accept_service_term) são
-- SECURITY DEFINER de propriedade de `postgres` → o privilégio de EXECUTE é checado
-- contra postgres, não contra o usuário da sessão. Por isso NÃO precisa (e não deve)
-- ser exposta a `authenticated` via PostgREST.
-- ⚠️ Se algum dia um chamador virar SECURITY INVOKER, este GRANT precisa ser revisto.
REVOKE ALL ON FUNCTION public.render_service_term_text(text,text,text,text,text,date,numeric,text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.render_service_term_text(text,text,text,text,text,date,numeric,text)
    TO service_role;

-- =============================================
-- 5. HEADER BEST-EFFORT
-- =============================================
-- PostgREST faz set_config('request.headers', <json de todos os headers>, true) por
-- transação, chaves em MINÚSCULAS. Funciona dentro de SECURITY DEFINER (DEFINER troca o
-- ROLE, não os GUCs — mesmo raciocínio de auth.uid()/request.jwt.claims).
-- Devolve NULL fora do PostgREST (pg_cron, psql, SQL editor, service_role direto) e
-- devolve os headers da EDGE FUNCTION quando a chamada vem de lá (não do usuário final).
-- plpgsql por causa do EXCEPTION: o GUC pode existir e não ser JSON válido.
CREATE OR REPLACE FUNCTION public.request_header(p_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
    v_raw text;
BEGIN
    v_raw := current_setting('request.headers', true);
    IF v_raw IS NULL OR btrim(v_raw) = '' THEN
        RETURN NULL;
    END IF;
    RETURN nullif(btrim((v_raw::jsonb) ->> lower(p_name)), '');
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.request_header(text) IS
    'Le um header HTTP da request PostgREST (GUC request.headers, chaves minusculas). NULL fora do '
    'PostgREST. BEST-EFFORT: nunca levanta excecao. Valores derivados sao INDICIO, nao prova — '
    'x-forwarded-for e forjavel pelo cliente.';

REVOKE ALL ON FUNCTION public.request_header(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_header(text) TO service_role;

-- =============================================
-- 6. GERAÇÃO DO TERMO (rascunho) — AFTER INSERT/UPDATE em shift_payments
-- =============================================
-- Dispara na PRIMEIRA vez que o marcador vira 'recorded' (INSERT direto OU scheduled->recorded).
-- 'scheduled' NÃO gera termo (promessa ≠ pagamento) — A8 da spec.
--
-- NÃO engole exceção (ao contrário de notify_worker_on_shift_payment): termo faltando em
-- silêncio, sem backfill, é a feature inteira sumindo sem ninguém perceber. O corpo é
-- construído para não poder falhar (render puro, concat/coalesce, ON CONFLICT DO NOTHING).
--
-- NÃO escreve em shift_payments — se escrevesse, reentraria no BEFORE UPDATE de
-- enforce_shift_payment_immutability e bateria na imutabilidade das colunas materiais.
CREATE OR REPLACE FUNCTION public.generate_service_term_on_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_worker_name  text;
    v_worker_cpf   text;
    v_company_name text;
    v_company_cnpj text;
    v_job_title    text;
    v_job_date     date;
    v_version      text := 'modelo-worki-v1';
BEGIN
    SELECT w.full_name, w.cpf INTO v_worker_name, v_worker_cpf
      FROM public.workers w WHERE w.id = NEW.worker_id;

    SELECT c.name, c.cnpj INTO v_company_name, v_company_cnpj
      FROM public.companies c WHERE c.id = NEW.company_id;

    SELECT j.title INTO v_job_title
      FROM public.jobs j WHERE j.id = NEW.job_id;

    -- Data LOCAL do turno (America/Sao_Paulo) — ::date cru usaria UTC do servidor.
    v_job_date := public.job_local_date(NEW.job_id);

    INSERT INTO public.service_terms (
        shift_payment_id, job_id, worker_id, company_id,
        term_version, term_text, amount
    )
    VALUES (
        NEW.id, NEW.job_id, NEW.worker_id, NEW.company_id,
        v_version,
        public.render_service_term_text(
            v_worker_name, v_worker_cpf,
            v_company_name, v_company_cnpj,
            v_job_title, v_job_date,
            NEW.amount, v_version
        ),
        NEW.amount
    )
    ON CONFLICT (shift_payment_id) DO NOTHING;  -- idempotente por construção

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.generate_service_term_on_payment() IS
    'AFTER INSERT/UPDATE em shift_payments: cria o RASCUNHO do termo quando o marcador vira recorded. '
    'Idempotente (UNIQUE shift_payment_id + ON CONFLICT DO NOTHING). NAO move saldo (Article 8). '
    'NAO engole excecao — ver ADR-20260818.';

-- Trigger functions MANTÊM EXECUTE para authenticated: o privilégio é checado contra o
-- usuário da sessão que dispara o trigger. Revogar quebra o INSERT do pagamento
-- (landmine de 20260816201420 / corrigido em 20260816201457).
REVOKE ALL ON FUNCTION public.generate_service_term_on_payment() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_service_term_on_payment() TO authenticated, service_role;

-- INSERT direto com status='recorded' (recordExternalPayment — caminho legado suportado).
DROP TRIGGER IF EXISTS trg_generate_service_term_insert ON public.shift_payments;
CREATE TRIGGER trg_generate_service_term_insert
    AFTER INSERT ON public.shift_payments
    FOR EACH ROW
    WHEN (NEW.status = 'recorded')
    EXECUTE FUNCTION public.generate_service_term_on_payment();

-- Efetivação scheduled->recorded. WHEN de INSERT não pode referenciar OLD → dois triggers,
-- uma função (mesma arquitetura de notify_worker_on_shift_payment).
DROP TRIGGER IF EXISTS trg_generate_service_term_update ON public.shift_payments;
CREATE TRIGGER trg_generate_service_term_update
    AFTER UPDATE ON public.shift_payments
    FOR EACH ROW
    WHEN (NEW.status = 'recorded' AND OLD.status IS DISTINCT FROM 'recorded')
    EXECUTE FUNCTION public.generate_service_term_on_payment();

-- =============================================
-- 7. IMUTABILIDADE — BEFORE UPDATE (padrão enforce_shift_payment_immutability)
-- =============================================
-- Vale para TODOS os papéis, inclusive service_role e owner. RLS não bastaria:
-- service_role tem BYPASSRLS, o owner ignora RLS sem FORCE (e FORCE é proibido no
-- projeto), e a própria accept_service_term é SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.enforce_service_term_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- === Vínculo e valor: imutáveis SEMPRE ===
    IF NEW.id               IS DISTINCT FROM OLD.id
       OR NEW.shift_payment_id IS DISTINCT FROM OLD.shift_payment_id
       OR NEW.job_id           IS DISTINCT FROM OLD.job_id
       OR NEW.worker_id        IS DISTINCT FROM OLD.worker_id
       OR NEW.company_id       IS DISTINCT FROM OLD.company_id
       OR NEW.amount           IS DISTINCT FROM OLD.amount
       OR NEW.created_at       IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'service_terms: vinculo e valor sao imutaveis (shift_payment_id, job_id, worker_id, company_id, amount, created_at).';
    END IF;

    -- === accepted_at: ONE-WAY (NULL -> timestamp). Nunca altera, nunca limpa. ===
    IF OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
        RAISE EXCEPTION 'service_terms: accepted_at e imutavel apos o aceite.';
    END IF;

    -- === IP/UA: só podem ser gravados NO aceite; nunca reescritos depois. ===
    IF OLD.accepted_at IS NOT NULL
       AND (NEW.accepted_ip         IS DISTINCT FROM OLD.accepted_ip
         OR NEW.accepted_user_agent IS DISTINCT FROM OLD.accepted_user_agent)
    THEN
        RAISE EXCEPTION 'service_terms: accepted_ip/accepted_user_agent sao imutaveis apos o aceite.';
    END IF;

    -- === anonymized_at: ONE-WAY (NULL -> timestamp). Nunca volta. ===
    IF OLD.anonymized_at IS NOT NULL AND NEW.anonymized_at IS DISTINCT FROM OLD.anonymized_at THEN
        RAISE EXCEPTION 'service_terms: anonymized_at e imutavel.';
    END IF;

    -- === term_text / term_version: livres ENQUANTO rascunho; congelados no aceite. ===
    -- Única exceção pós-aceite: a anonimização LGPD (NULL -> ts), que é o ato de
    -- reescrever o texto. Fora dela, um termo aceito não muda mais.
    IF OLD.accepted_at IS NOT NULL
       AND (NEW.term_text IS DISTINCT FROM OLD.term_text
         OR NEW.term_version IS DISTINCT FROM OLD.term_version)
       AND NOT (OLD.anonymized_at IS NULL AND NEW.anonymized_at IS NOT NULL)
    THEN
        RAISE EXCEPTION 'service_terms: term_text/term_version sao imutaveis apos o aceite (unica excecao: anonimizacao LGPD).';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_service_term_immutability() IS
    'BEFORE UPDATE em service_terms. term_text e rascunho enquanto accepted_at IS NULL e CONGELA no aceite. '
    'Vale para TODOS os papeis (service_role e owner inclusive) — RLS nao cobriria. Unica reescrita '
    'pos-aceite: anonimizacao LGPD (anonymized_at NULL->ts). ADR-20260818.';

REVOKE ALL ON FUNCTION public.enforce_service_term_immutability() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_service_term_immutability() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_service_term_immutability ON public.service_terms;
CREATE TRIGGER trg_enforce_service_term_immutability
    BEFORE UPDATE ON public.service_terms
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_service_term_immutability();

-- =============================================
-- 8. RPC accept_service_term — outcomes, nunca exceção em caminho esperado
-- =============================================
-- Padrão do projeto: RETURNS jsonb com jsonb_build_object('outcome', ...) —
-- mesmo de respond_attendance_confirmation (20260817000700).
--
-- RE-RENDERIZA o texto e grava junto com accepted_at, no MESMO UPDATE (ADR): o que
-- congela é o que a pessoa aceitou, com o CPF que ela acabou de preencher.
CREATE OR REPLACE FUNCTION public.accept_service_term(p_service_term_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid            uuid := (SELECT auth.uid());
    v_term           public.service_terms%ROWTYPE;
    v_payment_status text;
    v_worker_name    text;
    v_worker_cpf     text;
    v_company_name   text;
    v_company_cnpj   text;
    v_job_title      text;
    v_job_date       date;
    v_text           text;
    v_ip             text;
    v_ua             text;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    -- FOR UPDATE: duplo clique / retry viram serial, não corrida.
    SELECT * INTO v_term
      FROM public.service_terms
     WHERE id = p_service_term_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_term.worker_id <> v_uid THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- Idempotente: não altera nada, devolve o estado (A7).
    IF v_term.accepted_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'outcome', 'already_accepted',
            'accepted_at', v_term.accepted_at
        );
    END IF;

    -- FOR SHARE (achado LOW do security-reviewer, 18/08/2026): sem lock aqui, a empresa
    -- podia estornar (`voidPayment` faz UPDATE em shift_payments) entre esta leitura e o
    -- UPDATE final que congela term_text/accepted_at — o aceite completaria sobre um
    -- pagamento já 'voided', deixando um termo assinado apontando para um estorno.
    -- FOR SHARE trava a linha de shift_payments contra qualquer UPDATE/DELETE concorrente
    -- (inclusive voidPayment) até este transaction commitar/abortar — sem impedir outras
    -- leituras compartilhadas, e sem mover saldo (Article 8 intacto: shift_payments não é
    -- alterado por esta RPC). Fecha a corrida sem precisar reler o status depois.
    SELECT sp.status INTO v_payment_status
      FROM public.shift_payments sp
     WHERE sp.id = v_term.shift_payment_id
     FOR SHARE;

    IF v_payment_status IS DISTINCT FROM 'recorded' THEN
        RETURN jsonb_build_object('outcome', 'payment_voided');
    END IF;

    SELECT w.full_name, w.cpf INTO v_worker_name, v_worker_cpf
      FROM public.workers w WHERE w.id = v_term.worker_id;

    -- 11 dígitos: onboarding já exige (WorkerOnboarding.tsx:160). Alcança só legados.
    IF length(regexp_replace(coalesce(v_worker_cpf, ''), '\D', '', 'g')) <> 11 THEN
        RETURN jsonb_build_object('outcome', 'missing_cpf');
    END IF;

    SELECT c.name, c.cnpj INTO v_company_name, v_company_cnpj
      FROM public.companies c WHERE c.id = v_term.company_id;

    SELECT j.title INTO v_job_title
      FROM public.jobs j WHERE j.id = v_term.job_id;

    v_job_date := public.job_local_date(v_term.job_id);

    -- Congela AGORA, com os dados vigentes.
    v_text := public.render_service_term_text(
        v_worker_name, v_worker_cpf,
        v_company_name, v_company_cnpj,
        v_job_title, v_job_date,
        v_term.amount, v_term.term_version
    );

    -- Best-effort. x-forwarded-for pode vir como "cliente, proxy1, proxy2" — o primeiro
    -- elemento é o que o CLIENTE enviou (forjável). Fallbacks para quando não vier.
    v_ip := left(
        coalesce(
            nullif(btrim(split_part(coalesce(public.request_header('x-forwarded-for'), ''), ',', 1)), ''),
            public.request_header('cf-connecting-ip'),
            public.request_header('x-real-ip')
        ), 100);
    v_ua := left(public.request_header('user-agent'), 512);

    UPDATE public.service_terms
       SET term_text           = v_text,
           accepted_at         = now(),
           accepted_ip         = v_ip,
           accepted_user_agent = v_ua
     WHERE id = v_term.id
       AND accepted_at IS NULL
    RETURNING accepted_at INTO v_term.accepted_at;

    IF v_term.accepted_at IS NULL THEN
        -- Perdeu a corrida (não deveria acontecer com FOR UPDATE). Trata como aceito.
        RETURN jsonb_build_object('outcome', 'already_accepted');
    END IF;

    RETURN jsonb_build_object(
        'outcome', 'accepted',
        'accepted_at', v_term.accepted_at
    );
END;
$$;

COMMENT ON FUNCTION public.accept_service_term(uuid) IS
    'Aceite eletronico do termo pelo freela. Re-renderiza e CONGELA term_text junto com accepted_at '
    '(ADR-20260818). Outcomes: unauthenticated | not_found | forbidden | already_accepted | payment_voided | '
    'missing_cpf | accepted. IP/UA best-effort (podem vir NULL). NAO move saldo (Article 8).';

REVOKE ALL ON FUNCTION public.accept_service_term(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_service_term(uuid) TO authenticated, service_role;

-- =============================================
-- 9. GRANTS DE TABELA
-- =============================================
-- ⚠️ NUNCA `REVOKE ALL ... FROM PUBLIC` em TABELA (só em função). Em tabela, revogar de
-- anon é o suficiente e é o padrão do projeto.
REVOKE ALL ON public.service_terms FROM anon;

-- authenticated LÊ e só. Não há INSERT/UPDATE/DELETE para o client em nenhuma hipótese:
-- as duas únicas escritas são o trigger de geração e a RPC de aceite, ambos SECURITY DEFINER.
GRANT SELECT ON public.service_terms TO authenticated;

-- service_role: leitura + a alavanca de anonimização. SEM INSERT (quem insere é o trigger,
-- que roda como owner) e SEM DELETE (auditoria não se apaga). Deliberadamente diferente do
-- `GRANT ALL TO service_role` de shift_payments.
GRANT SELECT, UPDATE ON public.service_terms TO service_role;

-- =============================================
-- 10. POLICIES (antes do ENABLE RLS)
-- =============================================
-- SELECT: só as duas partes. Empresa por is_company_owner (ancoragem DUPLA —
-- ADR-20260817-seam-autorizacao-empresa), superset do critério de sp_select_participants.
DROP POLICY IF EXISTS "st_select_participants" ON public.service_terms;
CREATE POLICY "st_select_participants" ON public.service_terms
    FOR SELECT TO authenticated
    USING (
        worker_id = (SELECT auth.uid())
        OR public.is_company_owner(company_id)
    );

-- SEM policy de INSERT / UPDATE / DELETE para authenticated. Intencional:
-- a única escrita é via trigger e RPC SECURITY DEFINER. A imutabilidade, porém, NÃO
-- depende disso — depende do trigger (§7), porque service_role e owner ignoram RLS.

-- =============================================
-- 11. RLS (depois das policies; SEM FORCE — ver 20260630000000)
-- =============================================
ALTER TABLE public.service_terms ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- DOWN (rollback) — sem impacto em saldo/escrow (nenhuma RPC financeira tocada):
--   DROP TRIGGER IF EXISTS trg_generate_service_term_insert ON public.shift_payments;
--   DROP TRIGGER IF EXISTS trg_generate_service_term_update ON public.shift_payments;
--   DROP TRIGGER IF EXISTS trg_enforce_service_term_immutability ON public.service_terms;
--   DROP FUNCTION IF EXISTS public.accept_service_term(uuid);
--   DROP FUNCTION IF EXISTS public.enforce_service_term_immutability();
--   DROP FUNCTION IF EXISTS public.generate_service_term_on_payment();
--   DROP FUNCTION IF EXISTS public.request_header(text);
--   DROP FUNCTION IF EXISTS public.render_service_term_text(text,text,text,text,text,date,numeric,text);
--   DROP TABLE IF EXISTS public.service_terms;   -- ⚠️ destrói termos ACEITOS. Exportar antes.
--   ALTER TABLE public.shift_payments DROP CONSTRAINT IF EXISTS uq_shift_payments_identity;
-- ============================================================================
