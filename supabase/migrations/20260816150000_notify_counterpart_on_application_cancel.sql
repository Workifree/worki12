-- Migration: Notificar a CONTRAPARTE (quem NÃO cancelou) em todo cancelamento de turno/convite
-- File: supabase/migrations/20260816150000_notify_counterpart_on_application_cancel.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260816-notificacao-contraparte-por-trigger.md
-- Substitui: public.notify_company_on_worker_cancel() + trg_notify_company_on_worker_cancel
--            (20260714000000_notify_company_on_worker_cancel.sql)
-- Gate: harness-architect (toca applications; NÃO toca saldo/escrow — Article 8 intacto).
--
-- ============================================================================
-- PROBLEMA 1 (novo): a empresa desfaz e o freela não fica sabendo
-- ----------------------------------------------------------------------------
--   A revisão pré-piloto adicionou duas ações à empresa (`shiftInviteService`):
--     - `cancelInvite`      : 'invited'              → 'cancelled'  (retirar convite)
--     - `dismissFromShift`  : 'hired' | 'in_progress'→ 'cancelled'  (dispensar do turno)
--   O freela contava com aquela diária e não recebe aviso nenhum: o convite/turno só
--   some da tela na próxima vez que ele abrir o app.
--
-- PROBLEMA 2 (bug LATENTE, já em produção): atribuição errada
-- ----------------------------------------------------------------------------
--   `trg_notify_company_on_worker_cancel` (20260714) dispara em
--       NEW.status='cancelled' AND OLD.status IN ('hired','in_progress')
--   SEM olhar QUEM cancelou, e notifica sempre a EMPRESA com o texto
--   "Turno cancelado pelo freela". Mas a EMPRESA também produz essa transição hoje:
--     - `CompanyJobDetails.tsx:106` e `CompanyJobs.tsx:426` cancelam as applications
--       'hired'/'in_progress' ao excluir/encerrar o turno;
--     - `dismissFromShift` (novo) faz exatamente a mesma transição.
--   Resultado atual: a empresa recebe na própria caixa "Fulano cancelou o turno" logo
--   depois de ELA MESMA ter cancelado — e o freela, que perdeu o turno, não recebe nada.
--   Corrigir isso exige tocar essa função, então esta migration a UNIFICA em vez de
--   empilhar um segundo trigger com WHEN sobreposto.
--
-- ============================================================================
-- DECISÃO — 1 função, 1 trigger, ramificação por ATOR (auth.uid())
-- ----------------------------------------------------------------------------
--   `auth.uid()` FUNCIONA dentro de trigger SECURITY DEFINER: SECURITY DEFINER troca o
--   ROLE de execução, não as claims do JWT (que vivem no GUC `request.jwt.claims`, lido por
--   `auth.uid()`). Precedente no próprio projeto: `validate_application_update`
--   (20260622000300) e `enforce_shift_payment_immutability` (20260630000000) são ambas
--   SECURITY DEFINER e particionam por papel com `auth.uid()`. Nenhum sinal extra
--   (coluna `cancelled_by`) é necessário — e ele seria pior: exigiria confiar no client
--   para preencher quem cancelou.
--
--   Três atores possíveis:
--     'worker'  auth.uid() = NEW.worker_id            → notifica a EMPRESA  (comportamento 20260714, preservado)
--     'company' auth.uid() = jobs.company_id          → notifica o FREELA   (NOVO)
--     'system'  auth.uid() IS NULL (service_role/cron/`delete-account`)
--                                                     → notifica OS DOIS, com texto NEUTRO
--   O ramo 'system' existe porque `delete-account` (edge function, service_role) cancela
--   applications ativas dos dois lados. Silenciar esse caso seria uma REGRESSÃO (hoje a
--   empresa é avisada quando o freela apaga a conta) e atribuir a alguém seria MENTIRA.
--   Texto neutro ("O turno foi cancelado") é a única saída honesta.
--
--   Estados de origem cobertos: 'invited' (convite retirado — NOVO), 'hired' e
--   'in_progress' (paridade com 20260714). Fluxo pull ('pending'/'reviewing'/'interview')
--   fica de fora: no piloto só existe push, e recusar candidatura já tem seu próprio caminho.
--
-- IDEMPOTÊNCIA
-- ----------------------------------------------------------------------------
--   O WHEN restringe a UMA transição de entrada em 'cancelled' a partir de um estado ativo.
--   Reentrar em 'cancelled' exigiria sair de 'cancelled' primeiro (nenhum fluxo do produto
--   faz isso) e, se acontecesse, seria um fato NOVO que merece novo aviso. Dedupe por `link`
--   (padrão do `spendLimitService`) seria errado aqui: dois turnos distintos da mesma empresa
--   compartilham o link do freela. `notifications` não é tabela financeira — Article 9 não
--   se aplica.
--
-- LINKS (rotas verificadas em frontend/src/App.tsx)
-- ----------------------------------------------------------------------------
--   empresa → '/company/jobs/<job_id>/candidates'  (CompanyJobCandidates; company-only)
--   freela  → '/my-jobs'                            (MyJobs; worker-only)
--   Nenhuma rota removida pela Onda 2 (/wallet, /company/financeiro) é referenciada.
--
-- SEGURANÇA / LGPD
-- ----------------------------------------------------------------------------
--   - SECURITY DEFINER + SET search_path = '' + objetos schema-qualificados.
--   - NÃO cria trigger de DELETE. O apagamento de conta (`delete-account`) faz UPDATE em
--     applications, não DELETE — e o bloco EXCEPTION WHEN OTHERS garante que uma falha ao
--     notificar (ex.: destinatário já removido de auth.users) jamais aborte o apagamento
--     nem qualquer operação em massa. `notifications.user_id` é ON DELETE CASCADE, então
--     notificações de uma conta apagada somem junto com ela.
--   - NÃO altera policy, constraint, transição de status nem saldo. Refund de escrow (fluxo
--     pull prepago legado) continua manual, a cargo da empresa (Article 8 intacto).
--
-- DOWN (rollback): ver rodapé.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_counterpart_on_application_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_company_id   uuid;
    v_job_title    text;
    v_company_name text;
    v_worker_name  text;
    v_start_raw    text;
    v_when         text;
    v_actor        text;
BEGIN
    -- Dono da empresa (= jobs.company_id, invariante do projeto) + contexto da vaga.
    -- `start_date` sai como TEXT: a tabela `jobs` não é definida por migration neste repo
    -- (schema legado), então o tipo real não é auditável aqui — `::text` nunca falha.
    SELECT j.company_id, j.title, j.start_date::text
      INTO v_company_id, v_job_title, v_start_raw
      FROM public.jobs j
     WHERE j.id = NEW.job_id;

    IF v_company_id IS NULL THEN
        RETURN NEW;  -- sem empresa resolvível → nada a notificar
    END IF;

    v_job_title := COALESCE(v_job_title, 'sem titulo');

    -- Sufixo de data, isolado num bloco próprio: se o cast falhar (formato inesperado do
    -- schema legado), a data some da mensagem — a NOTIFICAÇÃO NÃO SE PERDE. Sem este bloco,
    -- um erro aqui cairia no EXCEPTION externo e silenciaria o aviso inteiro.
    BEGIN
        -- Concatenação NULL-safe: start_date NULL → sufixo vazio (não anula a mensagem).
        v_when := COALESCE(' de ' || to_char(v_start_raw::date, 'DD/MM'), '');
    EXCEPTION WHEN OTHERS THEN
        v_when := '';
    END;

    SELECT COALESCE(w.full_name, 'O freela') INTO v_worker_name
      FROM public.workers w WHERE w.id = NEW.worker_id;
    v_worker_name := COALESCE(v_worker_name, 'O freela');

    SELECT COALESCE(c.name, 'A empresa') INTO v_company_name
      FROM public.companies c WHERE c.id = v_company_id;
    v_company_name := COALESCE(v_company_name, 'A empresa');

    -- Quem produziu a transição? (auth.uid() NULL → 'system': service_role, cron, delete-account)
    v_actor := CASE
                   WHEN auth.uid() = NEW.worker_id THEN 'worker'
                   WHEN auth.uid() = v_company_id  THEN 'company'
                   ELSE 'system'
               END;

    -- ---------------- FREELA cancelou → avisa a EMPRESA (comportamento de 20260714) -------------
    IF v_actor = 'worker' THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read_at, created_at)
        VALUES (
            v_company_id,
            'status_change',
            'Turno cancelado pelo freela',
            v_worker_name || ' cancelou o turno "' || v_job_title || '"' || v_when || '.',
            '/company/jobs/' || NEW.job_id::text || '/candidates',
            NULL,
            now()
        );

    -- ---------------- EMPRESA cancelou → avisa o FREELA (NOVO) ---------------------------------
    ELSIF v_actor = 'company' THEN
        IF OLD.status = 'invited' THEN
            INSERT INTO public.notifications (user_id, type, title, message, link, read_at, created_at)
            VALUES (
                NEW.worker_id,
                'status_change',
                'Convite de turno cancelado',
                v_company_name || ' cancelou o convite para o turno "' || v_job_title || '"' ||
                    v_when || '.',
                '/my-jobs',
                NULL,
                now()
            );
        ELSE  -- OLD.status IN ('hired','in_progress') — o freela já contava com a diária
            INSERT INTO public.notifications (user_id, type, title, message, link, read_at, created_at)
            VALUES (
                NEW.worker_id,
                'status_change',
                'Turno cancelado pela empresa',
                v_company_name || ' cancelou o turno "' || v_job_title || '"' || v_when ||
                    '. Você não precisa comparecer.',
                '/my-jobs',
                NULL,
                now()
            );
        END IF;

    -- ---------------- Ator desconhecido → avisa OS DOIS, sem atribuir culpa -------------------
    ELSE
        INSERT INTO public.notifications (user_id, type, title, message, link, read_at, created_at)
        VALUES (
            v_company_id,
            'status_change',
            'Turno cancelado',
            'O turno "' || v_job_title || '"' || v_when || ' com ' || v_worker_name ||
                ' foi cancelado.',
            '/company/jobs/' || NEW.job_id::text || '/candidates',
            NULL,
            now()
        );

        INSERT INTO public.notifications (user_id, type, title, message, link, read_at, created_at)
        VALUES (
            NEW.worker_id,
            'status_change',
            'Turno cancelado',
            'O turno "' || v_job_title || '"' || v_when || ' com ' || v_company_name ||
                ' foi cancelado.',
            '/my-jobs',
            NULL,
            now()
        );
    END IF;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Best-effort: falha ao notificar NUNCA bloqueia o cancelamento (nem o apagamento de conta).
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_counterpart_on_application_cancel() IS
    'AFTER UPDATE em applications: em invited|hired|in_progress -> cancelled, notifica a CONTRAPARTE de quem cancelou (ator por auth.uid(); ator desconhecido notifica os dois com texto neutro). Substitui notify_company_on_worker_cancel. SECURITY DEFINER + search_path vazio; nao move saldo (Article 8). ADR-20260816-notificacao-contraparte-por-trigger.';

-- Remove o trigger antigo ANTES da função (dependência) — idempotente.
DROP TRIGGER IF EXISTS trg_notify_company_on_worker_cancel ON public.applications;
DROP FUNCTION IF EXISTS public.notify_company_on_worker_cancel();

DROP TRIGGER IF EXISTS trg_notify_counterpart_on_application_cancel ON public.applications;
CREATE TRIGGER trg_notify_counterpart_on_application_cancel
    AFTER UPDATE ON public.applications
    FOR EACH ROW
    WHEN (NEW.status = 'cancelled' AND OLD.status IN ('invited', 'hired', 'in_progress'))
    EXECUTE FUNCTION public.notify_counterpart_on_application_cancel();

-- ============================================================================
-- DOWN (rollback) — sem impacto em saldo/escrow (nenhuma RPC tocada):
--   DROP TRIGGER IF EXISTS trg_notify_counterpart_on_application_cancel ON public.applications;
--   DROP FUNCTION IF EXISTS public.notify_counterpart_on_application_cancel();
--   -- e reaplicar 20260714000000_notify_company_on_worker_cancel.sql na íntegra
--   -- (recria notify_company_on_worker_cancel + trg_notify_company_on_worker_cancel,
--   --  reintroduzindo o bug de atribuição descrito acima).
-- ============================================================================
