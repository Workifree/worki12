-- Migration: o chat mostrava toda mensagem 3 horas no futuro
--
-- ACHADO (24/08/2026, freela mandando mensagem para a empresa pela tela): relogio do navegador
-- marcava 18:41 (BRT, UTC-3) e a mensagem recem-enviada aparecia no chat como "21:40".
--
-- CAUSA: `Message.createdat` e `timestamp WITHOUT time zone` guardando valor UTC. O cliente faz
-- `format(new Date(msg.createdat), 'HH:mm')`, e o JavaScript interpreta string naive
-- ("2026-08-24 21:40:32.869") como hora LOCAL. Entao 21:40 UTC vira 21:40 BRT na tela -- tres
-- horas adiantado, para todo usuario no Brasil, em toda mensagem.
--
-- Pior que constante: o eco otimista da UI usa `new Date().toISOString()` (com Z, lido certo),
-- entao a mensagem aparece na hora CERTA ao ser enviada e PULA tres horas depois do reload. O
-- usuario ve dois horarios diferentes para a mesma mensagem.
--
-- POR QUE IMPORTA NO PILOTO: o chat e onde o turno se combina ("chego 15 minutos antes", "mudou
-- pra 18h"). Horario errado em mensagem de combinacao e alguem perdendo turno.
--
-- ESCOPO: uma varredura por colunas `timestamp without time zone` achou 14, TODAS nas tabelas
-- PascalCase do backend anterior ao pivo (ClientReview, Conversation, FreelancerReview, Job,
-- JobApplication, Message, User, WorkExperience). Dessas, apenas `Message` e `Conversation` sao
-- lidas pelo app de hoje -- as outras seis tabelas nao tem consumidor no frontend. Converto so as
-- duas em uso: mexer nas outras seria mudar tabela morta sem ninguem para verificar o efeito.
--
-- A conversao interpreta os valores existentes como UTC (`AT TIME ZONE 'UTC'`), que e o que eles
-- sao: a sessao do Supabase roda em UTC, entao `CURRENT_TIMESTAMP` gravou UTC nessas colunas.
-- Conferido no dado real antes de aplicar: a mensagem gravada as 21:40:32 tem notificacao irma
-- (`notifications.created_at`, timestamptz) as 21:40:33+00 -- mesmo instante, um com fuso, outro
-- sem.
--
-- Nenhuma policy, trigger ou indice depende dessas colunas (o trigger de notificacao le id e
-- conversationid; a ordenacao por createdat continua valendo, so muda o tipo).
--
-- Article 8: nao toca saldo.

-- Guarda: se o tipo ja tiver sido corrigido, nao faz nada (idempotente).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='Message'
           AND column_name='createdat' AND data_type='timestamp without time zone'
    ) THEN
        ALTER TABLE public."Message"
            ALTER COLUMN createdat TYPE timestamptz USING createdat AT TIME ZONE 'UTC';
        ALTER TABLE public."Message" ALTER COLUMN createdat SET DEFAULT now();
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='Conversation'
           AND column_name='createdat' AND data_type='timestamp without time zone'
    ) THEN
        ALTER TABLE public."Conversation"
            ALTER COLUMN createdat TYPE timestamptz USING createdat AT TIME ZONE 'UTC';
        ALTER TABLE public."Conversation" ALTER COLUMN createdat SET DEFAULT now();
    END IF;
END $$;

COMMENT ON COLUMN public."Message".createdat IS
    'timestamptz desde 20260824000600. Era `timestamp` sem fuso guardando UTC, e o cliente faz '
    'new Date(createdat) -- que le string naive como hora LOCAL. Resultado: todo horario do chat '
    'aparecia 3h adiantado no Brasil, e a mesma mensagem mudava de hora depois do reload (o eco '
    'otimista usava toISOString, lido certo).';
