-- FIX CRÍTICO: mensageria 100% quebrada em produção.
--
-- A tabela "Message" (herdada do Prisma) tinha a FK "fk_message_sender"
-- (originalmente "Message_senderId_fkey") apontando para "public"."User"(id).
-- A tabela "User" é legada e está VAZIA em produção, então TODO insert de
-- mensagem falhava com:
--   23503: insert or update on table "Message" violates foreign key
--          constraint "fk_message_sender" — Key is not present in table "User".
--
-- A coluna senderid guarda o auth.uid() (TEXT) e já é protegida por RLS
-- (senderid = auth.uid()::text), portanto a FK para a tabela morta só quebra.
-- Removemos as constraints legadas para destravar o chat worker <-> empresa.

ALTER TABLE "public"."Message" DROP CONSTRAINT IF EXISTS "fk_message_sender";
ALTER TABLE "public"."Message" DROP CONSTRAINT IF EXISTS "Message_senderId_fkey";
