-- Migration: seis gatilhos engoliam erro sem deixar rastro
--
-- CONTEXTO (24/08/2026, as vesperas do piloto): duas vezes nesta sessao um `EXCEPTION WHEN OTHERS
-- THEN RETURN` mudo escondeu defeito real em producao por tempo indeterminado --
-- `notify_new_message` com um `text = uuid` que zerava TODA notificacao de chat
-- (20260823000600), e `notify_on_worker_referral` na mesma familia (20260823000700). Nos dois
-- casos a politica de nao derrubar a transacao estava certa; o que estava errado era engolir o
-- MOTIVO junto com o erro.
--
-- No piloto isso pesa mais: quando algo falhar com gente de verdade usando, a diferenca entre
-- "temos um WARNING no log apontando a funcao e o SQLSTATE" e "nao aconteceu nada e ninguem sabe
-- por que" e a diferenca entre corrigir no mesmo dia e descobrir semanas depois.
--
-- Estas seis passam a emitir RAISE WARNING antes do RETURN. NENHUMA muda de comportamento: o
-- WARNING nao aborta transacao, nao muda o valor devolvido, nao aparece para o usuario final.
--
-- FORA DO ESCOPO, com motivo:
--   - `request_header`: le `request.headers` e devolve NULL quando o cabecalho falta ou o JSON e
--     invalido. Ali engolir E o comportamento correto -- nao ha erro, ha ausencia. Emitir WARNING
--     transformaria operacao normal em ruido de log.
--
-- Article 8: nao toca saldo.

DO $$
DECLARE
    alvo   text;
    v_def  text;
    v_novo text;
BEGIN
    FOREACH alvo IN ARRAY ARRAY[
        'public.cancel_referrals_on_block()',
        'public.notify_counterpart_on_application_cancel()',
        'public.notify_worker_on_shift_payment()',
        'public.update_company_rating_on_review()',
        'public.update_worker_completion_aggregates()',
        'public.update_worker_rating_on_review()'
    ]
    LOOP
        v_def := pg_get_functiondef(alvo::regprocedure);

        IF v_def !~* 'EXCEPTION\s+WHEN\s+OTHERS\s+THEN' THEN
            RAISE EXCEPTION
              'ASSERCAO: % nao tem o bloco EXCEPTION WHEN OTHERS esperado -- reconferir antes de '
              'reescrever.', alvo;
        END IF;

        -- Sem retrovisao de grupo: o WARNING entra logo depois do THEN, e o que vinha em seguida
        -- (comentario ou RETURN) segue intacto. Retrovisao com  nao serve aqui -- nesta conexao
        -- standard_conforming_strings esta OFF e a sequencia vira byte de controle, o que quebrou
        -- as duas primeiras tentativas desta migration.
        v_novo := regexp_replace(
            v_def,
            'EXCEPTION\s+WHEN\s+OTHERS\s+THEN',
            'EXCEPTION WHEN OTHERS THEN' || chr(10) ||
            '    RAISE WARNING ''' || split_part(alvo, '(', 1) ||
            ' engoliu um erro: % %'', SQLSTATE, SQLERRM;',
            'i');

        IF v_novo !~ 'RAISE WARNING' THEN
            RAISE EXCEPTION 'ASSERCAO: a substituicao nao inseriu o WARNING em %. HALT.', alvo;
        END IF;

        EXECUTE v_novo;
    END LOOP;
END $$;
