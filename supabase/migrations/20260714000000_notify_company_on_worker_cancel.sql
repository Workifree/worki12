-- Migration: Notificar a EMPRESA quando o freela CANCELA um turno que aceitou
-- File: supabase/migrations/20260714000000_notify_company_on_worker_cancel.sql
-- ADR: .harness/spec/freela-cancela-turno/adr-freela-cancela-turno.md
-- Gate: harness-architect (toca applications; NÃO toca saldo/escrow).
--
-- ============================================================================
-- ESCOPO (o que ESTA migration faz e o que NÃO faz)
-- ----------------------------------------------------------------------------
--   FAZ: cria a função + trigger AFTER UPDATE em public.applications que INSERE
--        UMA notificação para o dono da empresa quando o freela transiciona
--        NEW.status='cancelled' a partir de OLD.status IN ('hired','in_progress').
--
--   NÃO FAZ (decisão do ADR):
--     - NÃO altera a transição: o freela JÁ consegue setar status='cancelled'
--       (validate_application_update não bloqueia 'cancelled'; RLS "Workers can
--       update own applications" permite). Nenhuma policy/constraint muda.
--     - NÃO mexe em job: o slot reabre sozinho (job segue 'open'; a unique
--       (job_id, worker_id) só barra re-convidar o MESMO worker — desejado).
--     - NÃO move saldo (Article 8). Push/modo A não tem escrow. Se pull-prepago
--       tiver escrow 'reserved', o refund fica a cargo do fluxo existente da
--       empresa (refund_escrow), fora deste trigger. Ver ADR §Escrow.
--
-- SEGURANÇA / INVARIANTES
-- ----------------------------------------------------------------------------
--   - jobs.company_id = auth.uid() do dono da empresa (invariante do projeto;
--     ver 20260622000300 e notify_new_message). É o notifications.user_id alvo.
--   - SECURITY DEFINER + SET search_path = '' → roda como owner, bypassa a RLS
--     de INSERT de notifications (o freela não precisa de permissão de INSERT
--     para a caixa da empresa). Todos os objetos são totalmente qualificados.
--   - type='status_change' é valor válido no CHECK de notifications.type.
--   - Bloco EXCEPTION: falha ao notificar NUNCA bloqueia o cancelamento do freela.
--
-- DOWN (rollback): ver rodapé.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_company_on_worker_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_company_id  uuid;
    v_job_title   text;
    v_worker_name text;
BEGIN
    -- Dono da empresa (destinatário) + título da vaga.
    SELECT j.company_id, j.title
      INTO v_company_id, v_job_title
      FROM public.jobs j
     WHERE j.id = NEW.job_id;

    IF v_company_id IS NULL THEN
        RETURN NEW;  -- sem empresa resolvível → nada a notificar
    END IF;

    -- Nome do freela para a mensagem (fallback genérico).
    SELECT COALESCE(w.full_name, 'O freela')
      INTO v_worker_name
      FROM public.workers w
     WHERE w.id = NEW.worker_id;

    INSERT INTO public.notifications (user_id, type, title, message, link, read_at, created_at)
    VALUES (
        v_company_id,
        'status_change',
        'Turno cancelado pelo freela',
        COALESCE(v_worker_name, 'O freela') || ' cancelou o turno "' ||
            COALESCE(v_job_title, 'sem título') || '".',
        '/company/jobs/' || NEW.job_id::text || '/candidates',
        NULL,
        now()
    );

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Best-effort: um erro na notificação nunca deve bloquear o cancelamento.
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_company_on_worker_cancel() IS
    'AFTER UPDATE em applications: quando o freela cancela (hired/in_progress -> cancelled), notifica o dono da empresa (jobs.company_id). SECURITY DEFINER + search_path vazio; nao move saldo (Article 8). ADR-20260714.';

-- Recria idempotente. WHEN limita o disparo à transição de cancelamento (1 evento por cancel).
DROP TRIGGER IF EXISTS trg_notify_company_on_worker_cancel ON public.applications;
CREATE TRIGGER trg_notify_company_on_worker_cancel
    AFTER UPDATE ON public.applications
    FOR EACH ROW
    WHEN (NEW.status = 'cancelled' AND OLD.status IN ('hired', 'in_progress'))
    EXECUTE FUNCTION public.notify_company_on_worker_cancel();

-- ============================================================================
-- DOWN (rollback) — sem impacto em saldo/escrow (nenhuma RPC tocada):
--   DROP TRIGGER IF EXISTS trg_notify_company_on_worker_cancel ON public.applications;
--   DROP FUNCTION IF EXISTS public.notify_company_on_worker_cancel();
-- ============================================================================
