-- Migration: quem perdia a corrida da vaga ouvia "voce ja respondeu"
--
-- ACHADO (24/08/2026, testando a garantia central do produto): montei um turno de UMA vaga com
-- chamado para DOIS freelas e fiz os dois aceitarem. O resultado material esta correto -- A levou
-- a vaga, B nao entrou, 1 contratado para 1 vaga, sem duplo agendamento.
--
-- O que esta errado e o que B ouve. `claim_shift_slot` faz:
--     IF v_target_resp IS NOT NULL THEN RETURN 'already_responded'
-- e o alvo de B ja estava com response='closed' -- valor que o SISTEMA escreveu quando A levou a
-- vaga, nao uma resposta de B. B, que acabou de tocar em ACEITAR, recebe na tela:
--     "Voce ja respondeu a este chamado."
-- Falso, e soa como acusacao.
--
-- A mensagem CERTA ja existe no cliente, para o outcome 'filled':
--     "Outro freela aceitou primeiro. Voce continua no elenco e recebe os proximos."
-- Ela era inalcancavel na corrida, que e justamente o caso para o qual foi escrita.
--
-- Isso importa mais do que parece no piloto: o disparo 1->N so funciona se perder for barato e
-- explicado. O codebase inteiro cuida disso -- ha comentario explicito no painel dizendo para
-- nunca escrever "perdeu"/"ficou de fora" -- e a mensagem no momento exato da derrota era a unica
-- fora do padrao.
--
-- 'closed' passa a devolver o desfecho do CHAMADO (filled | cancelled | expired), os tres ja
-- tratados por `messageForOutcome` no cliente. 'accepted'/'declined' continuam em
-- 'already_responded', que ai e verdade: a pessoa respondeu mesmo.
--
-- Article 8: nao toca saldo.

DO $$
DECLARE
    v_def   text;
    v_novo  text;
    v_padrao text := 'IF v_target_resp IS NOT NULL THEN\s*\n\s*RETURN jsonb_build_object\(''outcome'', ''already_responded'', ''response'', v_target_resp\);\s*\n\s*END IF;';
BEGIN
    v_def := pg_get_functiondef('public.claim_shift_slot(uuid)'::regprocedure);

    IF v_def !~ v_padrao THEN
        RAISE EXCEPTION
          'ASSERCAO: o ramo de already_responded nao esta como esperado em claim_shift_slot. '
          'A funcao mudou -- reconferir antes de reescrever.';
    END IF;

    v_novo := regexp_replace(v_def, v_padrao,
$novo$IF v_target_resp IS NOT NULL THEN
        -- 'closed' NAO e resposta da pessoa: o sistema fechou a tentativa quando o chamado
        -- terminou. Devolver o desfecho real, para o cliente poder dizer "outro aceitou primeiro"
        -- em vez de "voce ja respondeu" a quem acabou de tocar em ACEITAR.
        IF v_target_resp = 'closed' THEN
            RETURN jsonb_build_object('outcome',
                CASE v_call.status
                    WHEN 'cancelled' THEN 'cancelled'
                    WHEN 'expired'   THEN 'expired'
                    ELSE 'filled'
                END);
        END IF;
        RETURN jsonb_build_object('outcome', 'already_responded', 'response', v_target_resp);
    END IF;$novo$);

    IF v_novo !~ 'v_target_resp = ''closed''' THEN
        RAISE EXCEPTION 'ASSERCAO: a substituicao nao produziu o ramo de closed. HALT.';
    END IF;

    EXECUTE v_novo;
END $$;

COMMENT ON FUNCTION public.claim_shift_slot(uuid) IS
    'Aceite de chamado, com lock em `jobs` (o recurso escasso e o turno, nao o chamado). Alvo com '
    'response=''closed'' recebe o desfecho do chamado (filled/cancelled/expired) desde '
    '20260824000800 -- antes recebia ''already_responded'', que dizia "voce ja respondeu" a quem '
    'nunca respondeu: ''closed'' e escrito pelo sistema quando outro leva a vaga.';
