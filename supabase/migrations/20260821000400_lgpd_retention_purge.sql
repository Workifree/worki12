-- Migration: LGPD — expurgo de conteudo pessoal apos o prazo de retencao (debito pre-piloto #5)
-- File: supabase/migrations/20260821000400_lgpd_retention_purge.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260821-expurgo-de-conteudo-nao-de-linha.md
-- DDL aprovado (FONTE NORMATIVA): .harness/spec/lgpd-producao/ddl-aprovado.md §2.7
-- Gate: harness-architect (21/08/2026). H1 decidido pelo owner: 6 anos.
--
-- ⚠️ DESVIO AUTORIZADO DO CONTRATO (registrado 21/08/2026, autorizado pelo owner nesta sessao):
--   O contrato ddl-aprovado.md §2.7.0/§2.7.2 registra "5 anos" como a decisao do owner (prescricao
--   civil, CC art. 206 §5 I), com recomendacao TECNICA do architect de 6 anos (vetor trabalhista,
--   CF art. 7 XXIX: reclamacao alegando vinculo cabe ate 2 anos apos o fim da relacao, e o processo
--   dura anos — a prova que interessa e justamente o `term_text` que declara ausencia de vinculo,
--   e o cenario realista e precisar dele no ano 6 ou 7). O owner CORRIGIU a propria decisao original
--   para 6 anos nesta sessao. O desenho do contrato ja previa esta troca como um CREATE OR REPLACE
--   de tres linhas em `lgpd_retention_interval()` — foi isso que se fez aqui. Nenhuma outra peca do
--   contrato mudou.
--
-- ============================================================================
-- O QUE ESTA MIGRATION FAZ
-- ----------------------------------------------------------------------------
--   Cumpre o prazo de retencao que a #1 promete. Decorridos 6 anos de `paid_at` / `accepted_at`,
--   o CONTEUDO PESSOAL de `service_terms` e `shift_payments` e eliminado por UPDATE. A LINHA
--   permanece: valor, data e partes (uuids pseudonimos) continuam no banco e no BI.
--
--   NAO HA DELETE. Nem aqui, nem em lugar nenhum, nessas duas tabelas. Razoes (ADR):
--     - `shift_payments` NAO TEM policy de DELETE por decisao explicita de 20260630000000
--       ("auditoria nao se apaga; correcao = voided"). Um cron que apaga contradiz o schema.
--     - `service_terms.shift_payment_id` e RESTRICT (+ FK composta service_terms_payment_identity)
--       => DELETE teria ordem obrigatoria e lote abortado por erro de ordem. Sem DELETE, o
--       problema inteiro deixa de existir.
--     - Os dois guardas de imutabilidade sao BEFORE UPDATE. Um DELETE ESCAPA de ambos: seria a
--       unica operacao destrutiva do sistema sem guarda nenhum.
--
-- ============================================================================
-- ORDEM DE APLICACAO — OBRIGATORIA: #1 (20260821000000) ANTES DESTA
-- ----------------------------------------------------------------------------
--   Esta migration reescreve `enforce_service_term_immutability` com o corpo-SUPERSET: emenda da
--   anonimizacao (ip/ua -> NULL sob anonymized_at) + emenda do expurgo. Aplicada ANTES da #1, a
--   #1 sobrescreveria a excecao do expurgo EM SILENCIO e o cron passaria a falhar todo dia.
--   A assercao abaixo torna isso impossivel: FALHA FECHADO.
--
-- ============================================================================
-- FRONTEIRA FINANCEIRA (Article 8/9) — INTACTA POR CONSTRUCAO
-- ----------------------------------------------------------------------------
--   Nenhuma tabela de saldo/razao e LIDA ou ESCRITA por esta migration. Nenhuma RPC de saldo e
--   tocada. `wallet_transactions`/`escrow_transactions` nao aparecem em nenhuma query daqui.
--
-- Risk: MEDIUM — rotina destrutiva de conteudo, agendada, que atinge tambem CONTAS VIVAS
--   (o prazo e do DADO, nao da conta — ddl-aprovado §2.7.0). Irreversivel por natureza.
-- Backup required before production deploy: SIM (pg_dump de service_terms e shift_payments).
--
-- PRIMEIRA EXECUCAO: rodar em DRY-RUN antes de deixar o cron ativo (V4 da secao COMO VERIFICAR).
--   Com 6 anos de prazo e a plataforma em piloto, o esperado hoje e ZERO linha elegivel — se o
--   dry-run devolver numero > 0, PARE: ou o relogio do banco esta errado, ou ha dado de teste com
--   data antiga. Nao "confirme" um expurgo que voce nao explica.
--
-- DOWN (rollback): ver rodape. O DOWN NAO restaura conteudo ja expurgado.
-- ============================================================================

-- =============================================
-- 1. ASSERCAO DE ORDEM — a #1 precisa estar aplicada
--    Marcadores da #1: `service_terms.anonymized_at` ja existia (20260817001100), mas
--    `workers.anonymized_at` e `public.anonymize_account` NASCEM na #1. Exigimos os dois.
-- =============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'workers' AND column_name = 'anonymized_at'
    ) THEN
        RAISE EXCEPTION
          'ASSERCAO DE ORDEM: 20260821000000 (lgpd_account_anonymization) NAO esta aplicada. '
          'Esta migration reescreve enforce_service_term_immutability com o corpo-superset; '
          'aplicar fora de ordem faria a #1 apagar a excecao do expurgo em silencio. HALT.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'anonymize_account'
    ) THEN
        RAISE EXCEPTION
          'ASSERCAO DE ORDEM: public.anonymize_account nao existe — a #1 nao esta aplicada. HALT.';
    END IF;
END $$;

-- =============================================
-- 2. O PRAZO, NUM LUGAR SO
--    Consumida pela RPC de expurgo E pelos DOIS triggers de imutabilidade. Trocar o numero de
--    anos e um CREATE OR REPLACE desta funcao, e mais nada. NAO inline o literal em lugar nenhum.
-- =============================================
CREATE OR REPLACE FUNCTION public.lgpd_retention_interval()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT interval '6 years' $$;

COMMENT ON FUNCTION public.lgpd_retention_interval() IS
    'Prazo de retencao do CONTEUDO PESSOAL de service_terms.term_text e shift_payments.note. '
    '6 anos — decisao do owner em 21/08/2026 (correcao da decisao original de 5 anos, que '
    'raciocinava pela prescricao civil, CC art. 206 §5 I). O risco real e a reclamacao '
    'trabalhista alegando vinculo, que cabe ate 2 anos apos o fim da relacao (CF art. 7 XXIX) '
    'e cujo processo dura anos: a prova que interessa e o `term_text`, que declara ausencia de '
    'vinculo, e o cenario realista e precisar dele no ano 6 ou 7. Numero e escolha de '
    'ORQUESTRACAO, PENDENTE de confirmacao juridica formal; quem precisar de mais prazo numa '
    'linha especifica usa a trava de litigio (retention_hold_reason). Ponto UNICO de verdade: '
    'consumida pela RPC purge_expired_personal_data e pelos triggers '
    'enforce_service_term_immutability / enforce_shift_payment_immutability. '
    'ADR-20260821-expurgo-de-conteudo-nao-de-linha.';

-- Custo zero e evita a assimetria de risco de 20260816201457 (funcao de trigger sem EXECUTE):
-- esta funcao nao devolve dado nenhum, so o literal do prazo.
REVOKE ALL ON FUNCTION public.lgpd_retention_interval() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lgpd_retention_interval() TO service_role, authenticated;

-- =============================================
-- 3. MARCADORES DO EXPURGO + TRAVA DE LITIGIO
--    ADD COLUMN nullable sem DEFAULT = sem reescrita de heap.
-- =============================================
ALTER TABLE public.service_terms   ADD COLUMN IF NOT EXISTS purged_at            timestamptz;
ALTER TABLE public.service_terms   ADD COLUMN IF NOT EXISTS retention_hold_reason text;
ALTER TABLE public.shift_payments  ADD COLUMN IF NOT EXISTS purged_at            timestamptz;

COMMENT ON COLUMN public.service_terms.purged_at IS
    'Expurgo de retencao (LGPD): venceu o prazo de lgpd_retention_interval() e o CONTEUDO PESSOAL '
    'desta linha foi eliminado (term_text -> marcador, accepted_ip/accepted_user_agent -> NULL). '
    'A LINHA permanece: amount, accepted_at, partes e vinculos sao RETIDOS. One-way, fechada ao '
    'client (service_terms so tem policy de SELECT). NAO confundir com anonymized_at, que marca '
    'exclusao de CONTA — o expurgo atinge conta viva tambem (o prazo e do DADO).';
COMMENT ON COLUMN public.shift_payments.purged_at IS
    'Expurgo de retencao (LGPD) — ver public.service_terms.purged_at. Nesta tabela o expurgo '
    'apaga APENAS `note` (unico texto livre). Valor, datas e partes sao RETIDOS: o BI de gasto '
    'historico sobrevive ao expurgo.';
COMMENT ON COLUMN public.service_terms.retention_hold_reason IS
    'TRAVA DE LITIGIO. Nao-NULL = esta linha (e o `note` do shift_payment correspondente) e '
    'PULADA pelo expurgo, indefinidamente, mesmo vencido o prazo. Preenchida por operacao '
    '(service_role) quando ha litigio/investigacao em curso. Inalcancavel pelo client por '
    'construcao: service_terms so tem policy de SELECT. Limpar a trava reabre a linha ao expurgo.';

-- Indices parciais: a varredura diaria pergunta "quem ainda NAO foi expurgado e ja venceu".
-- Expressao coalesce(...) e IMMUTABLE => indexavel. Sem CONCURRENTLY (migration roda em transacao).
CREATE INDEX IF NOT EXISTS idx_service_terms_retention_due
    ON public.service_terms ((coalesce(accepted_at, created_at)))
    WHERE purged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shift_payments_retention_due
    ON public.shift_payments ((coalesce(paid_at, created_at)))
    WHERE purged_at IS NULL;

-- =============================================
-- 4. PROVA DE CONFORMIDADE — registro das operacoes de tratamento (LGPD art. 37)
--    Sem isto, "expurgamos" e afirmacao sem lastro. Com isto, e consulta.
--    RLS habilitada e ZERO policy: nenhum client le (service_role ignora RLS).
-- =============================================
CREATE TABLE IF NOT EXISTS public.data_retention_purge_runs (
    id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    ran_at                timestamptz NOT NULL DEFAULT now(),
    cutoff                timestamptz NOT NULL,
    retention_interval    interval    NOT NULL,
    batch_limit           integer     NOT NULL,
    service_terms_purged  integer     NOT NULL DEFAULT 0,
    shift_payments_purged integer     NOT NULL DEFAULT 0,
    service_terms_held    integer     NOT NULL DEFAULT 0,
    duration_ms           integer     NOT NULL DEFAULT 0
);

ALTER TABLE public.data_retention_purge_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.data_retention_purge_runs IS
    'Registro das execucoes do expurgo de retencao (LGPD art. 37 — registro das operacoes de '
    'tratamento). Uma linha por execucao EFETIVA do cron/RPC. Dry-run NAO grava (diagnostico nao '
    'e operacao de tratamento). RLS habilitada sem policy: so service_role le. Nunca contem dado '
    'pessoal — so contagens.';
COMMENT ON COLUMN public.data_retention_purge_runs.service_terms_held IS
    'Quantas linhas VENCIDAS foram puladas por retention_hold_reason (trava de litigio). Numero '
    'alto e persistente = alguem esqueceu de limpar uma trava.';

-- =============================================
-- 5. shift_payments — corpo vigente (20260712000000) + RAMO DE EXPURGO no topo
--    O ramo e AUTO-LIMITADO: so existe se as 5 condicoes de §0.3.1 valerem juntas. O gatilho
--    (purged_at NULL -> ts) e barato, entao UPDATE normal nao paga nada pelas checagens caras.
--    Se alguem entra no gatilho e NAO cumpre a forma, e RAISE — nunca fall-through silencioso.
-- =============================================
CREATE OR REPLACE FUNCTION public.enforce_shift_payment_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_is_company BOOLEAN;
    v_is_worker  BOOLEAN;
BEGIN
    -- === EMENDA 2026-08-21 (LGPD, expurgo de retencao) ==========================
    -- Gatilho barato: so o expurgo leva purged_at de NULL para timestamp.
    IF OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL THEN
        IF auth.uid() IS NULL
           -- (b) a linha PASSOU DO PRAZO. Nem service_role expurga registro de ontem.
           AND coalesce(OLD.paid_at, OLD.created_at) <= now() - public.lgpd_retention_interval()
           -- (c) forma do expurgo nesta tabela: `note` some, e so.
           AND NEW.note IS NULL
           -- (d) trava de litigio do termo correspondente
           AND NOT EXISTS (
                 SELECT 1 FROM public.service_terms st
                  WHERE st.shift_payment_id = OLD.id
                    AND st.retention_hold_reason IS NOT NULL
               )
           -- (e) NADA alem das colunas do expurgo mudou. E isto que autoriza o RETURN cedo:
           --     se todo o resto e identico, o corpo abaixo nao teria o que reprovar. Protege
           --     tambem colunas que ainda nao existem.
           AND (to_jsonb(NEW) - ARRAY['note','purged_at'])
               IS NOT DISTINCT FROM
               (to_jsonb(OLD) - ARRAY['note','purged_at'])
        THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'shift_payments: expurgo fora da forma permitida (exige service_role, prazo de retencao vencido, ausencia de trava de litigio e nenhuma alteracao alem de note->NULL).';
    END IF;

    -- purged_at e ONE-WAY e so o expurgo o escreve. Qualquer outro caminho para.
    IF NEW.purged_at IS DISTINCT FROM OLD.purged_at THEN
        RAISE EXCEPTION 'shift_payments: purged_at so pode ser definido pelo expurgo de retencao e depois e imutavel.';
    END IF;
    -- === FIM DA EMENDA — abaixo, corpo vigente INALTERADO ======================

    -- === COLUNAS MATERIAIS SEMPRE IMUTÁVEIS (todos os papéis, inclusive service_role) ===
    -- scheduled_for entra aqui: a PROMESSA não se reescreve (reagendar = void + novo).
    IF NEW.id             IS DISTINCT FROM OLD.id
       OR NEW.job_id         IS DISTINCT FROM OLD.job_id
       OR NEW.company_id     IS DISTINCT FROM OLD.company_id
       OR NEW.worker_id      IS DISTINCT FROM OLD.worker_id
       OR NEW.application_id IS DISTINCT FROM OLD.application_id
       OR NEW.source         IS DISTINCT FROM OLD.source
       OR NEW.amount         IS DISTINCT FROM OLD.amount
       OR NEW.recorded_by    IS DISTINCT FROM OLD.recorded_by
       OR NEW.note           IS DISTINCT FROM OLD.note
       OR NEW.created_at     IS DISTINCT FROM OLD.created_at
       OR NEW.scheduled_for  IS DISTINCT FROM OLD.scheduled_for
    THEN
        RAISE EXCEPTION 'shift_payments: colunas materiais sao imutaveis (job_id, company_id, worker_id, application_id, source, amount, recorded_by, note, created_at, scheduled_for). Correcao = estorno logico (voided).';
    END IF;

    -- === paid_at: imutável, EXCETO a efetivacao (scheduled->recorded) que o define UMA vez ===
    IF NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
        IF NOT (OLD.status = 'scheduled' AND NEW.status = 'recorded'
                AND OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL) THEN
            RAISE EXCEPTION 'shift_payments: paid_at so pode ser definido na efetivacao (scheduled->recorded) e depois e imutavel.';
        END IF;
    END IF;

    -- === Registro estornado é IMUTÁVEL (não re-abre, não re-confirma) ===
    IF OLD.status = 'voided' THEN
        RAISE EXCEPTION 'shift_payments: registro estornado (voided) e imutavel.';
    END IF;

    -- === Transições de status permitidas ===
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT (
            (OLD.status = 'scheduled' AND NEW.status IN ('recorded', 'voided'))
            OR (OLD.status = 'recorded' AND NEW.status = 'voided')
        ) THEN
            RAISE EXCEPTION 'shift_payments: transicao de status invalida (% -> %).', OLD.status, NEW.status;
        END IF;
    END IF;

    -- === worker_confirmed_at é ONE-WAY (NULL → timestamp; nunca altera/limpa) ===
    IF OLD.worker_confirmed_at IS NOT NULL
       AND NEW.worker_confirmed_at IS DISTINCT FROM OLD.worker_confirmed_at
    THEN
        RAISE EXCEPTION 'shift_payments: worker_confirmed_at nao pode ser alterado apos a confirmacao.';
    END IF;

    -- === PARTIÇÃO POR PAPEL (só p/ chamadas autenticadas; service_role/trigger tem auth.uid() NULL) ===
    IF auth.uid() IS NOT NULL THEN
        v_is_company := EXISTS (
            SELECT 1 FROM public.companies WHERE id = NEW.company_id AND owner_id = auth.uid()
        );
        v_is_worker := (NEW.worker_id = auth.uid());

        IF v_is_worker AND NOT v_is_company THEN
            -- Freela: SÓ pode setar worker_confirmed_at (num registro já 'recorded'). Nada mais muda.
            IF NEW.status      IS DISTINCT FROM OLD.status
               OR NEW.voided_at   IS DISTINCT FROM OLD.voided_at
               OR NEW.void_reason IS DISTINCT FROM OLD.void_reason
               OR NEW.paid_at     IS DISTINCT FROM OLD.paid_at
            THEN
                RAISE EXCEPTION 'shift_payments: freela so pode confirmar recebimento (worker_confirmed_at).';
            END IF;
        ELSIF v_is_company THEN
            -- Empresa: efetiva (scheduled->recorded), cancela (->voided), estorna; NÃO toca a confirmacao do freela.
            IF NEW.worker_confirmed_at IS DISTINCT FROM OLD.worker_confirmed_at THEN
                RAISE EXCEPTION 'shift_payments: empresa nao pode alterar a confirmacao do freela.';
            END IF;
        ELSE
            RAISE EXCEPTION 'shift_payments: usuario nao autorizado a atualizar este registro.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_shift_payment_immutability() IS
    'BEFORE UPDATE em shift_payments. Colunas materiais imutaveis para TODOS os papeis; correcao = '
    'estorno logico (voided). UNICA excecao: o expurgo de retencao LGPD (purged_at NULL->ts por '
    'service_role, com prazo vencido e nada alem de note->NULL) — ver '
    'ADR-20260821-expurgo-de-conteudo-nao-de-linha. O prazo mora em lgpd_retention_interval(): '
    'a regra de retencao e verificada AQUI, nao so na RPC que a aplica.';

-- =============================================
-- 6. service_terms — CORPO-SUPERSET
--    = corpo de 20260817001100
--      + emenda da ANONIMIZACAO (ddl-aprovado §2.4: ip/ua -> NULL sob anonymized_at NULL->ts)
--      + emenda do EXPURGO (esta migration)
--    Aplicar esta migration ANTES da #1 apagaria a segunda emenda. A assercao de ordem (secao 1)
--    impede isso.
-- =============================================
CREATE OR REPLACE FUNCTION public.enforce_service_term_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    -- EMENDA 2026-08-21 (anonimizacao): a transicao de anonimizacao, calculada uma vez.
    v_anonymizing boolean := (OLD.anonymized_at IS NULL AND NEW.anonymized_at IS NOT NULL);
BEGIN
    -- === EMENDA 2026-08-21 (LGPD, expurgo de retencao) ==========================
    -- NAO reaproveita v_anonymizing: o expurgo atinge CONTA VIVA (o prazo e do DADO —
    -- ddl-aprovado §2.7.0), e em conta viva anonymized_at e e continua NULL.
    IF OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL THEN
        IF auth.uid() IS NULL
           AND OLD.retention_hold_reason IS NULL
           AND coalesce(OLD.accepted_at, OLD.created_at) <= now() - public.lgpd_retention_interval()
           -- forma do expurgo nesta tabela: telemetria some, term_text vira marcador.
           -- O VALOR do marcador e da RPC, nao do trigger (nao se duplica texto normativo).
           AND NEW.accepted_ip IS NULL
           AND NEW.accepted_user_agent IS NULL
           AND NEW.term_text IS NOT NULL
           AND (to_jsonb(NEW) - ARRAY['term_text','accepted_ip','accepted_user_agent','purged_at'])
               IS NOT DISTINCT FROM
               (to_jsonb(OLD) - ARRAY['term_text','accepted_ip','accepted_user_agent','purged_at'])
        THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'service_terms: expurgo fora da forma permitida (exige service_role, prazo de retencao vencido, ausencia de retention_hold_reason e nenhuma alteracao alem de term_text/accepted_ip/accepted_user_agent).';
    END IF;

    IF NEW.purged_at IS DISTINCT FROM OLD.purged_at THEN
        RAISE EXCEPTION 'service_terms: purged_at so pode ser definido pelo expurgo de retencao e depois e imutavel.';
    END IF;

    -- Trava de litigio: so operacao (service_role) poe e tira. Client nem chega aqui
    -- (service_terms so tem policy de SELECT) — defesa em profundidade.
    IF auth.uid() IS NOT NULL
       AND NEW.retention_hold_reason IS DISTINCT FROM OLD.retention_hold_reason
    THEN
        RAISE EXCEPTION 'service_terms: retention_hold_reason e gerida por operacao (service_role).';
    END IF;
    -- === FIM DA EMENDA DO EXPURGO ==============================================

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
    -- EMENDA 2026-08-21 (LGPD): exceção única — a anonimização pode APAGÁ-LOS (levar a NULL).
    -- Levar a QUALQUER OUTRO VALOR continua proibido: não se falsifica trilha de aceite.
    IF OLD.accepted_at IS NOT NULL
       AND (NEW.accepted_ip         IS DISTINCT FROM OLD.accepted_ip
         OR NEW.accepted_user_agent IS DISTINCT FROM OLD.accepted_user_agent)
       AND NOT (v_anonymizing
                AND NEW.accepted_ip IS NULL
                AND NEW.accepted_user_agent IS NULL)
    THEN
        RAISE EXCEPTION 'service_terms: accepted_ip/accepted_user_agent sao imutaveis apos o aceite (unica excecao: anonimizacao LGPD, e apenas para NULL).';
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
       AND NOT v_anonymizing
    THEN
        RAISE EXCEPTION 'service_terms: term_text/term_version sao imutaveis apos o aceite (unica excecao: anonimizacao LGPD).';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_service_term_immutability() IS
    'BEFORE UPDATE em service_terms. term_text e rascunho enquanto accepted_at IS NULL e CONGELA no '
    'aceite. Vale para TODOS os papeis (service_role e owner inclusive) — RLS nao cobriria. DUAS '
    'reescritas pos-aceite, e so elas: (1) anonimizacao LGPD (anonymized_at NULL->ts), que tambem '
    'apaga accepted_ip/accepted_user_agent; (2) EXPURGO de retencao (purged_at NULL->ts por '
    'service_role, com prazo de lgpd_retention_interval() vencido e sem retention_hold_reason). '
    'ADR-20260818 + ADR-20260821-anonimizacao-em-vez-de-exclusao + '
    'ADR-20260821-expurgo-de-conteudo-nao-de-linha.';

-- =============================================
-- 7. RPC DO EXPURGO
--    SECURITY DEFINER + search_path='' + GRANT EXECUTE SOMENTE a service_role.
--    Idempotente (purged_at IS NULL filtra o que ja foi feito) e em LOTE: reexecutar drena o
--    backlog em dias, sem lock longo. Devolve `outcome` estruturado — nunca levanta excecao em
--    caminho esperado.
--    p_dry_run=true: MESMO predicado, ZERO escrita. E como se confere antes de deixar o cron
--    ativo, e como se responde "quanto tem para expurgar?" sem confiar em contagem no client.
-- =============================================
CREATE OR REPLACE FUNCTION public.purge_expired_personal_data(
    p_batch_limit integer DEFAULT 500,
    p_dry_run     boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_started  timestamptz := clock_timestamp();
    v_cutoff   timestamptz := now() - public.lgpd_retention_interval();
    v_limit    integer     := least(greatest(coalesce(p_batch_limit, 500), 1), 5000);
    v_terms    integer     := 0;
    v_payments integer     := 0;
    v_held     integer     := 0;
    c_purged_term constant text :=
        '[REGISTRO EXPURGADO — o prazo legal de retencao deste documento venceu e o conteudo '
        'pessoal (nomes, CPF/CNPJ e demais dados de identificacao) foi eliminado pela Worki, nos '
        'termos da LGPD (art. 15, I e art. 16). O registro da transacao — valor, data do aceite e '
        'as partes, em identificadores internos — foi mantido.]';
BEGIN
    -- Cinto e suspensorio: nao ha GRANT para authenticated, e o trigger exigiria auth.uid() NULL
    -- de qualquer forma. Falhar aqui e mais legivel do que falhar la dentro.
    IF auth.uid() IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- Quantas linhas VENCIDAS estao travadas por litigio (observabilidade, nao acao).
    SELECT count(*) INTO v_held
      FROM public.service_terms st
     WHERE st.purged_at IS NULL
       AND st.retention_hold_reason IS NOT NULL
       AND coalesce(st.accepted_at, st.created_at) <= v_cutoff;

    IF p_dry_run THEN
        SELECT count(*) INTO v_terms FROM (
            SELECT 1 FROM public.service_terms st
             WHERE st.purged_at IS NULL
               AND st.retention_hold_reason IS NULL
               AND coalesce(st.accepted_at, st.created_at) <= v_cutoff
             LIMIT v_limit
        ) q;

        SELECT count(*) INTO v_payments FROM (
            SELECT 1 FROM public.shift_payments sp
             WHERE sp.purged_at IS NULL
               AND coalesce(sp.paid_at, sp.created_at) <= v_cutoff
               AND NOT EXISTS (
                     SELECT 1 FROM public.service_terms st
                      WHERE st.shift_payment_id = sp.id
                        AND st.retention_hold_reason IS NOT NULL
                   )
             LIMIT v_limit
        ) q;

        -- Dry-run NAO grava em data_retention_purge_runs: diagnostico nao e operacao de
        -- tratamento (art. 37). O registro so existe para o que de fato aconteceu.
        RETURN jsonb_build_object(
            'outcome', 'dry_run',
            'cutoff', v_cutoff,
            'batch_limit', v_limit,
            'service_terms', v_terms,
            'shift_payments', v_payments,
            'service_terms_held', v_held
        );
    END IF;

    -- =========================================================
    -- A PARTIR DAQUI E DESTRUTIVO (de CONTEUDO; nenhuma linha e apagada).
    -- =========================================================

    -- ---- service_terms: term_text -> marcador; telemetria do aceite -> NULL ----
    -- SKIP LOCKED: se alguem estiver segurando a linha, ela fica para a proxima execucao.
    -- O expurgo nao tem pressa e nao pode virar fonte de lock em producao.
    WITH alvo AS (
        SELECT st.id
          FROM public.service_terms st
         WHERE st.purged_at IS NULL
           AND st.retention_hold_reason IS NULL
           AND coalesce(st.accepted_at, st.created_at) <= v_cutoff
         ORDER BY coalesce(st.accepted_at, st.created_at)
         LIMIT v_limit
           FOR UPDATE SKIP LOCKED
    )
    UPDATE public.service_terms st
       SET term_text           = c_purged_term,
           accepted_ip         = NULL,
           accepted_user_agent = NULL,
           purged_at           = now()
      FROM alvo
     WHERE st.id = alvo.id;
    GET DIAGNOSTICS v_terms = ROW_COUNT;

    -- ---- shift_payments: note -> NULL. Valor, datas e partes RETIDOS (BI sobrevive) ----
    -- Linhas cujo `note` ja e NULL tambem sao marcadas: purged_at e o marcador de conformidade,
    -- nao de "teve texto". Sem isso o backlog nunca drena e a contagem mente.
    WITH alvo AS (
        SELECT sp.id
          FROM public.shift_payments sp
         WHERE sp.purged_at IS NULL
           AND coalesce(sp.paid_at, sp.created_at) <= v_cutoff
           AND NOT EXISTS (
                 SELECT 1 FROM public.service_terms st
                  WHERE st.shift_payment_id = sp.id
                    AND st.retention_hold_reason IS NOT NULL
               )
         ORDER BY coalesce(sp.paid_at, sp.created_at)
         LIMIT v_limit
           FOR UPDATE SKIP LOCKED
    )
    UPDATE public.shift_payments sp
       SET note      = NULL,
           purged_at = now()
      FROM alvo
     WHERE sp.id = alvo.id;
    GET DIAGNOSTICS v_payments = ROW_COUNT;

    INSERT INTO public.data_retention_purge_runs (
        cutoff, retention_interval, batch_limit,
        service_terms_purged, shift_payments_purged, service_terms_held, duration_ms
    ) VALUES (
        v_cutoff, public.lgpd_retention_interval(), v_limit,
        v_terms, v_payments, v_held,
        (extract(epoch FROM clock_timestamp() - v_started) * 1000)::integer
    );

    RETURN jsonb_build_object(
        'outcome', 'purged',
        'cutoff', v_cutoff,
        'batch_limit', v_limit,
        'service_terms', v_terms,
        'shift_payments', v_payments,
        'service_terms_held', v_held,
        -- true = ainda ha backlog; a proxima execucao continua de onde esta.
        'has_more', (v_terms >= v_limit OR v_payments >= v_limit)
    );
END;
$$;

COMMENT ON FUNCTION public.purge_expired_personal_data(integer, boolean) IS
    'Expurgo de retencao LGPD. UPDATE, nunca DELETE: apaga o CONTEUDO PESSOAL (service_terms.'
    'term_text -> marcador, accepted_ip/accepted_user_agent -> NULL; shift_payments.note -> NULL) '
    'e PRESERVA a linha pseudonima (valor, datas, partes) — o BI historico sobrevive. Prazo do '
    'DADO (paid_at/accepted_at), nao da conta. Pula linhas com service_terms.retention_hold_reason. '
    'Idempotente e em lote (SKIP LOCKED). p_dry_run=true nao escreve nada. Article 8/9 intactos: '
    'nenhuma tabela de saldo/razao e lida ou escrita. ADR-20260821-expurgo-de-conteudo-nao-de-linha.';

REVOKE ALL ON FUNCTION public.purge_expired_personal_data(integer, boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_personal_data(integer, boolean) TO service_role;

-- =============================================
-- 8. AGENDAMENTO — molde de 20260817000800 (F4) e 20260817001300 (F8)
--    pg_cron interpreta o schedule em UTC. '30 3 * * *' = 03:30 UTC = 00:30 BRT — janela de menor
--    trafego. Brasil sem DST desde 2019: offset fixo, nada a manter.
--    cron.schedule(jobname, ...) faz upsert por nome (pg_cron >= 1.4) => reaplicar nao duplica.
--
--    DIFERENCA EM RELACAO A 20260817000800: naquela data pg_cron estava DISPONIVEL mas NAO
--    INSTALADO. Em 21/08/2026 a extensao esta INSTALADA e com job ativo em producao — o ramo
--    ELSE abaixo existe para CI / `supabase db reset`, nao como caminho esperado de producao.
--    Se ele disparar em producao, e incidente: a promessa de retencao deixa de ser cumprida por
--    qualquer codigo, em silencio.
-- =============================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'lgpd-retention-purge',
            '30 3 * * *',
            $cron$SELECT public.purge_expired_personal_data(500, false);$cron$
        );
    ELSE
        RAISE WARNING 'pg_cron ausente: o EXPURGO de retencao (LGPD) NAO sera executado. '
                      'O prazo de retencao prometido na Politica de Privacidade fica sem nenhum '
                      'codigo que o cumpra. Habilite a extensao e reaplique esta migration.';
    END IF;
END $$;

-- ============================================================================
-- COMO VERIFICAR (obrigatorio apos aplicar)
-- ----------------------------------------------------------------------------
-- V1. Ordem respeitada: a assercao da secao 1 nao levantou excecao (a migration aplicou).
--
-- V2. O prazo esta num lugar so:
--     SELECT public.lgpd_retention_interval();            -- => 6 years
--     -- e nenhum literal '6 years' fora dela:
--     SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--      WHERE n.nspname='public' AND pg_get_functiondef(p.oid) ILIKE '%interval ''6 years''%';
--     -- ESPERADO: exatamente 1 linha (lgpd_retention_interval).
--
-- V3. DRY-RUN ANTES DE QUALQUER COISA (o cron ja esta agendado; rode isto no mesmo dia):
--     SELECT public.purge_expired_personal_data(500, true);
--     -- ESPERADO HOJE (piloto, base nova): service_terms=0, shift_payments=0.
--     -- Numero > 0 => PARE e explique antes de deixar o cron rodar.
--
-- V4. O prazo e verificado pelo TRIGGER, nao so pela RPC — tentar expurgar registro NOVO falha
--     (rodar como service_role, DENTRO de transacao com ROLLBACK):
--     BEGIN;
--       UPDATE public.shift_payments SET note=NULL, purged_at=now()
--        WHERE id='<pagamento-recente>';
--     -- ESPERADO: EXCEPTION 'expurgo fora da forma permitida...'
--     ROLLBACK;
--
-- V5. A forma e auto-limitada — tentar carona (mudar `amount` junto) falha:
--     BEGIN;
--       UPDATE public.shift_payments SET note=NULL, purged_at=now(), amount=1
--        WHERE id='<pagamento-vencido>';
--     -- ESPERADO: EXCEPTION 'expurgo fora da forma permitida...'
--     ROLLBACK;
--
-- V6. Job agendado (PASSO DE RUNBOOK OBRIGATORIO — o MCP engole o RAISE WARNING do ELSE):
--     SELECT jobname, schedule, active FROM cron.job WHERE jobname='lgpd-retention-purge';
--     -- ESPERADO: 1 linha, schedule='30 3 * * *', active=t. Se 0 linhas: pg_cron nao estava
--     -- habilitado no momento da aplicacao; habilitar e reaplicar via CLI.
--
-- V7. Trava de litigio funciona (em linha VENCIDA de teste):
--     UPDATE public.service_terms SET retention_hold_reason='teste' WHERE id='<id>';
--     SELECT public.purge_expired_personal_data(500, true);
--     -- ESPERADO: a linha NAO conta em service_terms e conta em service_terms_held.
--
-- V8. Article 8/9: nenhuma tabela de saldo aparece no codigo desta migration:
--     SELECT pg_get_functiondef(p.oid) ILIKE ANY (ARRAY['%wallet%','%escrow%'])
--       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--      WHERE n.nspname='public' AND p.proname='purge_expired_personal_data';
--     -- ESPERADO: f
--
-- V9. Prova de conformidade gravada apos a primeira execucao efetiva:
--     SELECT * FROM public.data_retention_purge_runs ORDER BY ran_at DESC LIMIT 5;
--
-- ============================================================================
-- DOWN (rollback — copiar/colar). NAO restaura conteudo ja expurgado: e irreversivel por
-- natureza; por isso o backup do cabecalho e obrigatorio.
-- ----------------------------------------------------------------------------
--   SELECT cron.unschedule('lgpd-retention-purge');
--   DROP FUNCTION IF EXISTS public.purge_expired_personal_data(integer, boolean);
--   -- restaurar o corpo de enforce_shift_payment_immutability de 20260712000000 §4
--   -- restaurar o corpo de enforce_service_term_immutability do ddl-aprovado §2.4 (com a
--   --   emenda da anonimizacao — NAO o de 20260817001100 puro, ou a #1 quebra)
--   DROP TABLE IF EXISTS public.data_retention_purge_runs;
--   ALTER TABLE public.service_terms  DROP COLUMN IF EXISTS purged_at;
--   ALTER TABLE public.service_terms  DROP COLUMN IF EXISTS retention_hold_reason;
--   ALTER TABLE public.shift_payments DROP COLUMN IF EXISTS purged_at;
--   DROP FUNCTION IF EXISTS public.lgpd_retention_interval();  -- por ultimo: os triggers a usam
-- ============================================================================
