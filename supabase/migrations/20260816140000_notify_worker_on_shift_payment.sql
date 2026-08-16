-- Migration: Notificar o FREELA em todo evento de pagamento do modo A (`shift_payments`)
-- File: supabase/migrations/20260816140000_notify_worker_on_shift_payment.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260816-notificacao-contraparte-por-trigger.md
-- Depende de: 20260630000000_shift_payments.sql (tabela) + 20260712000000_shift_payment_scheduled.sql
--             (status 'scheduled', scheduled_for, paid_at nullable)
-- Gate: harness-architect (toca a superfície de auditoria financeira; NÃO move saldo).
--
-- ============================================================================
-- PROBLEMA (achado do harness-evaluator, revisão pré-piloto)
-- ----------------------------------------------------------------------------
--   O modo A (ADR-20260630) é um loop BILATERAL: a empresa DECLARA o pagamento e o
--   freela CONFIRMA o recebimento (`worker_confirmed_at`). Hoje o lado do freela nunca
--   é avisado: não há INSERT em `notifications` em `paymentRecordService.ts`, nem trigger
--   nesta tabela, nem edge function. O loop só fecha se o freela abrir `/recebimentos`
--   por conta própria — ou seja, o recibo é unilateral na prática, que é justamente o
--   contrário do que o piloto quer provar.
--
-- ============================================================================
-- POR QUE TRIGGER E NÃO INSERT NO CLIENT
-- ----------------------------------------------------------------------------
--   A policy vigente de INSERT em notifications NÃO é mais `auth.uid() = user_id`:
--   `20260702000000_notifications_notify_counterpart.sql` já permite a empresa notificar
--   um worker com `team_connections.status='accepted'`. Logo o client TÉCNICAMENTE
--   conseguiria inserir. Mesmo assim o INSERT no client foi REJEITADO:
--     (a) Depende de um vínculo de equipe VIVO. Se o freela sair do Elenco ou BLOQUEAR a
--         empresa depois do turno (`status='blocked'` → a policy nega), o aviso de
--         "você recebeu, confirme" some em silêncio — exatamente para quem já tem atrito
--         com a empresa e mais precisa da trilha do recibo.
--     (b) São 4 pontos de escrita (record / schedule / effectivate / void). Notificação
--         best-effort replicada em 4 lugares é o padrão que já falhou calado neste projeto.
--     (c) O aviso é uma GARANTIA do produto ("nenhum lado pode suprimir"), não uma cortesia
--         da UI — mesmo landmark pattern de `notify_company_on_worker_cancel` (20260714).
--   O trigger roda como owner (SECURITY DEFINER), não passa pela RLS de `authenticated` e
--   independe de vínculo, papel do chamador ou service_role.
--
-- ============================================================================
-- EVENTOS (4 fatos distintos → 4 mensagens distintas; 2 triggers, 1 função)
-- ----------------------------------------------------------------------------
--   INSERT  status='scheduled'          → "Pagamento agendado"        (promessa; nada a confirmar)
--   INSERT  status='recorded'           → "Pagamento registrado"      (AÇÃO: confirmar recebimento)
--   UPDATE  scheduled → recorded        → "Pagamento efetivado"       (AÇÃO: confirmar recebimento)
--   UPDATE  scheduled|recorded → voided → "Agendamento cancelado" / "Registro estornado"
--   Um trigger só de INSERT não serviria: a EFETIVAÇÃO (scheduled→recorded) é um UPDATE e é
--   o momento em que o freela de fato precisa confirmar. Um WHEN de INSERT não pode
--   referenciar OLD, por isso dois triggers compartilhando a mesma função (branch por TG_OP).
--
-- IDEMPOTÊNCIA
-- ----------------------------------------------------------------------------
--   Não é preciso dedupe explícito (e ele seria ERRADO aqui):
--     - Colunas materiais de `shift_payments` são imutáveis e a máquina de estados é
--       one-way (scheduled→recorded→voided; 'voided' é terminal). Cada transição acontece
--       no máximo UMA vez por linha ⇒ exatamente 1 notificação por fato real.
--     - "Editar" um pagamento é void + NOVA linha; isso é um fato NOVO e DEVE notificar de
--       novo (há um novo registro a confirmar). Um dedupe por `link` (padrão do
--       `spendLimitService`) suprimiria justamente esse caso legítimo.
--     - `notifications` não é tabela financeira: Article 9 não se aplica; Article 8 intacto
--       (nenhuma RPC de saldo, nenhum UPDATE em wallets/escrow_transactions).
--
-- LINKS (rotas verificadas em frontend/src/App.tsx — a Onda 2 removeu /wallet e /company/financeiro)
-- ----------------------------------------------------------------------------
--   '/recibo/<job_id>'  → ReceiptView; cross-papel (NÃO está em `workerOnlyPaths` do
--                         ProtectedRoute) e ramifica por status (scheduled = comprovante de
--                         agendamento; recorded = recibo bilateral com o botão de confirmar).
--   '/recebimentos'     → MeusRecebimentos (worker-only). Usado SÓ no evento 'voided', porque
--                         `getReceipt()` filtra status IN ('scheduled','recorded') e devolveria
--                         NULL para uma linha estornada — o link do recibo levaria a uma tela vazia.
--
-- SEGURANÇA / LGPD
-- ----------------------------------------------------------------------------
--   - SECURITY DEFINER + SET search_path = '' + todos os objetos schema-qualificados.
--   - Destinatário = NEW.worker_id, que é `workers.id` = `auth.uid()` do freela
--     (invariante documentada em 20260630000000 §MODELO DE IDENTIDADE) e FK válida de
--     `notifications.user_id → auth.users(id)`.
--   - NENHUM trigger BEFORE/AFTER DELETE é criado: `shift_payments` tem FKs ON DELETE RESTRICT
--     e nenhuma policy de DELETE (auditoria não se apaga). O apagamento de conta (LGPD,
--     `delete-account`) não passa por aqui.
--   - Bloco EXCEPTION WHEN OTHERS: falha ao notificar NUNCA bloqueia o registro/estorno do
--     pagamento (e nunca quebra um fluxo administrativo em massa).
--
-- DOWN (rollback): ver rodapé.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_worker_on_shift_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_company_name text;
    v_job_title    text;
    v_amount       text;
    v_title        text;
    v_message      text;
    v_link         text;
BEGIN
    -- ---- Contexto legível (tudo opcional: mensagem degrada, nunca falha) ----
    SELECT c.name INTO v_company_name
      FROM public.companies c
     WHERE c.id = NEW.company_id;

    SELECT j.title INTO v_job_title
      FROM public.jobs j
     WHERE j.id = NEW.job_id;

    v_company_name := COALESCE(v_company_name, 'A empresa');
    v_job_title    := COALESCE(v_job_title, 'sem titulo');
    -- Formatação determinística (sem depender de lc_numeric): 1500.00 -> "1.500,00" não é
    -- garantido com 'G', então usamos ponto decimal e trocamos por vírgula.
    v_amount       := replace(to_char(NEW.amount, 'FM9999999990.00'), '.', ',');

    -- ---- Seleção do evento ----
    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'scheduled' THEN
            v_title   := 'Pagamento agendado';
            v_message := v_company_name || ' agendou o pagamento de R$ ' || v_amount ||
                         ' do turno "' || v_job_title || '" para ' ||
                         to_char(NEW.scheduled_for, 'DD/MM/YYYY') ||
                         '. Você não precisa fazer nada agora.';
            v_link    := '/recibo/' || NEW.job_id::text;

        ELSIF NEW.status = 'recorded' THEN
            v_title   := 'Pagamento registrado — confirme';
            v_message := v_company_name || ' registrou o pagamento de R$ ' || v_amount ||
                         ' do turno "' || v_job_title ||
                         '". Abra o recibo e confirme se você recebeu.';
            v_link    := '/recibo/' || NEW.job_id::text;

        ELSE
            RETURN NEW;  -- estado não notificável no INSERT
        END IF;

    ELSE  -- TG_OP = 'UPDATE' (o WHEN do trigger já garante mudança de status)
        IF OLD.status = 'scheduled' AND NEW.status = 'recorded' THEN
            v_title   := 'Pagamento efetivado — confirme';
            v_message := v_company_name || ' marcou como pago o valor de R$ ' || v_amount ||
                         ' do turno "' || v_job_title ||
                         '". Abra o recibo e confirme se você recebeu.';
            v_link    := '/recibo/' || NEW.job_id::text;

        ELSIF NEW.status = 'voided' AND OLD.status = 'scheduled' THEN
            v_title   := 'Agendamento de pagamento cancelado';
            v_message := v_company_name || ' cancelou o agendamento do pagamento de R$ ' ||
                         v_amount || ' do turno "' || v_job_title ||
                         '". Procure a empresa para combinar o pagamento.';
            v_link    := '/recebimentos';

        ELSIF NEW.status = 'voided' AND OLD.status = 'recorded' THEN
            v_title   := 'Registro de pagamento estornado';
            v_message := v_company_name || ' estornou o registro de pagamento de R$ ' ||
                         v_amount || ' do turno "' || v_job_title ||
                         '". Se você já recebeu, procure a empresa.';
            v_link    := '/recebimentos';

        ELSE
            RETURN NEW;  -- transição sem aviso ao freela
        END IF;
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message, link, read_at, created_at)
    VALUES (NEW.worker_id, 'payment', v_title, v_message, v_link, NULL, now());

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Best-effort: um erro na notificação nunca bloqueia o registro/estorno do pagamento.
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_worker_on_shift_payment() IS
    'AFTER INSERT/UPDATE em shift_payments: notifica o freela (worker_id) em agendamento, registro, efetivacao e estorno do pagamento do modo A. SECURITY DEFINER + search_path vazio; NAO move saldo (Article 8). ADR-20260816-notificacao-contraparte-por-trigger.';

-- INSERT: nasce 'scheduled' (promessa) ou 'recorded' (registro direto). WHEN evita disparo
-- em qualquer estado futuro que não seja notificável.
DROP TRIGGER IF EXISTS trg_notify_worker_on_shift_payment_insert ON public.shift_payments;
CREATE TRIGGER trg_notify_worker_on_shift_payment_insert
    AFTER INSERT ON public.shift_payments
    FOR EACH ROW
    WHEN (NEW.status IN ('scheduled', 'recorded'))
    EXECUTE FUNCTION public.notify_worker_on_shift_payment();

-- UPDATE: só transições de status interessam. A confirmação do freela
-- (worker_confirmed_at) NÃO dispara nada — ele é o autor do ato.
DROP TRIGGER IF EXISTS trg_notify_worker_on_shift_payment_update ON public.shift_payments;
CREATE TRIGGER trg_notify_worker_on_shift_payment_update
    AFTER UPDATE ON public.shift_payments
    FOR EACH ROW
    WHEN (NEW.status IS DISTINCT FROM OLD.status)
    EXECUTE FUNCTION public.notify_worker_on_shift_payment();

-- ============================================================================
-- DOWN (rollback) — sem impacto em saldo/escrow (nenhuma RPC tocada):
--   DROP TRIGGER IF EXISTS trg_notify_worker_on_shift_payment_insert ON public.shift_payments;
--   DROP TRIGGER IF EXISTS trg_notify_worker_on_shift_payment_update ON public.shift_payments;
--   DROP FUNCTION IF EXISTS public.notify_worker_on_shift_payment();
-- ============================================================================
