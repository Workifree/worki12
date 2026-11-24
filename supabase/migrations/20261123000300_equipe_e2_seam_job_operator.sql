-- Migration: Equipe e encarregados, E2 — o seam aprende "posso operar ESTE turno"
-- File: supabase/migrations/20261123000300_equipe_e2_seam_job_operator.sql
-- Spec:  .harness/spec/equipe-encarregados/spec.md (R3, R4, R18, R19, R21; A1, A2)
-- Gate:  .harness/spec/equipe-encarregados/gate-architect.md (G2, G4, G5, D4)
-- ADR:   ADR-20261123-responsavel-efetivo-derivado-no-seam (emenda ADR-20260817-seam-autorizacao-empresa)
--
-- CONTRATO DE MANUTENCAO CONJUNTA (ADR-20260817, decisao 3): is_company_owner e is_job_owner mudam
-- na MESMA migration. Esta e essa migration. is_company_owner e REEMITIDA com corpo identico (o
-- significado "Gestor desta empresa" nao muda — E0 ja fechou o ramo company_members em
-- role='manager'); o que muda e is_job_owner e o COMMENT das duas, que deixam de ser "a mesma
-- pergunta em duas granularidades".
--
-- O QUE ENTRA (UP)
-- ----------------------------------------------------------------------------
--   1. session_can_operate_job(company, responsible, data_local)  DEFINER, sobre auth.uid():
--        Gestor (is_company_owner) OU [encarregado ATIVO E CONFIRMADO da empresa E (responsible =
--        eu OU cobertura ativa de responsible para mim cobrindo a data local do turno, com
--        `from` encarregado ativo confirmado)]. Nao confirmado opera ZERO (ADR encarregado-
--        confirmado-e-pii, decisao 1; R22 le "ativo e confirmado").
--   2. is_job_owner(job)   passa a = session_can_operate_job sobre a linha do turno.
--      is_company_owner    reemitida identica (ver acima).
--   3. notification_recipients_for_job(job)  destinatarios de aviso "a empresa" (R21): responsavel
--      efetivo (operador ativo confirmado) + Gestores ativos + operadores da organizacao dona +
--      dono, deduplicado (ADR encarregado-confirmado, decisoes 2 e 3). INTERNA (sem EXECUTE para o
--      client: devolveria uuid de pessoas da empresa a qualquer autenticado).
--   4. jobs_responsible_guard + trigger: BEFORE INSERT preenche responsible_id com o criador quando
--      ele e operador da empresa; valida operador ativo SO quando o valor muda; sessao nula (cron/
--      service_role) passa; encarregado nao troca company_id/responsible_id/series_id; tag precisa
--      ser da mesma empresa e nao arquivada.
--   5. count_worker_shifts_by_week (G4): a guarda de vinculo F5 conta a COMPANY inteira (membro
--      confirmado), nao so os turnos do chamador. Sem isto ela passaria a MENTIR para o encarregado.
--      (O contrato de tarefa listava G4 em E3; o gate o poe aqui, "mesma migration do seam", porque
--      mudar is_job_owner sem mudar este chamador o quebra no mesmo instante. Seguiu-se o gate.)
--
-- NO-OP OBSERVAVEL enquanto nao existir encarregado (condicao G5): para dono/gerente/operador,
-- session_can_operate_job devolve exatamente is_company_owner(company). O trigger passa a GRAVAR
-- responsible_id em todo INSERT novo de turno (o DADO muda, a AUTORIZACAO nao). Ramo de responsavel
-- exige membership 'encarregado' ATIVA E CONFIRMADA, impossivel enquanto o CHECK so aceita 'manager' (E4 alarga).
--
-- Article 8: nada aqui toca wallets / escrow_transactions / wallet_transactions / shift_payments.
--
-- DOWN (rollback) — seguro enquanto C6 do gate mostrar ZERO encarregados. ORDEM IMPORTA
-- (is_job_owner PRIMEIRO, para soltar a dependencia registrada); E3 deve ter sido revertida antes:
--   DROP TRIGGER IF EXISTS trg_jobs_responsible_guard ON public.jobs;
--   DROP FUNCTION IF EXISTS public.jobs_responsible_guard();
--   CREATE OR REPLACE FUNCTION public.is_job_owner(p_job_id uuid)
--   RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
--   BEGIN ATOMIC
--       SELECT EXISTS (SELECT 1 FROM public.jobs j
--                       WHERE j.id = p_job_id AND public.is_company_owner(j.company_id));
--   END;                                   -- (corpo de 20260818100200)
--   -- is_company_owner: corpo identico, so o COMMENT volta a o de 20260818100200.
--   DROP FUNCTION IF EXISTS public.notification_recipients_for_job(uuid);
--   DROP FUNCTION IF EXISTS public.session_can_operate_job(uuid, uuid, date);
--   -- count_worker_shifts_by_week: replace literal inverso do bloco 6:
--   --   v_def := pg_get_functiondef('public.count_worker_shifts_by_week(uuid[], uuid, date, date)'::regprocedure);
--   --   EXECUTE replace(v_def, 'public.is_company_member_confirmed(j.company_id)', 'public.is_job_owner(a.job_id)');
--   -- responsible_id gravado pelo trigger permanece nas linhas (inofensivo; some com a coluna em E1-DOWN).

-- ============================================================================
-- 0. ASSERCOES
-- ============================================================================
DO $mig$
DECLARE
    v_def text;
BEGIN
    IF to_regclass('public.responsibility_coverages') IS NULL
       OR to_regclass('public.company_tags') IS NULL
       OR to_regprocedure('public.internal_company_active_operator(uuid, uuid)') IS NULL
       OR to_regprocedure('public.internal_company_confirmed_operator(uuid, uuid)') IS NULL
       OR to_regprocedure('public.is_company_member_confirmed(uuid)') IS NULL
       OR to_regprocedure('public.session_company_member_role(uuid)') IS NULL THEN
        RAISE EXCEPTION 'ASSERCAO E2: E0/E1 nao aplicadas (objetos ausentes). HALT.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='jobs' AND column_name='responsible_id') THEN
        RAISE EXCEPTION 'ASSERCAO E2: jobs.responsible_id ausente (E1). HALT.';
    END IF;

    -- Nenhum papel novo pode existir ainda: a premissa de no-op depende disso.
    IF EXISTS (SELECT 1 FROM public.company_members WHERE role <> 'manager') THEN
        RAISE EXCEPTION 'ASSERCAO E2: existe company_members com role <> manager. E2 precisa vir antes de E4. HALT.';
    END IF;

    -- E0 aplicada: o ramo company_members de session_operates_company_membership filtra o papel.
    v_def := pg_get_functiondef('public.session_operates_company_membership(uuid)'::regprocedure);
    IF position('cm.role = ''manager''' IN v_def) = 0 THEN
        RAISE EXCEPTION 'ASSERCAO E2: E0 nao endureceu session_operates_company_membership. HALT.';
    END IF;

    -- Corpo vigente do par precisa ser o de 20260818100200 (is_job_owner delegando).
    v_def := pg_get_functiondef('public.is_job_owner(uuid)'::regprocedure);
    IF position('is_company_owner' IN v_def) = 0 AND position('session_can_operate_job' IN v_def) = 0 THEN
        RAISE EXCEPTION 'ASSERCAO E2: is_job_owner nao tem o corpo esperado (delegar a is_company_owner). HALT.';
    END IF;
    v_def := pg_get_functiondef('public.is_company_owner(uuid)'::regprocedure);
    IF position('session_operates_company_membership' IN v_def) = 0 THEN
        RAISE EXCEPTION 'ASSERCAO E2: is_company_owner nao tem o corpo esperado (session_operates_company_membership). HALT.';
    END IF;
END
$mig$;

-- ============================================================================
-- 1. session_can_operate_job — o calculo mora AQUI, uma vez (ADR, decisao 2)
--    Chamada por is_job_owner E diretamente pelas policies de `jobs` com os valores da PROPRIA
--    linha (dentro de policy de jobs, is_job_owner(id) releria a tabela pelo snapshot do statement
--    e nao veria o NEW de um UPDATE).
--    Sempre sobre auth.uid(). Ramo Gestor primeiro: curto-circuita o caso quente (dono/gerente).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.session_can_operate_job(
    p_company_id     uuid,
    p_responsible_id uuid,
    p_job_date       date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT (SELECT auth.uid()) IS NOT NULL
       AND p_company_id IS NOT NULL
       AND (
            -- Gestor da empresa: dono, manager ativo, operador de organizacao.
            public.is_company_owner(p_company_id)
            -- Encarregado ATIVO E CONFIRMADO desta empresa (removido/revogado => role NULL => acesso
            -- cessa no proximo request; nao confirmado opera ZERO — ADR-20261123-encarregado-
            -- confirmado-e-pii, decisao 1: o seam e um so, sem excecoes parciais).
         OR (
                p_responsible_id IS NOT NULL
            AND public.session_company_member_role(p_company_id) = 'encarregado'
            AND public.session_company_member_confirmed(p_company_id)
            AND (
                    -- (a) sou o responsavel registrado do turno
                    p_responsible_id = (SELECT auth.uid())
                    -- (b) cobertura ativa DE quem e o responsavel PARA mim, cobrindo a data local
                    --     do turno. Fim automatico = a janela; sem cron. `from` PRECISA ser
                    --     encarregado ATIVO E CONFIRMADO (M1: cobertura de Gestor/dono e inerte;
                    --     pessoa removida/nao confirmada tambem).
                 OR (
                        p_job_date IS NOT NULL
                    AND EXISTS (
                            SELECT 1
                              FROM public.responsibility_coverages rc
                             WHERE rc.company_id   = p_company_id
                               AND rc.to_user_id   = (SELECT auth.uid())
                               AND rc.from_user_id = p_responsible_id
                               AND rc.revoked_at IS NULL
                               AND p_job_date BETWEEN rc.starts_on AND rc.ends_on
                               AND EXISTS (
                                       SELECT 1 FROM public.company_members cf
                                        WHERE cf.company_id   = p_company_id
                                          AND cf.user_id      = rc.from_user_id
                                          AND cf.role         = 'encarregado'
                                          AND cf.status       = 'active'
                                          AND cf.confirmed_at IS NOT NULL
                                   )
                        )
                    )
                )
            )
       );
$$;

COMMENT ON FUNCTION public.session_can_operate_job(uuid, uuid, date) IS
    'A sessao opera um turno com estes valores de linha? Gestor da empresa (is_company_owner) OU '
    'encarregado ativo E CONFIRMADO que e o responsavel OU cobre o responsavel (encarregado ativo '
    'confirmado) na data local. DEFINER, sempre '
    'sobre auth.uid(), nunca "por qual usuario perguntar". Chamada por is_job_owner e pelas '
    'policies de jobs (que precisam avaliar o NEW). Turno com responsible_id NULL ou de pessoa '
    'removida cai sozinho no ramo Gestor (responsavel efetivo = Gestor, R19). '
    'ADR-20261123-responsavel-efetivo-derivado-no-seam.';

REVOKE ALL ON FUNCTION public.session_can_operate_job(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_can_operate_job(uuid, uuid, date) TO authenticated, service_role;

-- ============================================================================
-- 2. O PAR — is_company_owner (reemitida, corpo identico) e is_job_owner (muda)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_company_owner(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
BEGIN ATOMIC
    SELECT (SELECT auth.uid()) IS NOT NULL
       AND p_company_id IS NOT NULL
       AND (
             EXISTS (
                SELECT 1 FROM public.companies c
                 WHERE c.id = p_company_id
                   AND (c.owner_id = (SELECT auth.uid()) OR c.id = (SELECT auth.uid()))
             )
          OR public.session_operates_company_membership(p_company_id)
       );
END;

COMMENT ON FUNCTION public.is_company_owner(uuid) IS
    'A sessao e GESTOR desta empresa? Quatro caminhos: (a) companies.owner_id = auth.uid(); (b) '
    'companies.id = auth.uid() (linhas legadas); ambos exigem que a linha em companies EXISTA; (c) '
    'company_members ATIVO com role = manager (E0, 20261123000100); (d) organization_members ativo '
    'owner/operator da organizacao dona da unidade. O papel ENCARREGADO NUNCA satisfaz esta funcao. '
    'PAR de is_job_owner, mas NAO sao mais equivalentes: is_job_owner(j) = "posso operar ESTE turno" '
    '(Gestor OU encarregado responsavel OU cobertura). Quem pergunta de EMPRESA usa esta (ou '
    'is_company_member / is_company_member_confirmed); quem pergunta de TURNO usa is_job_owner. As '
    'duas mudam juntas, sempre (ADR-20260817 + ADR-20261123-responsavel-efetivo-derivado-no-seam).';

CREATE OR REPLACE FUNCTION public.is_job_owner(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
BEGIN ATOMIC
    SELECT EXISTS (
        SELECT 1 FROM public.jobs j
         WHERE j.id = p_job_id
           AND public.session_can_operate_job(
                   j.company_id,
                   j.responsible_id,
                   (j.start_date AT TIME ZONE 'America/Sao_Paulo')::date
               )
    );
END;

COMMENT ON FUNCTION public.is_job_owner(uuid) IS
    'A sessao pode OPERAR este turno? = session_can_operate_job sobre a linha: Gestor da empresa do '
    'turno OU encarregado ativo que e o responsavel OU cobre o responsavel na data do turno. Desde '
    '20261123000300 NAO e substituivel por is_company_owner(jobs.company_id): qualquer leitor que '
    'assuma a equivalencia erra. Corpo BEGIN ATOMIC de proposito: registra dependencia em '
    'pg_depend (DROP de is_company_owner/session_can_operate_job falha alto, 2BP01). Tudo que '
    'chama is_job_owner herda o escopo por pessoa — onde a pergunta e de EMPRESA, trocar por '
    'is_company_owner / is_company_member (ex.: count_worker_shifts_by_week).';

-- ============================================================================
-- 3. notification_recipients_for_job — destinatarios de aviso "a empresa" (R21)
--    responsavel efetivo (operador ativo) + Gestores (manager ativo) + dono, deduplicado.
--    Operadores de ORGANIZACAO ENTRAM (R8/R21, ADR encarregado-confirmado decisao 3), escopo: so
--    owner/operator ativos da organizacao dona DAQUELA company; UNION deduplica a pessoa.
--    INTERNA: so funcoes DEFINER (triggers) a chamam — devolve uuid de pessoas da empresa.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.notification_recipients_for_job(p_job_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH j AS (
        SELECT jb.company_id, jb.responsible_id
          FROM public.jobs jb
         WHERE jb.id = p_job_id
    )
    -- dono: mesmo destinatario de antes (companies.id = owner_id nas 13 contas atuais)
    SELECT COALESCE(c.owner_id, c.id)
      FROM public.companies c
      JOIN j ON j.company_id = c.id
    UNION
    -- todos os Gestores ativos da empresa (manager)
    SELECT cm.user_id
      FROM public.company_members cm
      JOIN j ON j.company_id = cm.company_id
     WHERE cm.status = 'active'
       AND cm.role   = 'manager'
       AND cm.user_id IS NOT NULL
    UNION
    -- operadores de ORGANIZACAO desta company (R8/R21; ADR encarregado-confirmado, decisao 3):
    -- so owner/operator ativos da organizacao dona DAQUELA company, nao de toda a rede.
    SELECT om.user_id
      FROM public.organization_members om
      JOIN public.companies c2 ON c2.organization_id = om.organization_id
      JOIN j ON j.company_id = c2.id
     WHERE om.status = 'active'
       AND om.role IN ('owner', 'operator')
       AND om.user_id IS NOT NULL
    UNION
    -- responsavel efetivo: so se ainda for operador ativo E (se encarregado) confirmado
    SELECT j.responsible_id
      FROM j
     WHERE j.responsible_id IS NOT NULL
       AND public.internal_company_confirmed_operator(j.company_id, j.responsible_id);
$$;

COMMENT ON FUNCTION public.notification_recipients_for_job(uuid) IS
    'INTERNA. Quem deve ser avisado quando algo acontece com um turno "do lado da empresa": dono + '
    'Gestores ativos + operadores da organizacao dona + responsavel efetivo (se operador ativo e, '
    'sendo encarregado, confirmado), SEM duplicar (UNION). Responsavel removido: so os Gestores. '
    'Sem EXECUTE para authenticated/anon (vazaria uuid de pessoas da empresa); triggers DEFINER a '
    'chamam. '
    'R21 / A18 da spec equipe-encarregados.';

REVOKE ALL ON FUNCTION public.notification_recipients_for_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_recipients_for_job(uuid) TO service_role;

-- ============================================================================
-- 4. jobs_responsible_guard — quem escreve jobs.responsible_id (R3, G5)
--    DEFINER (le company_members/companies sem depender da RLS do invocador).
--    Sessao nula (cron, service_role, migration) e LIBERADA: o servidor e confiavel e a validacao
--    existe para o cliente. Validacao so quando o valor MUDA (turno legado/pessoa removida nao
--    quebra um UPDATE de outra coluna).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.jobs_responsible_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid          uuid := auth.uid();
    v_company      uuid;
    v_is_insert    boolean := (TG_OP = 'INSERT');
    v_resp_changed boolean;
    v_tag_changed  boolean;
    v_moved        boolean := false;
BEGIN
    IF v_uid IS NULL THEN
        RETURN NEW;
    END IF;

    -- OLD so e lido no ramo UPDATE (em INSERT o registro OLD nao existe).
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

    -- R3: o cliente NAO e a fonte da verdade do responsavel. Sem valor informado, o criador (se
    -- opera a empresa) assume. Nunca company_id = auth.uid() na mao: a pergunta e do seam.
    IF v_is_insert
       AND NEW.responsible_id IS NULL
       AND public.internal_company_confirmed_operator(NEW.company_id, v_uid) THEN
        NEW.responsible_id := v_uid;
        v_resp_changed := true;
    END IF;

    -- Encarregado: opera o turno, mas nao reatribui nem move turno entre empresas/series.
    IF public.session_company_member_role(v_company) = 'encarregado'
       AND NOT public.is_company_owner(v_company) THEN
        IF NOT v_is_insert AND (v_moved OR v_resp_changed) THEN
            RAISE EXCEPTION 'jobs: encarregado não altera company_id, responsible_id nem series_id (use "Passar para...").'
                USING ERRCODE = '42501';
        END IF;
        IF v_is_insert AND NEW.series_id IS NOT NULL THEN
            RAISE EXCEPTION 'jobs: série recorrente é do Gestor (v1).'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Validacao de operador ativo, SO quando o valor muda.
    IF NEW.responsible_id IS NOT NULL AND v_resp_changed THEN
        IF NOT public.internal_company_confirmed_operator(NEW.company_id, NEW.responsible_id) THEN
            RAISE EXCEPTION 'jobs: responsible_id precisa ser operador ativo e confirmado da empresa.'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Tag: mesma empresa e nao arquivada (so quando o valor muda).
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
$$;

COMMENT ON FUNCTION public.jobs_responsible_guard() IS
    'BEFORE INSERT / UPDATE OF (company_id, responsible_id, series_id, tag_id) em jobs. Preenche '
    'responsible_id com o criador quando ele opera a empresa; valida operador ativo so quando o '
    'valor muda; encarregado nao reatribui; tag da mesma empresa e nao arquivada. Sessao nula '
    '(cron/service_role) passa. Nao toca saldo (Article 8). R3 / G5 de equipe-encarregados.';

REVOKE ALL ON FUNCTION public.jobs_responsible_guard() FROM PUBLIC, anon;
-- Funcao de trigger: mantem EXECUTE para authenticated (licao de 20260816201420/201457).
GRANT EXECUTE ON FUNCTION public.jobs_responsible_guard() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_jobs_responsible_guard ON public.jobs;
CREATE TRIGGER trg_jobs_responsible_guard
    BEFORE INSERT OR UPDATE OF company_id, responsible_id, series_id, tag_id ON public.jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.jobs_responsible_guard();

-- ============================================================================
-- 5. count_worker_shifts_by_week (G4) — conta a COMPANY inteira
--    Era `AND public.is_job_owner(a.job_id)` por linha. Com is_job_owner escopado por pessoa, o
--    encarregado so contaria os PROPRIOS turnos e a guarda de vinculo (risco da EMPRESA, nao do
--    responsavel) passaria a mentir. Passa a `is_company_member_confirmed(j.company_id)`:
--    membro confirmado enxerga so a CONTAGEM por freela/semana, sem detalhe de turno. Para
--    Gestor e identico ao anterior (is_company_owner da empresa do turno). Autorizacao do turno
--    ancora (is_job_owner(p_anchor_job_id)) NAO muda: voce so planeja um turno que opera.
-- ============================================================================
DO $mig$
DECLARE
    v_def    text;
    v_pat    text := 'public[.]is_job_owner[(]a[.]job_id[)]';
    v_anchor text := 'IF (p_anchor_job_id IS NOT NULL) = (p_range_start IS NOT NULL OR p_range_end IS NOT NULL) THEN';
    v_n      integer;
    v_novo   text;
BEGIN
    v_def  := pg_get_functiondef('public.count_worker_shifts_by_week(uuid[], uuid, date, date)'::regprocedure);
    v_novo := v_def;

    -- (1) contagem da company inteira
    IF position('is_company_member_confirmed(j.company_id)' IN v_novo) = 0 THEN
        SELECT count(*) INTO v_n FROM regexp_matches(v_novo, v_pat, 'g');
        IF v_n <> 1 THEN
            RAISE EXCEPTION
              'ASSERCAO E2(G4): % ocorrencia(s) de is_job_owner(a.job_id) em count_worker_shifts_by_week (esperado 1). Funcao mudou -- HALT.', v_n;
        END IF;
        v_novo := replace(v_novo, 'public.is_job_owner(a.job_id)', 'public.is_company_member_confirmed(j.company_id)');
    END IF;

    -- (2) R7a: quem opera a company mas NAO esta confirmado recebe ERRO `not_confirmed`, NUNCA zero.
    --     (Zero silencioso = falso "sem risco".) A funcao e RETURNS TABLE: o contrato
    --     `{outcome:'not_confirmed'}` pede jsonb, o que muda o TIPO DE RETORNO (DROP + CREATE +
    --     cliente) — fica para E5 junto com o frontend; aqui o sinal e SQLSTATE 42501 + mensagem
    --     'not_confirmed' + DETAIL 'outcome=not_confirmed', que o linkRiskService ja trata como
    --     "sem aviso + log" (regra F5: nunca quebra a feature). So dispara quando a sessao opera
    --     alguma company (get_my_companies) e NENHUMA como membro confirmado; conta sem company
    --     segue como antes.
    IF position('not_confirmed' IN v_novo) = 0 THEN
        v_n := (length(v_novo) - length(replace(v_novo, v_anchor, ''))) / length(v_anchor);
        IF v_n <> 1 THEN
            RAISE EXCEPTION
              'ASSERCAO E2(R7a): % ocorrencia(s) da guarda de modo em count_worker_shifts_by_week (esperado 1). Funcao mudou -- HALT.', v_n;
        END IF;
        v_novo := replace(v_novo, v_anchor,
            'IF EXISTS (SELECT 1 FROM public.get_my_companies())' || chr(10) ||
            '       AND NOT EXISTS (SELECT 1 FROM public.get_my_companies() AS gc' || chr(10) ||
            '                        WHERE public.is_company_member_confirmed(gc.company_id)) THEN' || chr(10) ||
            '        RAISE EXCEPTION ''not_confirmed'' USING ERRCODE = ''42501'', DETAIL = ''outcome=not_confirmed'';' || chr(10) ||
            '    END IF;' || chr(10) || chr(10) ||
            '    ' || v_anchor);
    END IF;

    IF position('is_company_member_confirmed(j.company_id)' IN v_novo) = 0
       OR position('not_confirmed' IN v_novo) = 0 THEN
        RAISE EXCEPTION 'ASSERCAO E2: a reescrita de count_worker_shifts_by_week nao produziu o esperado. HALT.';
    END IF;

    IF v_novo IS DISTINCT FROM v_def THEN
        EXECUTE v_novo;
    END IF;
END
$mig$;

COMMENT ON FUNCTION public.count_worker_shifts_by_week(uuid[], uuid, date, date) IS
    'Guarda de vínculo (F5): quantos turnos DESTA empresa cada freela já tem confirmados '
    '(hired/in_progress/completed, turno não-deletado) por semana corrida dom-sáb em data local '
    'America/Sao_Paulo. Modo âncora = a semana do turno-alvo (exclui o próprio turno); modo intervalo = '
    'a série inteira (F3). SOMENTE LEITURA. Autorização do turno-âncora por is_job_owner (você só '
    'planeja turno que opera); a CONTAGEM é da COMPANY inteira para Gestor e encarregado confirmado '
    '(is_company_member_confirmed, G4 de equipe-encarregados): o risco de vínculo é da empresa, '
    'nunca do responsável. Sem detalhe de turno. Membro NÃO confirmado: erro not_confirmed (R7a), '
    'nunca zero. NUNCA estender para outras empresas (R9 + '
    'privacidade).';

-- ============================================================================
-- VERIFICACAO (read-only, ROLLBACK) — A1: ANTES x DEPOIS tem de ser IDENTICO
-- ----------------------------------------------------------------------------
--   BEGIN; SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<uid>","role":"authenticated"}';
--   SELECT c.id, public.is_company_owner(c.id) FROM public.companies c ORDER BY 1;
--   SELECT j.id, public.is_job_owner(j.id)     FROM public.jobs j WHERE j.status <> 'deleted' ORDER BY 1;
--   SELECT * FROM public.get_my_companies();
--   ROLLBACK;
-- Para: cada dono real, o gerente de QA, uma conta de freela (tudo false) e uma conta de empresa
-- sem vinculo (tudo false). Para o dono real, is_job_owner(turno) = is_company_owner(company do turno)
-- em TODAS as linhas: SELECT bool_and(public.is_job_owner(j.id) = public.is_company_owner(j.company_id))
-- FROM public.jobs j;  -- tem de ser true (ou NULL com zero jobs). Script completo em
-- supabase/tests/equipe_e0_e3_auditoria.sql.
-- ============================================================================
