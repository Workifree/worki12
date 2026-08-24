-- Migration: notificacao nunca chegava em tempo real
--
-- ACHADO (24/08/2026, com um freela recem-cadastrado aberto no dashboard): inseri uma notificacao
-- pelo banco, sem tocar no navegador. Seis segundos depois, nada -- nenhum badge, nenhum texto.
-- Recarreguei a pagina e o badge apareceu na hora ("1"). Ou seja: o dado estava la, e a tela so
-- descobriu porque eu mandei descobrir.
--
-- CAUSA: a publicacao `supabase_realtime` continha apenas `Conversation` e `Message`.
-- `notifications` NAO estava publicada, entao o `postgres_changes` que o NotificationContext
-- assina (schema public, table notifications, event '*') nunca recebia nada.
--
-- Efeito colateral revelador: mensagem de chat CHEGA ao vivo (Message esta publicada) e
-- notificacao nao. As duas coisas parecem "tempo real" para quem le o codigo do cliente -- a
-- assinatura existe nos dois casos. A diferenca so aparece no catalogo do banco.
--
-- POR QUE E CENTRAL NO PILOTO: a promessa do Chamado de Turno e "o primeiro que aceitar preenche,
-- mais ou menos como o Uber". Isso pressupoe que o freela SAIBA do chamado agora. Sem realtime,
-- ele so descobre quando abre o app por conta propria -- e a corrida de primeiro-aceite vira uma
-- corrida entre quem por acaso estava com o app aberto e recarregou. O mesmo vale para pedido de
-- confirmacao de vespera, registro de pagamento e indicacao.
--
-- REPLICA IDENTITY FULL: o cliente assina event '*', o que inclui UPDATE (marcar como lida) e
-- DELETE. Com RLS ligada, o Realtime precisa do registro ANTIGO para avaliar a policy nesses dois
-- casos; com replica identity default (so a PK) ele nao tem como, e o evento e descartado. A
-- tabela e pequena e so cresce por linha de aviso, entao o custo em WAL e aceitavel.
--
-- A policy de SELECT ja e `auth.uid() = user_id`, que e exatamente o que o Realtime usa para
-- filtrar por assinante: cada sessao recebe apenas as proprias notificacoes. Nada aqui alarga
-- visibilidade -- so faz o evento existir.
--
-- Article 8: nao toca saldo.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='notifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
END $$;

ALTER TABLE public.notifications REPLICA IDENTITY FULL;

COMMENT ON TABLE public.notifications IS
    'Avisos ao usuario. Publicada em `supabase_realtime` desde 20260824000700 -- ate entao a '
    'assinatura postgres_changes do NotificationContext existia no cliente mas nunca recebia '
    'evento, porque a tabela nao estava na publicacao. REPLICA IDENTITY FULL porque o cliente '
    'assina event ''*'': sem o registro antigo, o Realtime nao consegue avaliar a RLS em UPDATE '
    '(marcar como lida) e DELETE, e descarta o evento.';
