-- Migration: as tabelas do Chamado de Turno nao tinham FK para `workers`/`companies`,
--            e isso deixava o painel de chamados INVISIVEL para toda empresa
--
-- ACHADO (23/08/2026, usando o produto): disparei um chamado pelo ShiftCallModal. O chamado foi
-- criado corretamente (`shift_calls` status=open, 1 alvo, expirando em 2h) e o freela foi
-- notificado. Mas a tela de operacao do turno continuou dizendo "Nenhum freela atrelado a este
-- turno", inclusive depois de reload forcado.
--
-- CAUSA: `ShiftCallService.listCallsByJob` pede o embed
--     targets:shift_call_targets ( ..., worker:workers ( ... ) )
-- e o PostgREST resolve embed POR FOREIGN KEY. Nao havia FK de `shift_call_targets.worker_id`
-- para `workers`, entao a requisicao inteira voltava
--     HTTP 400 PGRST200 "Could not find a relationship between 'shift_call_targets' and 'workers'"
-- O servico captura o erro e devolve `[]` (para nao derrubar a pagina), e `ShiftCallsPanel`
-- retorna null quando a lista esta vazia. Resultado: falha total, silenciosa, em 100% dos casos.
--
-- POR QUE NINGUEM VIU: (a) o painel tem testes, mas de COMPONENTE, com fixture pronta -- nenhum
-- exercita a query; (b) `logError` em producao manda para o Sentry e NAO escreve no console, entao
-- o console fica limpo enquanto o 400 acontece; (c) a falha se parece com "ainda nao chamei
-- ninguem", que e um estado legitimo da tela.
--
-- ISSO E O F1 INTEIRO. O disparo 1->N com primeiro-aceite e a feature-cabeca do produto, e a
-- empresa nao conseguia ver que disparou -- nem quem foi chamado, nem quem respondeu, nem cancelar
-- o chamado. A metrica de topo (`first_claim_at - created_at`, o numero que prova o ROI) so
-- aparecia no painel de analytics, nunca na tela onde a operacao acontece.
--
-- ESCOPO: uma varredura por colunas `worker_id`/`company_id` sem FK achou exatamente tres, todas
-- da mesma familia F1/F4. As tres entram aqui -- as outras duas nao quebram tela hoje, mas sao a
-- mesma lacuna de integridade e o mesmo embed esperando para falhar.
--
-- ON DELETE CASCADE segue a irma mais proxima, `team_list_members_worker_id_fkey`: sao todas
-- tabelas de TENTATIVA ("quem foi chamado", "quem foi perguntado"), subordinadas a quem
-- referenciam, nao contratos que devam sobreviver a parte. `applications` usa NO ACTION porque la
-- a linha E o contrato. `shift_call_targets_call_id_fkey` ja era CASCADE.
--
-- Nenhum orfao existe hoje nas tres (conferido antes de escrever); as guardas abaixo repetem a
-- checagem no momento da aplicacao e falham fechado.
--
-- Article 8: nao toca saldo.

DO $$
DECLARE v_n bigint;
BEGIN
    SELECT count(*) INTO v_n FROM public.shift_call_targets t
     WHERE NOT EXISTS (SELECT 1 FROM public.workers w WHERE w.id = t.worker_id);
    IF v_n > 0 THEN
        RAISE EXCEPTION 'ASSERCAO: % linha(s) de shift_call_targets apontam para worker inexistente. '
                        'Criar a FK apagaria/rejeitaria dado. HALT -> architect.', v_n;
    END IF;

    SELECT count(*) INTO v_n FROM public.shift_attendance_confirmations s
     WHERE NOT EXISTS (SELECT 1 FROM public.workers w WHERE w.id = s.worker_id);
    IF v_n > 0 THEN
        RAISE EXCEPTION 'ASSERCAO: % linha(s) de shift_attendance_confirmations com worker '
                        'inexistente. HALT -> architect.', v_n;
    END IF;

    SELECT count(*) INTO v_n FROM public.shift_calls sc
     WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = sc.company_id);
    IF v_n > 0 THEN
        RAISE EXCEPTION 'ASSERCAO: % linha(s) de shift_calls com company inexistente. '
                        'HALT -> architect.', v_n;
    END IF;
END $$;

ALTER TABLE public.shift_call_targets
    DROP CONSTRAINT IF EXISTS shift_call_targets_worker_id_fkey,
    ADD  CONSTRAINT shift_call_targets_worker_id_fkey
         FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE;

ALTER TABLE public.shift_attendance_confirmations
    DROP CONSTRAINT IF EXISTS shift_attendance_confirmations_worker_id_fkey,
    ADD  CONSTRAINT shift_attendance_confirmations_worker_id_fkey
         FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE;

ALTER TABLE public.shift_calls
    DROP CONSTRAINT IF EXISTS shift_calls_company_id_fkey,
    ADD  CONSTRAINT shift_calls_company_id_fkey
         FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT shift_call_targets_worker_id_fkey ON public.shift_call_targets IS
    'Integridade E contrato de leitura: o PostgREST resolve o embed worker:workers(...) por FK. '
    'Sem esta constraint, ShiftCallService.listCallsByJob voltava HTTP 400 (PGRST200) e o painel '
    'de chamados ficava invisivel para a empresa. Ver 20260823000500.';

-- O PostgREST so enxerga a FK nova depois de recarregar o cache de schema.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACAO:
--   SELECT conname, confrelid::regclass FROM pg_constraint
--    WHERE conrelid IN ('public.shift_call_targets'::regclass,
--                       'public.shift_attendance_confirmations'::regclass,
--                       'public.shift_calls'::regclass) AND contype='f';
--   -- e, no app: GET /rest/v1/shift_calls?select=*,targets:shift_call_targets(...,worker:workers(...))
--   --    deve voltar 200 com o array de alvos, nao 400.
-- DOWN: ALTER TABLE ... DROP CONSTRAINT (as tres) -- mas o painel volta a ficar cego.
-- ============================================================================
