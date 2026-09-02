-- Migration: recusa NEUTRA de convite de elenco (achado P1 da avaliacao heuristica do freela)
--
-- O botao "Recusar" da Carteira de Clientes gravava `status='blocked'` — o VETO permanente e
-- indelevel (a empresa nunca mais pode reconvidar, por policy de DELETE). Nao era escolha da UI:
-- `team_connections` NAO TINHA policy de DELETE para o worker — bloquear era literalmente a unica
-- acao possivel sobre um convite indesejado.
--
-- Isso contradiz o principio de recusa neutra que o resto do produto ja segue com todas as letras:
-- `decline_shift_call` e neutra (R6/R7 do F1), `decline_worker_referral` e neutra (F10), e o card
-- de convite de turno diz "Recusar nao afeta sua reputacao". So o convite de ELENCO punia — e no
-- piloto, um freela que recusa por agenda cheia hoje vetaria a empresa para sempre sem saber.
--
-- A policy nova permite ao worker APAGAR a propria linha SOMENTE enquanto pendente:
--   - recusa neutra = convite some; a empresa pode reconvidar amanha;
--   - o VETO continua existindo como acao explicita (status='blocked', fluxo inalterado);
--   - conexao ACEITA nao e deletavel pelo worker ("sair" continua sendo o fluxo documentado de
--     bloqueio, com aviso de permanencia na UI) — o escopo `status='pending'` garante.
--
-- Article 8: nao toca saldo.

CREATE POLICY "tc_delete_worker_pending"
    ON public.team_connections
    FOR DELETE
    TO authenticated
    USING (worker_id = (SELECT auth.uid()) AND status = 'pending');
