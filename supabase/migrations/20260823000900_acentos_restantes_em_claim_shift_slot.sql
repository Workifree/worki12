-- Migration: os dois textos de `claim_shift_slot` que a leva anterior nao pegou
--
-- Complemento de 20260823000800. Aquela migration corrigiu o acento das notificacoes escritas em
-- SQL, mas o INVENTARIO que a alimentou estava incompleto: eu extraia os literais com
-- `regexp_matches(prosrc, '''([^'']{...})''', 'g')`, e esse metodo sai de fase quando o corpo tem
-- aspas escapadas ('') ou dollar-quoting -- alguns literais passam a ser lidos como o texto ENTRE
-- literais e somem da lista, em silencio.
--
-- Quem denunciou foi a propria verificacao da migration anterior ("nenhuma funcao deve sobrar com
-- estes tokens"), que continuou apontando `claim_shift_slot`. Trocando o detector por uma busca no
-- fonte inteiro, apareceram os dois textos que faltavam -- ambos no ramo que avisa quem PERDEU a
-- corrida do chamado:
--
--   'Nada muda para voce — este era um chamado de urgencia, nao um convite do Elenco.'
--   'Voce continua no elenco e recebe os proximos chamados normalmente.'
--
-- Sao justamente as frases que consolam quem perdeu a vaga. Aparecem para todo freela que responde
-- um chamado depois do primeiro aceite -- em disparo 1->N, a maioria.
--
-- Licao registrada junto: para inventariar texto dentro de funcao plpgsql, buscar no fonte e ler o
-- contexto; nao confiar em pareamento de aspas.
--
-- Mesma mecanica da anterior: le a definicao do catalogo, troca, recria. Assercao por par.
--
-- Article 8: nao toca saldo.

DO $$
DECLARE
    r     record;
    v_def text;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('public.claim_shift_slot(uuid)',
             'Nada muda para voce — este era um chamado de urgencia, nao um convite do Elenco.',
             'Nada muda para você — este era um chamado de urgência, não um convite do Elenco.'),
            ('public.claim_shift_slot(uuid)',
             'Voce continua no elenco e recebe os proximos chamados normalmente.',
             'Você continua no elenco e recebe os próximos chamados normalmente.')
        ) AS t(assinatura, de, para)
    LOOP
        v_def := pg_get_functiondef(r.assinatura::regprocedure);

        IF position(r.de IN v_def) = 0 THEN
            RAISE EXCEPTION
              'ASSERCAO: o texto "%" nao existe em % -- reconferir antes de aplicar.',
              r.de, r.assinatura;
        END IF;

        EXECUTE replace(v_def, r.de, r.para);
    END LOOP;
END $$;

-- ============================================================================
-- VERIFICACAO (a mesma da 000800, agora tem de vir vazia):
--   SELECT p.proname FROM pg_proc p
--    WHERE p.pronamespace='public'::regnamespace
--      AND p.prosrc ILIKE '%INSERT INTO public.notifications%'
--      AND p.prosrc ~ '\y(voce|Voce|Ninguem|reputacao|urgencia|alcancados)\y';
--   -- ESPERADO: zero linhas.
-- ============================================================================
