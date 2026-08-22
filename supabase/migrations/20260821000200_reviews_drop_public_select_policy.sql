-- Migration: remove a policy permissiva remanescente de `reviews` (fecha de fato a dívida #9)
-- File: supabase/migrations/20260821000200_reviews_drop_public_select_policy.sql
--
-- POR QUE ESTA MIGRATION EXISTE (achado de verificação pós-aplicação, 21/08/2026):
--   A `20260821000100` fazia DROP POLICY de três nomes — nenhum deles era o nome real em produção.
--   O nome real é "Public view reviews", com `qual = true`, para o papel `authenticated`.
--
--   `DROP POLICY IF EXISTS` de um nome inexistente **não falha**: passa em silêncio. E policies de
--   SELECT são combinadas por **OR**, então enquanto a permissiva existisse, a restritiva
--   `reviews_select_related` não restringia nada — qualquer conta autenticada seguia lendo todas
--   as avaliações de qualquer perfil. A dívida #9 apareceria como paga com o buraco aberto, que é
--   pior do que não ter corrigido: ninguém voltaria a olhar.
--
--   Só apareceu porque a verificação consultou `pg_policies` depois de aplicar, em vez de confiar
--   no sucesso do comando. Regra registrada em `.harness/memory-bank/patterns.md`.
--
-- Article 8 intacto: só leitura. Reversível: recriar a policy com `USING (true)`.

DROP POLICY IF EXISTS "Public view reviews" ON public.reviews;
