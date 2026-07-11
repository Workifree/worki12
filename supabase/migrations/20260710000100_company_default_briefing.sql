-- Migration: Briefing padrão do negócio (companies.default_briefing)
-- File: supabase/migrations/20260710000100_company_default_briefing.sql
--
-- FEATURE: a empresa cadastra UMA vez, no perfil, o briefing padrão do negócio
-- (ex.: "calça jeans, boa apresentação, barba feita, cabelo amarrado, camisa branca").
-- Ao criar um turno, esse texto vem pré-preenchido no campo Briefing, e a empresa
-- pode ajustar/incrementar por turno (ex.: "camisa verde" para estoquista).
--
-- Coluna simples de texto, sem RLS nova (herda as policies de `companies`; o dono
-- edita seu próprio registro). NÃO toca saldo/escrow.
--
-- DOWN: ALTER TABLE public.companies DROP COLUMN IF EXISTS default_briefing;

ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS default_briefing text;

COMMENT ON COLUMN public.companies.default_briefing IS
    'Briefing padrão do negócio, pré-preenchido ao criar um turno (regras da casa, dress code, apresentação). Editável por turno.';
