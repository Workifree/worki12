-- Migration: as notificacoes escritas em SQL sao as unicas do produto sem acento
--
-- ACHADO (23/08/2026, exercitando recusa de chamado e SOS): o freela recusou um chamado e a
-- empresa recebeu "Ninguem aceitou o chamado". Nao e um caso isolado -- uma varredura pelos
-- literais das funcoes que escrevem em `notifications` mostrou o padrao inteiro:
--
--   claim_shift_slot         "A vaga do turno que voce recebeu foi preenchida..."
--   decline_shift_call       "Ninguem aceitou o chamado de urgencia"
--   create_sos_call          "Voce nao esta no Elenco desta empresa... boa reputacao"
--   notify_on_team_connection "...Aceitando, voce passa a receber os convites"
--   notify_on_worker_referral (ja corrigida em 20260823000700)
--
-- O frontend inteiro e acentuado; so o lado SQL nao e -- provavelmente porque quem escreveu as
-- migrations evitou nao-ASCII em arquivo .sql. O usuario nao sabe de qual camada veio o texto:
-- para ele, metade dos avisos do app e escrita errado. Uma delas (`notify_on_team_connection`)
-- fui eu que escrevi hoje, no mesmo dia; o habito se propaga sozinho.
--
-- METODO: nao reescreve corpo de funcao a mao. `claim_shift_slot` e `create_sos_call` sao RPCs
-- grandes, com maquina de estados e lock -- transcrever para trocar um acento e risco puro. O
-- bloco abaixo le a definicao do catalogo (`pg_get_functiondef`), troca o texto e recria. Cada
-- par carrega uma ASSERCAO: literal que nao for encontrado ABORTA a migration, em vez de virar um
-- no-op silencioso que faria a migration "passar" sem corrigir nada.
--
-- ORDEM IMPORTA: as frases longas vem antes das curtas. "Ninguem aceitou o chamado" e prefixo de
-- "Ninguem aceitou o chamado de urgencia" -- trocar a curta primeiro deixaria a longa orfa.
--
-- Nenhuma mudanca de logica, assinatura, volatilidade ou permissao: `CREATE OR REPLACE` a partir
-- da propria definicao vigente preserva SECURITY DEFINER, search_path, dono e GRANTs.
--
-- Article 8: nao toca saldo.

DO $$
DECLARE
    r      record;
    v_def  text;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            -- (longas primeiro)
            ('public.decline_shift_call(uuid)',
             'Todos os freelas alcancados pelo chamado de urgencia recusaram.',
             'Todos os freelas alcançados pelo chamado de urgência recusaram.'),
            ('public.decline_shift_call(uuid)',
             'Ninguem aceitou o chamado de urgencia',
             'Ninguém aceitou o chamado de urgência'),
            ('public.decline_shift_call(uuid)',
             'Ninguem aceitou o chamado',
             'Ninguém aceitou o chamado'),

            ('public.claim_shift_slot(uuid)',
             'que voce recebeu foi preenchida',
             'que você recebeu foi preenchida'),

            ('public.create_sos_call(uuid,text,text)',
             'Voce nao esta no Elenco desta empresa. Recebeu este chamado porque tem boa reputacao ',
             'Você não está no Elenco desta empresa. Recebeu este chamado porque tem boa reputação '),
            ('public.create_sos_call(uuid,text,text)',
             'e esta na mesma cidade, e voce ativou a descoberta em urgencia no seu perfil. ',
             'e está na mesma cidade, e você ativou a descoberta em urgência no seu perfil. '),
            ('public.create_sos_call(uuid,text,text)',
             'Aceitar e opcional e recusar nao tem nenhum efeito no seu perfil. Para parar de ',
             'Aceitar é opcional e recusar não tem nenhum efeito no seu perfil. Para parar de '),
            ('public.create_sos_call(uuid,text,text)',
             'Chamado de urgencia',
             'Chamado de urgência'),
            ('public.create_sos_call(uuid,text,text)',
             'urgencia" no seu perfil.',
             'urgência" no seu perfil.'),

            ('public.notify_on_team_connection()',
             ' quer te adicionar ao elenco. Aceitando, voce passa a receber os ',
             ' quer te adicionar ao elenco. Aceitando, você passa a receber os '),
            ('public.notify_on_team_connection()',
             ' aceitou seu convite e ja pode ser chamado para turnos.',
             ' aceitou seu convite e já pode ser chamado para turnos.')
        ) AS t(assinatura, de, para)
    LOOP
        v_def := pg_get_functiondef(r.assinatura::regprocedure);

        IF position(r.de IN v_def) = 0 THEN
            RAISE EXCEPTION
              'ASSERCAO: o texto "%" nao existe em % -- a funcao mudou desde a varredura. '
              'HALT: reconferir antes de aplicar, para nao gravar acento em frase errada.',
              r.de, r.assinatura;
        END IF;

        EXECUTE replace(v_def, r.de, r.para);
    END LOOP;
END $$;

-- ============================================================================
-- VERIFICACAO: nenhuma funcao que escreve em `notifications` deve sobrar com estes tokens.
--   SELECT p.proname FROM pg_proc p
--    WHERE p.pronamespace='public'::regnamespace
--      AND p.prosrc ILIKE '%INSERT INTO public.notifications%'
--      AND p.prosrc ~ '''[^'']*\y(Ninguem|voce|Voce|reputacao|urgencia|alcancados)\y[^'']*''';
--   -- ESPERADO: zero linhas.
-- DOWN: nao ha -- reverter seria regravar texto errado.
-- ============================================================================
