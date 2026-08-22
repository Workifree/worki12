-- Migration: o uuid de freela deixa de ser credencial de PII (DS-PII-1..3)
-- File: supabase/migrations/20260821000300_pii_uuid_credential_fix.sql
-- Fonte normativa: .harness/spec/troca-freelas/ddl-aprovado.md §6.5-bis
-- ADR: .harness/memory-bank/decisions/ADR-20260821-uuid-de-freela-nao-e-credencial-de-pii.md
--
-- ============================================================================
-- O DEFEITO, EM UMA FRASE
-- ============================================================================
--   `can_view_worker_profile` (20260816120000) concede leitura da LINHA INTEIRA de `workers`
--   (cpf, phone, pix_key, birth_date) para `team_connections.status IN ('pending','accepted')`.
--   'pending' é um estado que a EMPRESA escreve sozinha (`tc_insert_company`, 20260622000000,
--   só exige ser dona e nascer 'pending'). Enquanto isso valer, CONHECER O UUID de um freela
--   equivale a TER AUTORIZAÇÃO sobre o PII dele — o uuid vira credencial portadora, e qualquer
--   canal do produto que deixe escapar um identificador (path de storage, coluna de RPC, log,
--   link de notificação) vira um vazamento de CPF/PIX.
--
--   'pending' é a empresa dizendo "quero". 'accepted' é a pessoa dizendo "pode". CPF, PIX e
--   data de nascimento pertencem ao segundo.
--
-- ============================================================================
-- TRÊS MUDANÇAS (DS-PII-1..3 — todas BLOQUEANTES; DS-PII-3 já está em produção há dias)
-- ============================================================================
--   DS-PII-1) `can_view_worker_profile` PERDE o ramo 'pending'. Ficam: (0) self, (1) elenco
--             ACCEPTED, (2) vínculo operacional via `applications`.
--   DS-PII-2) DS-PII-1 quebra o cartão de convite pendente: `teamConnectionService.
--             listAllConnections` embute `worker:workers(...)` sem filtrar status, e sob
--             PostgREST o embed de uma linha negada vem `null` — cartão sem nome, SEM ERRO.
--             RPC nova `list_team_connection_cards()`, SECURITY DEFINER, SEM PARÂMETRO
--             (precedente `is_shift_call_target` / `list_worker_referral_cards`: função que
--             aceita "por qual empresa listar" é varredura com passo de uuid). Projeção fechada
--             e exaustiva dos EXATOS seis campos que a tela já consome (nenhum PII):
--             id, full_name, avatar_url, primary_role, rating_average, city.
--             `listTeamMembers` (filtra 'accepted', usa phone/pix_key) NÃO muda — lá o
--             consentimento existe e phone/pix_key são o insumo do modo A.
--   DS-PII-3) `get_profile_reviews` (redefinida por ÚLTIMO em 20260821000100 — ESSA é a base
--             usada aqui, não a 20260816130000 original) devolve `reviewer_id` cru para
--             qualquer sessão autenticada. Com `p_direction='company'` os avaliadores são
--             freelas: a função já mascara o NOME ("Carlos S.") mas entrega o UUID ao lado —
--             mesma classe de vazamento, sem path de storage nenhum, JÁ APLICADA EM PRODUÇÃO
--             desde 16/08. `reviewer_id` passa a sair NULL quando o avaliador é freela E o
--             caller não é o dono do perfil avaliado — MESMO predicado que já rege o
--             mascaramento do nome. Com `p_direction='worker'` o avaliador é empresa e
--             `companies.id` é público (SELECT USING (true)) — segue saindo sem alteração.
--
-- NÃO BLOQUEANTES (fora desta migration, ver ADR): DS-PII-4 (vitrine de F10 mantém avatar_url,
-- só corrige a declaração do contrato) e DS-PII-5 (convenção de path do bucket — ops, não SQL).
--
-- ARTICLE 8 INTACTO: nenhuma das três mexe em saldo/escrow/wallet_transactions. Só leitura.
-- Risk: MEDIUM (reduz superfície de leitura de duas policies já em produção). Reversível — ver
-- DOWN no fim do arquivo.
-- Backup required before production deploy: NO (nenhuma reescrita de dado existente).
-- ============================================================================


-- ============================================================================
-- DS-PII-1 — can_view_worker_profile perde o ramo 'pending'
-- ============================================================================
CREATE OR REPLACE FUNCTION public.can_view_worker_profile(p_worker_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    -- Sem sessão (anon) -> nada.
    IF v_uid IS NULL OR p_worker_id IS NULL THEN
        RETURN false;
    END IF;

    -- (0) O próprio freela lê a própria linha (Profile, Dashboard, Sidebar, ProtectedRoute,
    --     DepositModal, onboarding). Mantém `select('*')` funcionando para o dono do dado.
    IF p_worker_id = v_uid THEN
        RETURN true;
    END IF;

    -- (1) Vínculo de elenco — DS-PII-1: SÓ 'accepted'. 'pending' foi removido de propósito:
    --     é a empresa dizendo "quero", escrito unilateralmente por ela (`tc_insert_company`
    --     só exige ser dona e nascer 'pending'). Enquanto 'pending' concedesse leitura, o uuid
    --     do freela virava credencial portadora de cpf/phone/pix_key/birth_date — ver
    --     ADR-20260821-uuid-de-freela-nao-e-credencial-de-pii. 'blocked' continua sem conceder
    --     (veto explícito do freela).
    IF EXISTS (
        SELECT 1
        FROM public.team_connections tc
        WHERE tc.worker_id = p_worker_id
          AND tc.status = 'accepted'
          AND (
                tc.company_id = v_uid
             OR tc.company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_id = v_uid)
          )
    ) THEN
        RETURN true;
    END IF;

    -- (2) Vínculo operacional: o freela tem candidatura OU convite de turno (ambos vivem em
    --     `applications`) em um turno desta empresa. Cobre CompanyJobCandidates, CompanyJobs,
    --     CompanyDashboard, CompanyMessages, ReceiptView, relatório de ordens e o BI financeiro.
    --     Sem filtro de status: histórico concluído/cancelado precisa continuar legível para
    --     recibo, relatório e BI. Inalterado por DS-PII-1.
    IF EXISTS (
        SELECT 1
        FROM public.applications a
        JOIN public.jobs j ON j.id = a.job_id
        WHERE a.worker_id = p_worker_id
          AND (
                j.company_id = v_uid
             OR j.company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_id = v_uid)
          )
    ) THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

COMMENT ON FUNCTION public.can_view_worker_profile(uuid) IS
    'Decide se auth.uid() pode ler a linha de um worker: o próprio freela, ou empresa com '
    'team_connections ACCEPTED (DS-PII-1, 20260821000300 — o ramo "pending" foi removido: '
    'nascia de INSERT unilateral da empresa e virava credencial de PII), ou empresa com '
    'applications do freela em turno seu. Retorna só boolean (não vaza dado). Usada na policy '
    'de SELECT de workers e em can_view_reviews_of/get_profile_reviews.';

-- Grants inalterados (20260816201420 já revogou de PUBLIC/anon e concedeu authenticated/service_role).
GRANT EXECUTE ON FUNCTION public.can_view_worker_profile(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.can_view_worker_profile(uuid) FROM PUBLIC, anon;


-- ============================================================================
-- DS-PII-2 — list_team_connection_cards(): cartão do convite pendente, sem PII
-- ============================================================================
-- DS-PII-1 esvazia o embed `worker:workers(...)` de `teamConnectionService.listAllConnections`
-- para linhas 'pending' (RLS negada -> PostgREST devolve `worker: null`, sem erro). O único
-- consumidor de `listAllConnections` é `useCompanyTeam` (hook), que filtra `status === 'pending'`
-- para renderizar `PendingCard` — e é exatamente o cartão que perderia o nome.
--
-- Esta RPC roda como owner (SECURITY DEFINER) e decide, na unha, o que é seguro projetar:
-- os MESMOS seis campos não-PII que `listAllConnections` já selecionava
-- (id, full_name, avatar_url, primary_role, rating_average, city) — nunca cpf/phone/pix_key/
-- birth_date. Cobre TODAS as conexões da empresa (pending + accepted + blocked), como o
-- `listAllConnections` original — o filtro por status continua no client (useTeamConnections).
--
-- SEM PARÂMETRO de propósito (precedente `is_shift_call_target`, F1 / `list_worker_referral_cards`,
-- F10): uma função que aceitasse "por qual empresa listar" seria uma varredura com passo de uuid.
-- A autorização é sempre sobre auth.uid() — ancoragem dupla idêntica a `is_company_owner`.
-- STABLE: não escreve nada.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_team_connection_cards()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_out jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    -- Ancoragem dupla materializada (mesma de is_company_owner/list_worker_referral_cards).
    WITH mine AS (
        SELECT c.id FROM public.companies c WHERE c.owner_id = v_uid
        UNION
        SELECT c.id FROM public.companies c WHERE c.id = v_uid
    )
    SELECT coalesce(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb)
      INTO v_out
      FROM (
        SELECT tc.created_at AS ord, jsonb_build_object(
                   'id',          tc.id,
                   'company_id',  tc.company_id,
                   'worker_id',   tc.worker_id,
                   'status',      tc.status,
                   'source',      tc.source,
                   'blocked_by',  tc.blocked_by,
                   'created_at',  tc.created_at,
                   'accepted_at', tc.accepted_at,
                   'updated_at',  tc.updated_at,
                   -- Projeção EXAUSTIVA e fechada — NUNCA to_jsonb(w.*), que vazaria toda
                   -- coluna futura de `workers` sozinha. Nenhum destes seis é PII.
                   'worker', jsonb_build_object(
                       'id',             w.id,
                       'full_name',      w.full_name,
                       'avatar_url',     w.avatar_url,
                       'primary_role',   w.primary_role,
                       'rating_average', w.rating_average,
                       'city',           w.city
                   )
               ) AS x
          FROM public.team_connections tc
          JOIN public.workers w ON w.id = tc.worker_id
         WHERE tc.company_id IN (SELECT id FROM mine)
      ) s;

    RETURN jsonb_build_object('outcome', 'ok', 'items', v_out);
END;
$$;

COMMENT ON FUNCTION public.list_team_connection_cards() IS
    'DS-PII-2 — todas as conexões (pending/accepted/blocked) da empresa da sessão, com projeção '
    'fechada e exaustiva de workers (id, full_name, avatar_url, primary_role, rating_average, '
    'city — nenhum PII). Existe porque DS-PII-1 esvazia o embed worker:workers(...) de '
    'listAllConnections para linhas pending. SEM PARAMETRO de proposito (varredura com passo de '
    'uuid seria possivel se aceitasse "por qual empresa"). Nao toca saldo.';

REVOKE EXECUTE ON FUNCTION public.list_team_connection_cards() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_team_connection_cards() TO authenticated, service_role;


-- ============================================================================
-- DS-PII-3 — get_profile_reviews para de devolver reviewer_id de pessoa natural a terceiro
-- ============================================================================
-- Base: a redefinição MAIS RECENTE em produção é 20260821000100 (gate por p_direction), NÃO a
-- 20260816130000 original — reproduzida aqui na íntegra, com o delta único marcado DS-PII-3.
-- Sem isso o contrato apontaria para um baseline já superado (foi exatamente esse erro que fez
-- o F11 reverter um fix em produção hoje, conforme aviso da tarefa).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_profile_reviews(
    p_reviewed_id text,
    p_direction   text
)
RETURNS TABLE (
    review_id     text,
    rating        numeric,
    comment       text,
    created_at    text,
    reviewer_id   text,
    reviewer_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        r.id::text,
        r.rating::numeric,
        r.comment::text,
        -- ISO 8601 explícito em UTC (parser estrito do Safari rejeita o formato nativo).
        to_char(r.created_at::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        -- DS-PII-3: reviewer_id só sai quando o avaliador é EMPRESA (companies.id é público,
        -- SELECT USING (true)) OU quando o caller é o DONO do perfil avaliado — MESMO
        -- predicado que já mascara reviewer_name abaixo, aplicado ao campo que ninguém tinha
        -- olhado. Sem isto, uma empresa colhia uuids de freelas em lote via p_direction='company'
        -- (nome mascarado, uuid cru ao lado) e escalava via tc_insert_company + DS-PII-1.
        (CASE
            WHEN p_direction = 'worker' THEN r.reviewer_id::text
            WHEN (
                public.try_uuid(p_reviewed_id) = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM public.companies co
                    WHERE co.id = public.try_uuid(p_reviewed_id)
                      AND co.owner_id = auth.uid()
                )
            ) THEN r.reviewer_id::text
            ELSE NULL
        END)::text,
        (CASE
            -- Avaliador é EMPRESA: nome comercial, sem mascaramento.
            WHEN p_direction = 'worker' THEN (
                SELECT c.name::text
                FROM public.companies c
                WHERE c.id = r.reviewer_id
            )
            -- Avaliador é FREELA (pessoa física): completo só para o dono do perfil avaliado.
            ELSE (
                SELECT CASE
                    WHEN (
                        public.try_uuid(p_reviewed_id) = auth.uid()
                        OR EXISTS (
                            SELECT 1 FROM public.companies co
                            WHERE co.id = public.try_uuid(p_reviewed_id)
                              AND co.owner_id = auth.uid()
                        )
                    ) THEN nullif(btrim(coalesce(w.full_name, '')), '')::text
                    ELSE public.mask_display_name(w.full_name)
                END
                FROM public.workers w
                WHERE w.id = r.reviewer_id
            )
        END)::text
    FROM public.reviews r
    WHERE auth.uid() IS NOT NULL
      AND public.try_uuid(p_reviewed_id) IS NOT NULL
      AND p_direction IN ('worker', 'company')
      -- Gate por direção (EMENDA 2026-08-21, 20260821000100):
      --   'company' = perfil de EMPRESA avaliada -> ABERTO a qualquer autenticado. É a prova
      --               social do perfil público /empresa/:id (o freela decide antes de aceitar
      --               convite). Os avaliadores freelas saem mascarados no NOME e, a partir de
      --               DS-PII-3, também com reviewer_id NULL para quem não é o dono.
      --   'worker'  = perfil de FREELA avaliado -> exige vínculo, mesma régua de
      --               can_view_worker_profile. Sem vínculo: ZERO linhas, sem erro.
      AND (
            p_direction = 'company'
         OR public.can_view_worker_profile(public.try_uuid(p_reviewed_id))
      )
      AND r.reviewed_id = public.try_uuid(p_reviewed_id)
      AND r.direction::text = p_direction
    ORDER BY r.created_at DESC;
$$;

COMMENT ON FUNCTION public.get_profile_reviews(text, text) IS
    'Avaliacoes recebidas por um perfil, ja com o nome de exibicao do avaliador. Deriva os '
    'avaliadores da propria tabela reviews (nao aceita lista de ids do caller) — nao e oraculo de '
    'enumeracao de nomes. Freela avaliador aparece mascarado ("Carlos S.") para terceiros e '
    'completo so para o dono do perfil avaliado. GATE POR DIRECAO (20260821000100): p_direction='
    '''company'' (perfil de empresa) e ABERTO a qualquer autenticado; p_direction=''worker'' '
    '(perfil de freela) EXIGE can_view_worker_profile. DS-PII-3 (20260821000300): reviewer_id sai '
    'NULL quando o avaliador e freela e o caller nao e o dono do perfil avaliado — mesmo '
    'predicado que ja mascarava reviewer_name, fechando a segunda instancia da classe descrita em '
    'ADR-20260821-uuid-de-freela-nao-e-credencial-de-pii.';

REVOKE EXECUTE ON FUNCTION public.get_profile_reviews(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_profile_reviews(text, text) TO authenticated, service_role;


-- ============================================================================
-- COMO VERIFICAR (obrigatório após aplicar — NÃO aplicar em produção sem revisão humana)
-- ----------------------------------------------------------------------------
-- V1 (DS-PII-1). Empresa cria team_connections 'pending' com um freela NOVO (nunca teve
--   applications/accepted): GET /rest/v1/workers?id=eq.<worker> ⇒ [] (antes: linha inteira
--   com cpf/phone/pix_key). Mesma empresa, depois do freela aceitar (status='accepted') ⇒
--   linha volta a aparecer.
-- V2 (DS-PII-2). Empresa com convite pending (worker novo, sem applications) chama
--   rpc list_team_connection_cards() ⇒ outcome='ok', item da conexão pending TRAZ full_name/
--   avatar_url/primary_role (cartão não fica sem nome).
-- V3 (DS-PII-3). Conta A (dona de empresa avaliada) e conta B (qualquer autenticado, sem
--   vínculo): rpc get_profile_reviews(<empresa-A>, 'company') ⇒ reviewer_name mascarado para
--   ambas, mas reviewer_id vem preenchido só na chamada feita pela própria conta A; para B, NULL.
-- V4. rpc get_profile_reviews(<qualquer-empresa>, 'worker') ⇒ reviewer_id continua saindo
--   (avaliador é empresa, dado público) — nenhuma mudança de comportamento aqui.
-- V5. Elenco 'accepted' segue funcionando: CompanyTeam mostra phone/pix_key normalmente
--   (listTeamMembers, que filtra 'accepted', é intocada).
--
-- DOWN (rollback — copiar/colar):
--   -- DS-PII-1: restaura o ramo 'pending' (voltar ao corpo de 20260816120000).
--   -- DS-PII-2: DROP FUNCTION IF EXISTS public.list_team_connection_cards();
--   -- DS-PII-3: restaura o corpo de get_profile_reviews de 20260821000100 (sem o CASE de
--   --           reviewer_id — reviewer_id volta a sair r.reviewer_id::text sempre).
-- ============================================================================
