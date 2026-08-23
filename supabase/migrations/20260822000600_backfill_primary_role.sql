-- Migration: backfill de workers.primary_role a partir da primeira especialidade declarada
--
-- ACHADO (22/08/2026, navegando o produto no browser): o onboarding do freela pergunta
-- "QUAIS SUAS ESPECIALIDADES?" e grava a resposta em `workers.roles` — mas NENHUMA tela da
-- empresa lê `roles`. Todas exibem `primary_role`: MemberCard, PendingCard, ShiftCallModal,
-- InviteSeriesModal, CompanyCreateJob, CompanyJobCandidates e CompanyDashboard. E `primary_role`
-- só era escrito na pagina de Perfil.
--
-- Efeito medido em producao no dia do achado:
--   16 freelas | 13 sem primary_role | 11 declararam especialidade e a empresa NAO via nada
--
-- Alem de aparecerem sem funcao no Elenco, esses freelas sumiam da BUSCA POR FUNCAO do
-- ShiftCallModal, que filtra por `primary_role` — ou seja, a empresa que digitasse "garcom" para
-- montar um chamado nao encontrava quem se declarou garcom no cadastro.
--
-- O onboarding passou a gravar `primary_role` (mesmo commit). Esta migration cuida de quem JA se
-- cadastrou: sem ela, os 11 continuariam invisiveis para sempre, porque ninguem volta ao Perfil
-- para preencher um campo que nao sabe que existe.
--
-- CONSERVADORA de proposito:
--   * so toca quem tem `primary_role` NULL ou vazio — nunca sobrescreve escolha existente;
--   * so age quando ha especialidade declarada;
--   * usa a PRIMEIRA do array, mesma regra do onboarding a partir de agora, para os dois
--     caminhos nao divergirem;
--   * `roles` e jsonb (nao text[]) — `->>0` extrai o primeiro elemento como texto.
--
-- Idempotente: rodar de novo nao encontra mais ninguem no predicado.
-- Article 8: nao toca saldo.

UPDATE public.workers
   SET primary_role = roles->>0
 WHERE (primary_role IS NULL OR btrim(primary_role) = '')
   AND jsonb_typeof(roles) = 'array'
   AND jsonb_array_length(roles) > 0
   AND nullif(btrim(coalesce(roles->>0, '')), '') IS NOT NULL;

-- Verificacao: depois desta migration, ninguem pode ter especialidade declarada e continuar sem
-- funcao visivel para a empresa.
DO $$
DECLARE v_orfaos integer;
BEGIN
    SELECT count(*) INTO v_orfaos
      FROM public.workers
     WHERE (primary_role IS NULL OR btrim(primary_role) = '')
       AND jsonb_typeof(roles) = 'array'
       AND jsonb_array_length(roles) > 0
       AND nullif(btrim(coalesce(roles->>0, '')), '') IS NOT NULL;

    IF v_orfaos > 0 THEN
        RAISE EXCEPTION
          'ASSERCAO: % freela(s) continuam com especialidade declarada e sem primary_role. '
          'O backfill nao cobriu algum formato de `roles`. HALT.', v_orfaos;
    END IF;
    RAISE NOTICE 'Backfill de primary_role concluido: nenhum freela ficou sem funcao visivel.';
END $$;

-- ============================================================================
-- DOWN: nao ha reversao automatica, e e deliberado. O valor anterior era NULL/vazio, entao
-- "reverter" seria apagar informacao correta que o freela declarou. Se for mesmo necessario,
-- o predicado inverso e:
--   UPDATE public.workers SET primary_role = NULL
--    WHERE primary_role = roles->>0;
-- ...mas isso tambem apagaria quem escolheu no Perfil um valor igual ao primeiro de `roles`.
-- ============================================================================
