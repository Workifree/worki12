-- Migration: Trilha de bonus do operador, S4 — RPCs de admin (so service_role, via edge admin-data)
-- File: supabase/migrations/20261124000400_trilha_bonus_s4_admin.sql
-- Spec:  .harness/spec/trilha-bonus-operador/spec.md (R1, R2, R4, AF1, AF6, R26-R30)
-- ADR:   .harness/memory-bank/decisions/ADR-20261124-trilha-bonus-operador.md (C2, C5, C8, C9)
--
-- AUTENTICACAO: o admin e a edge function `admin-data` (auth propria: e-mail em ADMIN_EMAILS), que
-- chama estas RPCs com service_role. TODAS sao DEFINER, search_path vazio, REVOKE de
-- PUBLIC/anon/authenticated e GRANT so a service_role. O service_role continua SEM INSERT/UPDATE/DELETE
-- nas tabelas: toda escrita passa por aqui. O ator e o uuid do admin (nao ha auth.uid() em
-- service_role): obrigatorio em toda mutacao e gravado em bonus_admin_log (quem, quando, antes/depois).
-- Parametros de ator sao rastro, nao autorizacao.
--
-- CONTRATO COM supabase/functions/admin-data/bonus.ts (nomes e assinaturas):
--   admin_bonus_decide_shift(p_ledger_id uuid, p_decision text, p_decided_by uuid, p_note text)
--       p_decision 'approve' -> review='approved' | 'not_count' -> review='excluded'
--   admin_bonus_mark_payout_paid(p_payout_id uuid, p_paid_by uuid, p_note text)   -- NUNCA move dinheiro
--   admin_bonus_veto_add(p_person_id uuid, p_reason text, p_created_by uuid)
--   admin_bonus_veto_remove(p_person_id uuid, p_removed_by uuid)
--   admin_bonus_track_params_update(p_track_key text, p_params jsonb, p_updated_by uuid)  -- merge
--   admin_bonus_habit_overview()  -> operator_name, baseline_weekly_avg, avg_weeks_1_12, avg_weeks_13_16
-- Complementos (inscricao, trilha, interruptor, atualizacao da avaliacao antes de ler):
--   admin_bonus_refresh(), admin_bonus_enrollment_create(...), admin_bonus_enrollment_ack(...),
--   admin_bonus_enrollment_cancel(...), admin_bonus_track_status_update(...),
--   admin_bonus_set_enabled(...)
--   Erros de decisao/pagamento/parametro sao EXCEPTION (a edge ignora o retorno: recusa silenciosa
--   viraria "ok" falso). Repeticao identica e idempotente e devolve jsonb.
--
-- ADMIN_BONUS_REFRESH: C4 exige avaliar antes de gerar a fila/lista. A edge le tabelas direto; ela
--   deve chamar admin_bonus_refresh() antes de 'bonus_review_queue' e 'bonus_payouts'.
--
-- LIGACAO award -> turno: bonus_awards.evidence->'ledger_ids' (array de uuid em texto).
--   "em conferencia" (in_review) NAO e coluna: e state='earned' com algum ledger_id em review='open'.
--   Um award pode citar varios turnos: o "valor em jogo" por turno repete o award entre linhas da fila
--   se houver 2 turnos abertos na mesma evidencia (para o total, deduplicar por award id).
--
-- C5 (Nao contar): reavalia ANTES de cancelar. Se outro turno sustenta o marco, a evidencia e
--   reescrita e o award fica; senao vira not_counted. Award em pedido aberto sai dele na mesma
--   transacao (valor recalculado; pedido zerado e cancelado). Award pago nao muda. Os turnos que
--   tinham ficado fora por teto NAO sao recalculados (o livro e gravado uma vez, C3).
--
-- METRICA (R30, C8): derivada do historico; sem tabela de habito. "Turno do operador" = turno da
--   empresa com atribuicao da inscricao OU responsible_id = operador. Sem historico antes do inicio,
--   baseline = NULL ("sem baseline"; ADR: nada retroage). Rotular sempre como hipotese.
--
-- RODADA 2
--   M1  um pedido so e pagavel depois do corte (now() >= bonus_payout_cut(scheduled_for)): antes disso
--       o operador ainda pode cancelar e repedir, e pagar daria PIX em dobro.
--   M2/A2 mark_paid revalida identidade/PIX. Se algo mudou, DEVOLVE {outcome:'blocked_review' |
--       'not_payable_yet', message} (sem EXCEPTION, para as marcas persistirem); quem chama TEM de
--       olhar o outcome (admin-data/bonus.ts olha).
--   M3  anonymize_account passa a chamar bonus_anonymize_person (edicao real do corpo do catalogo,
--       ancora de E1). Pedido ABERTO do operador anonimizado e CANCELADO (sem chave nao ha como pagar)
--       e os awards voltam a earned; pago/cancelado tem chave e nota apagadas; inscricao cancelada;
--       rastro do admin com detalhe apagado. Se quem sai e a EMPRESA (e nao o operador), so some o
--       que identifica o patrao (ciencia): o bonus do operador, terceiro, nao e tocado.
--       Ligar o programa exige a SONDA bonus_lgpd_probe(), que EXECUTA anonymize_account sobre um
--       titular sintetico e desfaz tudo (comentario no corpo nao passa).
--
-- FINAL DE SEGURANCA
--   M-A  cancelar inscricao MATERIALIZA antes (livro e marcos ja conquistados), sob a trava e mesmo
--        com o programa desligado; se algo falhar, NAO cancela ({outcome:'evaluation_failed'}).
--        CASO ACEITO E DOCUMENTADO: operador REMOVIDO da empresa antes de qualquer leitura nao
--        acumula (#13: o livro grava operator_not_member). Procedimento: rodar admin_bonus_refresh()
--        (ou abrir a fila do admin) ANTES de remover um operador inscrito. A tela de remocao e a E4
--        (nao editadas aqui).
--   L-B  admin_bonus_refresh devolve failed[{enrollment_id, error}] e marca essas inscricoes com
--        payout_block_reason='evaluation_failed'; mark_paid recusa enquanto a avaliacao falhar.
--   M-B  admin_bonus_alerts() expoe alert_payability e alert_voided_late com o bloqueio atual.
--
-- Article 8: marcar PIX como pago e registro de um PIX feito por fora. Nenhum movimento de saldo.
--
-- DOWN (rollback):
--   DROP FUNCTION IF EXISTS public.admin_bonus_refresh(), public.admin_bonus_enrollment_create(text, uuid, uuid, text, uuid),
--       public.admin_bonus_enrollment_ack(uuid, text, text, uuid), public.admin_bonus_enrollment_cancel(uuid, uuid),
--       public.admin_bonus_decide_shift(uuid, text, uuid, text), public.admin_bonus_mark_payout_paid(uuid, uuid, text),
--       public.admin_bonus_veto_add(uuid, text, uuid), public.admin_bonus_veto_remove(uuid, uuid),
--       public.admin_bonus_track_params_update(text, jsonb, uuid),
--       public.admin_bonus_track_status_update(text, text, uuid), public.admin_bonus_set_enabled(boolean, uuid),
--       public.admin_bonus_habit_overview();
--   -- anonymize_account: retirar a linha "PERFORM public.bonus_anonymize_person(...)" (mesma tecnica de
--   -- pg_get_functiondef + replace) e depois:
--   DROP FUNCTION IF EXISTS public.bonus_lgpd_probe(), public.bonus_anonymize_person(uuid, uuid[]),
--       public.admin_bonus_alerts(integer);
--
-- SIMULACAO CONTRA PRODUCAO (E0/E1 aplicadas; E2-E5 ausentes): gate exige S1..S3 (ordem acusada).
--   Aplicar S4 nao liga nada. Tentar admin_bonus_set_enabled(true, ...) hoje devolve
--   {outcome:'dependencies_missing'} listando E2, E3, E4 e E5. A edicao de anonymize_account usa a
--   ancora que E1 (aplicada) inseriu; a sonda LGPD roda nesta migration e desfaz o que criou.

-- ============================================================================
-- 0. PORTAO
-- ============================================================================
DO $mig$
BEGIN
    IF to_regclass('public.bonus_admin_log') IS NULL THEN
        RAISE EXCEPTION 'ASSERCAO S4: S1 (20261124000100) nao aplicada. Ordem: S1 -> S2 -> S3 -> S4. Nada foi criado. HALT.';
    END IF;
    IF to_regprocedure('public.bonus_compute_support(uuid)') IS NULL
       OR to_regprocedure('public.bonus_evaluate_enrollment(uuid)') IS NULL THEN
        RAISE EXCEPTION 'ASSERCAO S4: S2 (20261124000200) nao aplicada. Ordem: S1 -> S2 -> S3 -> S4. Nada foi criado. HALT.';
    END IF;
    IF to_regprocedure('public.bonus_request_payout()') IS NULL
       OR to_regprocedure('public.bonus_award_phase(text, timestamptz, jsonb)') IS NULL THEN
        RAISE EXCEPTION 'ASSERCAO S4: S3 (20261124000300) nao aplicada. Ordem: S1 -> S2 -> S3 -> S4. Nada foi criado. HALT.';
    END IF;
END
$mig$;

-- ============================================================================
-- 1. Atualiza a avaliacao antes de o admin ler fila/lista (C4)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_bonus_refresh()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    r        record;
    v_n      integer := 0;
    v_res    jsonb;
    v_error  text;
    v_failed jsonb := '[]'::jsonb;
    v_old    text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.bonus_program_settings s WHERE s.enabled) THEN
        RETURN jsonb_build_object('outcome', 'program_disabled', 'evaluated', 0);
    END IF;
    -- inclui inscricao cancelada com pedido aberto: o pedido ainda e revalidado e sai da lista se zerar
    FOR r IN SELECT e.id FROM public.bonus_enrollments e
              WHERE e.status IN ('active', 'ended')
                 OR EXISTS (SELECT 1 FROM public.bonus_payouts p WHERE p.enrollment_id = e.id AND p.status = 'requested')
              ORDER BY e.id
    LOOP
        v_error := NULL;
        BEGIN
            PERFORM 1 FROM public.bonus_enrollments x WHERE x.id = r.id FOR NO KEY UPDATE;
            v_res := public.bonus_evaluate_enrollment(r.id);       -- no-op ('not_active') se cancelada
            PERFORM public.bonus_recheck_payability(r.id);
            IF COALESCE((v_res->>'failed_rows')::integer, 0) > 0 THEN
                v_error := (v_res->>'failed_rows') || ' turno(s) nao puderam ser avaliados';
            END IF;
            v_n := v_n + 1;
        EXCEPTION WHEN OTHERS THEN
            v_error := SQLSTATE || ' ' || SQLERRM;
            RAISE WARNING 'public.admin_bonus_refresh: inscricao % falhou: %', r.id, v_error;
        END;
        IF v_error IS NOT NULL THEN
            -- nao pagavel ate uma avaliacao completa dar certo (a lista mostra o bloqueio)
            v_failed := v_failed || jsonb_build_array(jsonb_build_object('enrollment_id', r.id, 'error', v_error));
            SELECT x.payout_block_reason INTO v_old FROM public.bonus_enrollments x WHERE x.id = r.id FOR NO KEY UPDATE;
            IF v_old IS DISTINCT FROM 'evaluation_failed' THEN
                UPDATE public.bonus_enrollments SET payout_block_reason = 'evaluation_failed' WHERE id = r.id;
                INSERT INTO public.bonus_admin_log (actor, action, target_id, detail)
                VALUES ('00000000-0000-0000-0000-000000000000', 'alert_payability', r.id,
                        jsonb_build_object('before', v_old, 'after', 'evaluation_failed', 'error', left(v_error, 300)));
            END IF;
        END IF;
    END LOOP;
    RETURN jsonb_build_object('outcome', 'ok', 'evaluated', v_n, 'failed', v_failed);
END;
$fn$;

-- ============================================================================
-- 2. Inscricoes (R1, R2, R4, C2)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_bonus_enrollment_create(
    p_track_key text, p_operator_user_id uuid, p_company_id uuid, p_display_name text, p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    tr   record;
    v_id uuid;
BEGIN
    IF p_created_by IS NULL THEN
        RAISE EXCEPTION 'actor_required' USING ERRCODE = '22004';
    END IF;
    IF p_operator_user_id IS NULL OR p_company_id IS NULL
       OR p_display_name IS NULL OR length(btrim(p_display_name)) NOT BETWEEN 1 AND 80 THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    SELECT * INTO tr FROM public.bonus_tracks WHERE key = p_track_key FOR SHARE;
    IF NOT FOUND OR tr.status <> 'open' THEN
        RETURN jsonb_build_object('outcome', 'track_not_open');
    END IF;
    -- C2: dono unico / concierge / socio do Worki sao recusados ja na inscricao
    IF NOT public.bonus_identity_ok(p_company_id, p_operator_user_id) THEN
        RETURN jsonb_build_object('outcome', 'identity_required');
    END IF;
    IF EXISTS (SELECT 1 FROM public.bonus_enrollments e WHERE e.operator_user_id = p_operator_user_id) THEN
        RETURN jsonb_build_object('outcome', 'already_enrolled');
    END IF;
    INSERT INTO public.bonus_enrollments (track_id, operator_user_id, company_id, display_name, cap_cents, created_by)
    VALUES (tr.id, p_operator_user_id, p_company_id, btrim(p_display_name), tr.cap_cents, p_created_by)
    RETURNING id INTO v_id;
    INSERT INTO public.bonus_admin_log (actor, action, target_id, detail)
    VALUES (p_created_by, 'enrollment_create', v_id,
            jsonb_build_object('before', NULL, 'after', jsonb_build_object(
                'track', p_track_key, 'operator_user_id', p_operator_user_id, 'company_id', p_company_id)));
    RETURN jsonb_build_object('outcome', 'ok', 'enrollment_id', v_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_bonus_enrollment_ack(
    p_enrollment_id uuid, p_ack_by_label text, p_ack_note text, p_actor uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    e record;
BEGIN
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'actor_required' USING ERRCODE = '22004';
    END IF;
    IF length(btrim(COALESCE(p_ack_by_label, ''))) = 0 OR length(btrim(COALESCE(p_ack_note, ''))) = 0 THEN
        RETURN jsonb_build_object('outcome', 'invalid');        -- nome de quem deu ciencia + como foi obtida
    END IF;
    SELECT * INTO e FROM public.bonus_enrollments WHERE id = p_enrollment_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF e.status <> 'invited' THEN
        RETURN jsonb_build_object('outcome', 'not_invited');
    END IF;
    UPDATE public.bonus_enrollments
       SET company_ack_at = now(), company_ack_by_label = left(btrim(p_ack_by_label), 120),
           company_ack_note = left(btrim(p_ack_note), 500)
     WHERE id = e.id;
    INSERT INTO public.bonus_admin_log (actor, action, target_id, detail)
    VALUES (p_actor, 'enrollment_ack', e.id, jsonb_build_object(
        'before', jsonb_build_object('company_ack_at', e.company_ack_at),
        'after', jsonb_build_object('by', btrim(p_ack_by_label), 'note', btrim(p_ack_note))));
    RETURN jsonb_build_object('outcome', 'ok');
END;
$fn$;

-- Cancelar nao tira nada conquistado (sem clawback): so encerra a captura e a avaliacao.
CREATE OR REPLACE FUNCTION public.admin_bonus_enrollment_cancel(p_enrollment_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    e     record;
    v_res jsonb;
BEGIN
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'actor_required' USING ERRCODE = '22004';
    END IF;
    SELECT * INTO e FROM public.bonus_enrollments WHERE id = p_enrollment_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    -- M-A: antes de encerrar, grava o que ja foi conquistado (sob a mesma trava; vale mesmo com o
    -- programa desligado). Falha parcial = nao cancela: depois de cancelada nada mais materializa.
    IF e.status = 'active' THEN
        v_res := public.bonus_materialize_enrollment(e.id);
        IF COALESCE((v_res->>'failed_rows')::integer, 0) > 0 THEN
            RETURN jsonb_build_object('outcome', 'evaluation_failed',
                'message', 'Não cancelei: há turnos que não puderam ser avaliados. Rode a atualização e tente de novo.');
        END IF;
        SELECT * INTO e FROM public.bonus_enrollments WHERE id = p_enrollment_id;   -- pode ter virado ended
    END IF;
    IF e.status = 'cancelled' THEN
        RETURN jsonb_build_object('outcome', 'already_cancelled');
    END IF;
    IF e.status = 'ended' THEN
        RETURN jsonb_build_object('outcome', 'already_ended');  -- encerrada ainda pede o saque final
    END IF;
    UPDATE public.bonus_enrollments SET status = 'cancelled' WHERE id = e.id;
    INSERT INTO public.bonus_admin_log (actor, action, target_id, detail)
    VALUES (p_actor, 'enrollment_cancel', e.id,
            jsonb_build_object('before', jsonb_build_object('status', e.status),
                               'after', jsonb_build_object('status', 'cancelled')));
    RETURN jsonb_build_object('outcome', 'ok');
END;
$fn$;

-- ============================================================================
-- 3. Fila de conferencia: decisao de 1 clique (AF6, C5)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_bonus_decide_shift(
    p_ledger_id uuid, p_decision text, p_decided_by uuid, p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_enr     uuid;
    l         record;
    a         record;
    v_target  text;
    v_support jsonb;
    v_new     jsonb;
    v_kept    integer := 0;
    v_removed integer := 0;
    v_before  jsonb;
BEGIN
    IF p_decided_by IS NULL THEN
        RAISE EXCEPTION 'actor_required' USING ERRCODE = '22004';
    END IF;
    IF p_decision IS NULL OR p_decision NOT IN ('approve', 'not_count') THEN
        RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
    END IF;
    v_target := CASE p_decision WHEN 'approve' THEN 'approved' ELSE 'excluded' END;

    SELECT x.enrollment_id INTO v_enr FROM public.bonus_shift_ledger x WHERE x.id = p_ledger_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    -- mesma trava do pedido de saque e da avaliacao: sem corrida
    PERFORM 1 FROM public.bonus_enrollments e WHERE e.id = v_enr FOR NO KEY UPDATE;
    SELECT * INTO l FROM public.bonus_shift_ledger x WHERE x.id = p_ledger_id FOR UPDATE;

    IF l.review = v_target THEN
        RETURN jsonb_build_object('outcome', 'already_decided');
    END IF;
    IF l.review <> 'open' THEN
        RAISE EXCEPTION 'not_open' USING ERRCODE = '55000';
    END IF;
    v_before := jsonb_build_object('review', l.review, 'counted', l.counted, 'flags', to_jsonb(l.flags));

    UPDATE public.bonus_shift_ledger x
       SET approved_exclusion = CASE WHEN v_target = 'approved'
                                     THEN public.bonus_worker_exclusion(v_enr, x.worker_id) END,
           review           = v_target,
           counted          = CASE WHEN v_target = 'excluded' THEN false ELSE x.counted END,
           exclusion_reason = CASE WHEN v_target = 'excluded' THEN 'owner_excluded' ELSE x.exclusion_reason END,
           decided_by       = p_decided_by,
           decided_at       = now(),
           decision_note    = left(p_note, 500)
     WHERE x.id = p_ledger_id;

    IF v_target = 'excluded' THEN
        -- C5: reavalia (ja sem este turno) ANTES de cancelar qualquer marco
        SELECT COALESCE(jsonb_object_agg(s.o_milestone_id::text || ':' || s.o_tier::text, s.o_evidence), '{}'::jsonb)
          INTO v_support
          FROM public.bonus_compute_support(v_enr) s;

        FOR a IN
            SELECT * FROM public.bonus_awards w
             WHERE w.enrollment_id = v_enr
               AND w.state IN ('earned', 'in_payout')       -- pago nao muda (sem clawback)
               AND w.evidence->'ledger_ids' @> jsonb_build_array(p_ledger_id::text)
             ORDER BY w.id
             FOR UPDATE
        LOOP
            v_new := v_support -> (a.milestone_id::text || ':' || a.tier::text);
            IF v_new IS NOT NULL
               AND NOT (a.state = 'in_payout' AND public.bonus_award_review_due(v_new) IS NOT NULL) THEN
                UPDATE public.bonus_awards SET evidence = v_new WHERE id = a.id;
                v_kept := v_kept + 1;
                CONTINUE;
            END IF;
            -- sai do pedido aberto na MESMA transacao
            IF a.state = 'in_payout' THEN
                UPDATE public.bonus_payouts p
                   SET amount_cents = p.amount_cents - a.amount_cents,
                       status = CASE WHEN p.amount_cents - a.amount_cents <= 0 THEN 'cancelled' ELSE p.status END
                 WHERE p.id = a.payout_id AND p.status = 'requested';
            END IF;
            IF v_new IS NOT NULL THEN
                -- sustentado, mas por turno ainda em conferencia: volta a earned (fora do pedido)
                UPDATE public.bonus_awards SET state = 'earned', payout_id = NULL, evidence = v_new WHERE id = a.id;
                v_kept := v_kept + 1;
            ELSE
                UPDATE public.bonus_awards SET state = 'not_counted', payout_id = NULL WHERE id = a.id;
                v_removed := v_removed + 1;
            END IF;
        END LOOP;
    END IF;

    INSERT INTO public.bonus_admin_log (actor, action, target_id, detail)
    VALUES (p_decided_by, 'decide_shift', p_ledger_id, jsonb_build_object(
        'before', v_before,
        'after', jsonb_build_object('review', v_target, 'note', left(p_note, 500),
                                    'awards_kept', v_kept, 'awards_not_counted', v_removed)));

    RETURN jsonb_build_object('outcome', 'ok', 'awards_kept', v_kept, 'awards_not_counted', v_removed);
END;
$fn$;

-- ============================================================================
-- 4. Registro do PIX feito por fora (R26). Atomico e idempotente. NAO move dinheiro.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_bonus_mark_payout_paid(p_payout_id uuid, p_paid_by uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_enr    uuid;
    p        record;
    q        record;
    v_block  text;
    v_rows   integer;
    v_sum    bigint;
    v_res    jsonb;
    v_bad    boolean := false;
BEGIN
    IF p_paid_by IS NULL THEN
        RAISE EXCEPTION 'actor_required' USING ERRCODE = '22004';
    END IF;
    SELECT x.enrollment_id INTO v_enr FROM public.bonus_payouts x WHERE x.id = p_payout_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    PERFORM 1 FROM public.bonus_enrollments e WHERE e.id = v_enr FOR NO KEY UPDATE;
    SELECT * INTO p FROM public.bonus_payouts x WHERE x.id = p_payout_id FOR UPDATE;
    IF p.status = 'paid' THEN
        RETURN jsonb_build_object('outcome', 'already_paid');
    END IF;
    IF p.status <> 'requested' THEN
        RAISE EXCEPTION 'not_requested' USING ERRCODE = '55000';
    END IF;
    -- M1: antes do corte o operador ainda cancela e repede
    IF now() < public.bonus_payout_cut(p.scheduled_for) THEN
        RETURN jsonb_build_object(
            'outcome', 'not_payable_yet',
            'payable_after', public.bonus_payout_cut(p.scheduled_for),
            'message', 'Este pedido só pode ser pago depois do corte de '
                       || to_char(p.scheduled_for - 3, 'DD/MM') || ' às 23:59. Não faça o PIX antes disso.');
    END IF;

    -- L-B: sem avaliacao completa nao ha pagamento
    BEGIN
        v_res := public.bonus_evaluate_enrollment(v_enr);
        v_bad := COALESCE((v_res->>'failed_rows')::integer, 0) > 0;
    EXCEPTION WHEN OTHERS THEN
        v_bad := true;
        RAISE WARNING 'public.admin_bonus_mark_payout_paid: avaliacao falhou: % %', SQLSTATE, SQLERRM;
    END;
    IF v_bad THEN
        RETURN jsonb_build_object('outcome', 'blocked_review', 'reason', 'evaluation_failed',
            'amount_cents', p.amount_cents,
            'message', 'NÃO PAGUE: a avaliação desta inscrição está falhando. Atualize a lista e verifique o erro.');
    END IF;

    v_block := public.bonus_recheck_payability(v_enr);
    SELECT * INTO q FROM public.bonus_payouts x WHERE x.id = p_payout_id;
    IF v_block IS NOT NULL OR q.status <> 'requested' OR q.amount_cents <> p.amount_cents
       OR EXISTS (SELECT 1 FROM public.bonus_awards a
                   WHERE a.payout_id = p_payout_id AND public.bonus_award_review_due(a.evidence) IS NOT NULL) THEN
        RETURN jsonb_build_object(
            'outcome', 'blocked_review',
            'reason', COALESCE(v_block, 'review'),
            'amount_cents', CASE WHEN q.status = 'requested' THEN q.amount_cents ELSE 0 END,
            'message', CASE
                WHEN v_block = 'identity' THEN 'NÃO PAGUE: o operador não passa mais na verificação de identidade (removido, vetado ou dono).'
                WHEN v_block = 'pix_match' THEN 'NÃO PAGUE: a chave PIX coincide com a de um freela da trilha ou de pessoa vetada.'
                ELSE 'NÃO PAGUE o valor antigo: há turno em conferência e o pedido mudou. Atualize a lista e confira a fila.' END);
    END IF;

    UPDATE public.bonus_payouts
       SET status = 'paid', paid_at = now(), paid_by = p_paid_by, paid_note = left(p_note, 500)
     WHERE id = p_payout_id AND status = 'requested';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'not_requested' USING ERRCODE = '55000';
    END IF;

    UPDATE public.bonus_awards SET state = 'paid' WHERE payout_id = p_payout_id AND state = 'in_payout';

    SELECT COALESCE(sum(a.amount_cents), 0) INTO v_sum
      FROM public.bonus_awards a WHERE a.payout_id = p_payout_id AND a.state = 'paid';
    IF v_sum <> q.amount_cents THEN
        RAISE EXCEPTION 'amount_mismatch' USING ERRCODE = '55000';   -- desfaz tudo
    END IF;

    INSERT INTO public.bonus_admin_log (actor, action, target_id, detail)
    VALUES (p_paid_by, 'mark_payout_paid', p_payout_id, jsonb_build_object(
        'before', jsonb_build_object('status', 'requested'),
        'after', jsonb_build_object('status', 'paid', 'amount_cents', q.amount_cents, 'note', left(p_note, 500))));

    RETURN jsonb_build_object('outcome', 'ok', 'amount_cents', q.amount_cents);
END;
$fn$;

-- ============================================================================
-- 5. Vetos (AF1, C2). Remocao COM REGISTRO (DELETE so aqui; service_role nao tem DELETE).
--    Vale daqui para a frente: o livro ja gravado nao e refeito (C3).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_bonus_veto_add(p_person_id uuid, p_reason text, p_created_by uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_rows integer;
BEGIN
    IF p_created_by IS NULL THEN
        RAISE EXCEPTION 'actor_required' USING ERRCODE = '22004';
    END IF;
    IF p_person_id IS NULL OR length(btrim(COALESCE(p_reason, ''))) = 0 THEN
        RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.bonus_vetos (person_id, reason, created_by)
    VALUES (p_person_id, left(btrim(p_reason), 200), p_created_by)
    ON CONFLICT (person_id) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RETURN jsonb_build_object('outcome', 'already_vetoed');
    END IF;
    INSERT INTO public.bonus_admin_log (actor, action, target_id, detail)
    VALUES (p_created_by, 'veto_add', p_person_id,
            jsonb_build_object('before', NULL, 'after', jsonb_build_object('reason', left(btrim(p_reason), 200))));
    RETURN jsonb_build_object('outcome', 'ok');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_bonus_veto_remove(p_person_id uuid, p_removed_by uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_old jsonb;
BEGIN
    IF p_removed_by IS NULL THEN
        RAISE EXCEPTION 'actor_required' USING ERRCODE = '22004';
    END IF;
    SELECT to_jsonb(v) INTO v_old FROM public.bonus_vetos v WHERE v.person_id = p_person_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_vetoed');
    END IF;
    DELETE FROM public.bonus_vetos WHERE person_id = p_person_id;
    INSERT INTO public.bonus_admin_log (actor, action, target_id, detail)
    VALUES (p_removed_by, 'veto_remove', p_person_id, jsonb_build_object('before', v_old, 'after', NULL));
    RETURN jsonb_build_object('outcome', 'ok');
END;
$fn$;

-- ============================================================================
-- 6. Parametros e status de trilha (R6, R27). So valem para inscricoes futuras (snapshot).
--    Limites de VALIDACAO (nao sao limiares de negocio); espelham PARAM_BOUNDS de admin-data/bonus.ts.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_bonus_track_params_update(p_track_key text, p_params jsonb, p_updated_by uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_bounds constant jsonb := '{
        "validation_hours": [0, 168], "review_hours": [1, 168], "receipt_hours": [1, 168],
        "receipt_grace_days": [0, 30], "min_shift_minutes": [0, 1440], "checkin_tolerance_min": [0, 720],
        "checkout_tolerance_min": [0, 720], "min_lead_minutes": [0, 10080], "max_counted_per_day": [1, 50],
        "max_counted_per_week": [1, 200], "max_per_worker_week": [1, 2], "burst_count": [2, 50],
        "burst_window_hours": [1, 168], "single_worker_pct": [1, 100], "single_worker_min_shifts": [1, 100],
        "stuck_minutes": [0, 240], "pattern_count": [2, 50], "max_gap_days": [1, 90],
        "min_shifts_for_gap": [1, 100], "briefing_min_chars": [0, 500],
        "clock_tolerance_min": [1, 240], "stuck_times_enabled": [0, 1]}';
    tr    record;
    r     record;
    v_num numeric;
    v_old jsonb := '{}'::jsonb;
BEGIN
    IF p_updated_by IS NULL THEN
        RAISE EXCEPTION 'actor_required' USING ERRCODE = '22004';
    END IF;
    IF p_params IS NULL OR jsonb_typeof(p_params) <> 'object' OR p_params = '{}'::jsonb THEN
        RAISE EXCEPTION 'invalid_params' USING ERRCODE = '22023';
    END IF;
    -- FOR UPDATE: dois admins ao mesmo tempo serializam; o merge e feito sobre a linha travada
    SELECT * INTO tr FROM public.bonus_tracks WHERE key = p_track_key FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown_track' USING ERRCODE = '22023';
    END IF;
    FOR r IN SELECT j.key AS k, j.value AS v FROM jsonb_each(p_params) AS j
    LOOP
        IF NOT (v_bounds ? r.k) THEN
            RAISE EXCEPTION 'unknown_param: %', r.k USING ERRCODE = '22023';
        END IF;
        -- jsonb nao representa NaN/infinito; mesmo assim exige tipo number (string "NaN" e recusada)
        IF jsonb_typeof(r.v) <> 'number' THEN
            RAISE EXCEPTION 'invalid_param: % nao e numero', r.k USING ERRCODE = '22023';
        END IF;
        v_num := (r.v #>> '{}')::numeric;
        IF v_num <> trunc(v_num) THEN
            RAISE EXCEPTION 'invalid_param: % precisa ser inteiro', r.k USING ERRCODE = '22023';
        END IF;
        IF v_num < (v_bounds -> r.k ->> 0)::numeric OR v_num > (v_bounds -> r.k ->> 1)::numeric THEN
            RAISE EXCEPTION 'invalid_param: % fora do limite', r.k USING ERRCODE = '22023';
        END IF;
        v_old := v_old || jsonb_build_object(r.k, tr.params -> r.k);
    END LOOP;

    UPDATE public.bonus_tracks SET params = params || p_params WHERE id = tr.id;
    INSERT INTO public.bonus_admin_log (actor, action, target_id, detail)
    VALUES (p_updated_by, 'track_params_update', tr.id,
            jsonb_build_object('track', p_track_key, 'before', v_old, 'after', p_params));
    RETURN jsonb_build_object('outcome', 'ok');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_bonus_track_status_update(p_track_key text, p_status text, p_updated_by uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    tr record;
BEGIN
    IF p_updated_by IS NULL THEN
        RAISE EXCEPTION 'actor_required' USING ERRCODE = '22004';
    END IF;
    IF p_status IS NULL OR p_status NOT IN ('calibrating', 'open', 'closed') THEN
        RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO tr FROM public.bonus_tracks WHERE key = p_track_key FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown_track' USING ERRCODE = '22023';
    END IF;
    UPDATE public.bonus_tracks SET status = p_status WHERE id = tr.id;
    INSERT INTO public.bonus_admin_log (actor, action, target_id, detail)
    VALUES (p_updated_by, 'track_status_update', tr.id, jsonb_build_object(
        'track', p_track_key, 'before', tr.status, 'after', p_status));
    RETURN jsonb_build_object('outcome', 'ok');
END;
$fn$;

-- ============================================================================
-- 6b. LGPD (M3): anonimizacao da trilha, chamada de DENTRO de anonymize_account (sessao nula)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bonus_anonymize_person(p_user_id uuid, p_company_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    e       record;
    v_n     integer := 0;
    v_ids   uuid[];
BEGIN
    IF p_user_id IS NULL THEN
        RETURN 0;
    END IF;
    FOR e IN SELECT * FROM public.bonus_enrollments x
              WHERE x.operator_user_id = p_user_id
                 OR x.company_id = ANY (COALESCE(p_company_ids, '{}'::uuid[]))
              ORDER BY x.id FOR NO KEY UPDATE
    LOOP
        IF e.operator_user_id = p_user_id THEN
            -- pedido aberto: sem chave nao ha como pagar -> cancelado, awards voltam a earned
            UPDATE public.bonus_awards SET state = 'earned', payout_id = NULL
             WHERE enrollment_id = e.id AND state = 'in_payout';
            UPDATE public.bonus_payouts SET status = 'cancelled' WHERE enrollment_id = e.id AND status = 'requested';
            IF e.status IN ('invited', 'active') THEN
                UPDATE public.bonus_enrollments SET status = 'cancelled' WHERE id = e.id;
            END IF;
            UPDATE public.bonus_payouts SET pix_key_snapshot = 'anonimizado', paid_note = NULL
             WHERE enrollment_id = e.id;
            UPDATE public.bonus_enrollments
               SET display_name = 'anonimizado', pix_key = NULL, pix_key_normalized = NULL,
                   company_ack_by_label = NULL, company_ack_note = NULL
             WHERE id = e.id;
            UPDATE public.bonus_shift_ledger SET decision_note = NULL
             WHERE enrollment_id = e.id AND decision_note IS NOT NULL;
        ELSE
            -- saiu a empresa/patrao: o operador e terceiro; so some quem deu a ciencia
            UPDATE public.bonus_enrollments SET company_ack_by_label = NULL, company_ack_note = NULL
             WHERE id = e.id;
        END IF;
        v_ids := array_append(v_ids, e.id);
        v_n := v_n + 1;
    END LOOP;

    -- rastro do admin: apaga o DETALHE (quem/quando/o que permanece)
    UPDATE public.bonus_admin_log g
       SET detail = '{"anonimizado": true}'::jsonb
     WHERE g.detail <> '{"anonimizado": true}'::jsonb
       AND (g.target_id = ANY (COALESCE(v_ids, '{}'::uuid[]))
            OR g.target_id = p_user_id
            OR g.target_id IN (SELECT p.id FROM public.bonus_payouts p
                                WHERE p.enrollment_id = ANY (COALESCE(v_ids, '{}'::uuid[])))
            OR g.target_id IN (SELECT l.id FROM public.bonus_shift_ledger l
                                WHERE l.enrollment_id = ANY (COALESCE(v_ids, '{}'::uuid[])))
            OR strpos(g.detail::text, p_user_id::text) > 0);
    UPDATE public.bonus_vetos SET reason = 'anonimizado' WHERE person_id = p_user_id;
    RETURN v_n;
END;
$fn$;

DO $mig$
DECLARE
    v_oid    regprocedure := to_regprocedure('public.anonymize_account(uuid)');
    v_def    text;
    v_anchor text := 'v_counts := v_counts || jsonb_build_object(''team_connections_invited_by_nulled'', v_n);';
    v_call   text := 'PERFORM public.bonus_anonymize_person(p_user_id, v_company_ids);';
    v_n      integer;
BEGIN
    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'ASSERCAO S4(LGPD): public.anonymize_account(uuid) ausente. HALT.';
    END IF;
    v_def := pg_get_functiondef(v_oid);
    IF position(v_call IN v_def) > 0 THEN
        RAISE NOTICE 'S4: anonymize_account ja chama a trilha; nada a editar.';
        RETURN;
    END IF;
    v_n := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'ASSERCAO S4(LGPD): % ocorrencia(s) da ancora de E1 em anonymize_account (esperado 1). A funcao mudou -- HALT.', v_n;
    END IF;
    EXECUTE replace(v_def, v_anchor, v_anchor || chr(10) || '    ' || v_call);
END
$mig$;

-- Sonda COMPORTAMENTAL: cria um titular sintetico (membro removido) com inscricao e pedido aberto,
-- EXECUTA anonymize_account, confere o efeito e desfaz TUDO (subtransacao). NULL = passou.
CREATE OR REPLACE FUNCTION public.bonus_lgpd_probe()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_co    uuid;
    v_track uuid;
    v_probe uuid := gen_random_uuid();
    v_enr   uuid;
    v_res   jsonb;
    v_msg   text;
    v_ok    boolean;
BEGIN
    IF to_regprocedure('public.anonymize_account(uuid)') IS NULL THEN
        RETURN 'anonymize_account ausente';
    END IF;
    SELECT c.id INTO v_co FROM public.companies c ORDER BY c.id LIMIT 1;
    IF v_co IS NULL THEN
        RETURN 'sem empresa para executar a sonda';
    END IF;
    SELECT t.id INTO v_track FROM public.bonus_tracks t ORDER BY t.key LIMIT 1;
    BEGIN
        INSERT INTO public.company_members (company_id, user_id, role, status, created_by)
        VALUES (v_co, v_probe, 'manager', 'removed', v_probe);
        INSERT INTO public.bonus_enrollments (track_id, operator_user_id, company_id, display_name, cap_cents,
                                              created_by, pix_key, pix_key_normalized)
        VALUES (v_track, v_probe, v_co, 'Sonda LGPD', 1, v_probe, 'sonda@lgpd', 'sonda@lgpd')
        RETURNING id INTO v_enr;
        INSERT INTO public.bonus_payouts (enrollment_id, amount_cents, scheduled_for, pix_key_snapshot)
        VALUES (v_enr, 1, current_date, 'sonda@lgpd');
        EXECUTE 'SELECT public.anonymize_account($1)' INTO v_res USING v_probe;
        SELECT e.display_name = 'anonimizado' AND e.pix_key IS NULL AND e.pix_key_normalized IS NULL
               AND e.status = 'cancelled'
               AND NOT EXISTS (SELECT 1 FROM public.bonus_payouts p WHERE p.enrollment_id = e.id
                                AND (p.status = 'requested' OR p.pix_key_snapshot <> 'anonimizado'))
          INTO v_ok
          FROM public.bonus_enrollments e WHERE e.id = v_enr;
        IF NOT COALESCE(v_ok, false) THEN
            v_msg := 'anonymize_account executou e NAO anonimizou a trilha (retorno: ' || COALESCE(v_res->>'outcome', '?') || ')';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P9999', MESSAGE = 'bonus_probe_rollback';
    EXCEPTION
        WHEN SQLSTATE 'P9999' THEN NULL;                           -- rollback proposital da sonda
        WHEN OTHERS THEN v_msg := 'a sonda falhou: ' || SQLERRM;
    END;
    RETURN v_msg;
END;
$fn$;
REVOKE ALL ON FUNCTION public.bonus_anonymize_person(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bonus_lgpd_probe()                   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bonus_anonymize_person(uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.bonus_lgpd_probe()                   TO service_role;

-- ============================================================================
-- 7. Interruptor global. LIGAR exige as condicoes de ativacao (C9 + LGPD); desligar sempre pode.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_bonus_set_enabled(p_enabled boolean, p_updated_by uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_missing text[] := '{}'::text[];
    v_old     boolean;
    v_probe   text;
BEGIN
    IF p_updated_by IS NULL THEN
        RAISE EXCEPTION 'actor_required' USING ERRCODE = '22004';
    END IF;
    IF p_enabled IS NULL THEN
        RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    SELECT s.enabled INTO v_old FROM public.bonus_program_settings s WHERE s.id FOR UPDATE;

    IF p_enabled THEN
        IF to_regprocedure('public.session_can_operate_job(uuid, uuid, date)') IS NULL THEN
            v_missing := array_append(v_missing, 'E2 (20261123000300)');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger tg
                        WHERE tg.tgrelid = 'public.team_connections'::regclass
                          AND tg.tgname = 'trg_team_connections_invited_by' AND NOT tg.tgisinternal) THEN
            v_missing := array_append(v_missing, 'E3 (20261123000400)');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                        WHERE c.conrelid = 'public.company_members'::regclass
                          AND c.conname = 'company_members_role_check'
                          AND pg_catalog.pg_get_constraintdef(c.oid) ~ '[[:<:]]encarregado[[:>:]]') THEN
            v_missing := array_append(v_missing, 'E4 (20261123000500)');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                        WHERE n.nspname = 'public' AND p.proname = 'reassign_job_responsible') THEN
            v_missing := array_append(v_missing, 'E5 (20261123000600)');
        END IF;
        -- os guards de applications (20261125000100/000200) sao pre-requisito: sem eles o cliente forja
        -- presenca. Precisam existir E estar habilitados (tgenabled).
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger tg
                        WHERE tg.tgrelid = 'public.applications'::regclass AND NOT tg.tgisinternal
                          AND tg.tgname = 'trg_zz_applications_insert_guard' AND tg.tgenabled IN ('O', 'A')) THEN
            v_missing := array_append(v_missing, 'trg_zz_applications_insert_guard habilitado (20261125000100)');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger tg
                        WHERE tg.tgrelid = 'public.applications'::regclass AND NOT tg.tgisinternal
                          AND tg.tgname = 'trg_zz_applications_update_guard' AND tg.tgenabled IN ('O', 'A')) THEN
            v_missing := array_append(v_missing, 'trg_zz_applications_update_guard habilitado (20261125000200)');
        END IF;
        -- LGPD: prova por EXECUCAO (nao por texto no corpo)
        v_probe := public.bonus_lgpd_probe();
        IF v_probe IS NOT NULL THEN
            v_missing := array_append(v_missing, 'LGPD: ' || v_probe);
        END IF;
        IF cardinality(v_missing) > 0 THEN
            RETURN jsonb_build_object('outcome', 'dependencies_missing', 'missing', to_jsonb(v_missing));
        END IF;
    END IF;

    UPDATE public.bonus_program_settings SET enabled = p_enabled, updated_at = now() WHERE id;
    INSERT INTO public.bonus_admin_log (actor, action, target_id, detail)
    VALUES (p_updated_by, 'set_enabled', NULL, jsonb_build_object('before', v_old, 'after', p_enabled));
    RETURN jsonb_build_object('outcome', 'ok', 'enabled', p_enabled);
END;
$fn$;

-- ============================================================================
-- 8. Habito derivado (R30, C8): antes / semanas 1-12 / 13-16 por operador. HIPOTESE, nao resultado.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_bonus_habit_overview()
RETURNS TABLE (
    enrollment_id       uuid,
    operator_name       text,
    baseline_weekly_avg numeric,
    avg_weeks_1_12      numeric,
    avg_weeks_13_16     numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
    WITH enr AS (
        SELECT e.id, e.display_name, e.company_id, e.operator_user_id,
               public.bonus_local_date(e.starts_at) AS d0,
               (e.milestones_snapshot->'track'->>'window_weeks')::integer * 7 AS main_days,
               public.bonus_local_date(now()) - public.bonus_local_date(e.starts_at) AS elapsed
          FROM public.bonus_enrollments e
         WHERE e.accepted_at IS NOT NULL
    ),
    feitos AS (   -- turnos completos do operador (mesma definicao de R10, SEM tetos nem filtros)
        SELECT en.id AS eid, public.bonus_local_date(j.start_date) - en.d0 AS dia
          FROM enr en
          JOIN public.jobs j ON j.company_id = en.company_id
          JOIN public.applications a ON a.job_id = j.id
          JOIN public.shift_payments sp ON sp.job_id = a.job_id AND sp.worker_id = a.worker_id
         WHERE sp.status = 'recorded' AND sp.worker_confirmed_at IS NOT NULL
           AND a.worker_checkin_at IS NOT NULL AND a.worker_checkout_at IS NOT NULL
           AND a.company_checkin_confirmed_at IS NOT NULL AND a.company_checkout_confirmed_at IS NOT NULL
           AND (j.responsible_id = en.operator_user_id
                OR EXISTS (SELECT 1 FROM public.bonus_attributions ba
                            WHERE ba.job_id = j.id AND ba.enrollment_id = en.id))
    )
    SELECT en.id,
           en.display_name,
           (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE round(count(*)::numeric / 4, 2) END
              FROM feitos f WHERE f.eid = en.id AND f.dia >= -28 AND f.dia < 0),
           CASE WHEN LEAST(en.elapsed, en.main_days) < 7 THEN NULL ELSE
             round((SELECT count(*) FROM feitos f WHERE f.eid = en.id AND f.dia >= 0
                        AND f.dia < (LEAST(en.elapsed, en.main_days) / 7) * 7)::numeric
                   / (LEAST(en.elapsed, en.main_days) / 7), 2) END,
           CASE WHEN LEAST(en.elapsed - en.main_days, 28) < 7 THEN NULL ELSE
             round((SELECT count(*) FROM feitos f WHERE f.eid = en.id AND f.dia >= en.main_days
                        AND f.dia < en.main_days + (LEAST(en.elapsed - en.main_days, 28) / 7) * 7)::numeric
                   / (LEAST(en.elapsed - en.main_days, 28) / 7), 2) END
      FROM enr en
     ORDER BY en.display_name;
$fn$;

-- ============================================================================
-- 8b. Alertas para o admin (M-B): o historico de parametros filtra 'track_%' e os escondia
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_bonus_alerts(p_limit integer DEFAULT 50)
RETURNS TABLE (
    alert_id            bigint,
    alerted_at          timestamptz,
    kind                text,
    enrollment_id       uuid,
    operator_name       text,
    ledger_id           uuid,
    block_reason_at_alert text,
    payout_block_reason text,
    detail              jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT g.id, g.at, g.action, e.id, e.display_name,
           CASE WHEN g.action = 'alert_voided_late' THEN g.target_id END,
           g.detail->>'after',
           e.payout_block_reason,
           g.detail
      FROM public.bonus_admin_log g
      LEFT JOIN public.bonus_shift_ledger l ON g.action = 'alert_voided_late' AND l.id = g.target_id
      LEFT JOIN public.bonus_enrollments e
             ON e.id = CASE WHEN g.action = 'alert_voided_late' THEN l.enrollment_id ELSE g.target_id END
     WHERE g.action IN ('alert_payability', 'alert_voided_late')
     ORDER BY g.at DESC, g.id DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$fn$;

-- ============================================================================
-- 9. GRANTS: so service_role
-- ============================================================================
DO $mig$
DECLARE
    f text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.admin_bonus_refresh()',
        'public.admin_bonus_enrollment_create(text, uuid, uuid, text, uuid)',
        'public.admin_bonus_enrollment_ack(uuid, text, text, uuid)',
        'public.admin_bonus_enrollment_cancel(uuid, uuid)',
        'public.admin_bonus_decide_shift(uuid, text, uuid, text)',
        'public.admin_bonus_mark_payout_paid(uuid, uuid, text)',
        'public.admin_bonus_veto_add(uuid, text, uuid)',
        'public.admin_bonus_veto_remove(uuid, uuid)',
        'public.admin_bonus_track_params_update(text, jsonb, uuid)',
        'public.admin_bonus_track_status_update(text, text, uuid)',
        'public.admin_bonus_set_enabled(boolean, uuid)',
        'public.admin_bonus_habit_overview()',
        'public.admin_bonus_alerts(integer)'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END LOOP;
END
$mig$;

-- ============================================================================
-- 10. VERIFICACAO FINAL (toda a trilha)
-- ============================================================================
DO $mig$
DECLARE
    r   record;
    v_n integer;
BEGIN
    SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname ~ '^admin_bonus_';
    IF v_n <> 13 THEN
        RAISE EXCEPTION 'VERIFICACAO S4: esperadas 13 funcoes admin_bonus_*, ha %. HALT.', v_n;
    END IF;
    FOR r IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname ~ '^admin_bonus_'
    LOOP
        IF has_function_privilege('anon', r.oid, 'EXECUTE') OR has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'VERIFICACAO S4: % acessivel a anon/authenticated. HALT.', r.proname;
        END IF;
        IF NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'VERIFICACAO S4: % sem EXECUTE para service_role. HALT.', r.proname;
        END IF;
    END LOOP;
    FOR r IN SELECT p.proname, pg_get_functiondef(p.oid) AS def, p.prosecdef, p.proconfig
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname ~ '^(admin_)?bonus_'
    LOOP
        IF r.prosecdef AND NOT (COALESCE(r.proconfig, '{}'::text[]) @> ARRAY['search_path=""']) THEN
            RAISE EXCEPTION 'VERIFICACAO S4: % DEFINER sem search_path vazio. HALT.', r.proname;
        END IF;
        IF r.def ~ '[[:<:]](wallets|escrow_transactions|wallet_transactions|update_wallet_balance|reserve_escrow|release_escrow|refund_escrow|credit_deposit)[[:>:]]' THEN
            RAISE EXCEPTION 'VERIFICACAO S4: % referencia objeto de saldo (Article 8). HALT.', r.proname;
        END IF;
        IF r.def ~* '(company_id|owner_id)[[:space:]]*=[[:space:]]*[(]?[[:space:]]*(select[[:space:]]+)?auth[.]uid[(][)]' THEN
            RAISE EXCEPTION 'VERIFICACAO S4: % ancora empresa em auth.uid() na mao. HALT.', r.proname;
        END IF;
    END LOOP;
    SELECT count(*) INTO v_n FROM information_schema.role_table_grants g
     WHERE g.table_schema = 'public' AND left(g.table_name, 6) = 'bonus_'
       AND g.grantee IN ('anon', 'authenticated', 'service_role') AND g.privilege_type <> 'SELECT';
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'VERIFICACAO S4: service_role/anon/authenticated ganhou escrita em tabela bonus_*. HALT.';
    END IF;
    -- LGPD: a anonimizacao roda de verdade (e desfaz). Sem empresa no banco, so avisa.
    IF EXISTS (SELECT 1 FROM public.companies) THEN
        IF public.bonus_lgpd_probe() IS NOT NULL THEN
            RAISE EXCEPTION 'VERIFICACAO S4(LGPD): %. HALT.', public.bonus_lgpd_probe();
        END IF;
    ELSE
        RAISE NOTICE 'S4: sem empresa no banco; a sonda LGPD roda de novo ao ligar o programa.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.bonus_program_settings WHERE enabled)
       OR EXISTS (SELECT 1 FROM public.bonus_enrollments) THEN
        RAISE EXCEPTION 'VERIFICACAO S4: a trilha precisa terminar desligada e sem inscricao (C9). HALT.';
    END IF;
END
$mig$;
