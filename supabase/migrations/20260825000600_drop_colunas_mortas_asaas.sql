-- Migration: débito #19 lote B — nove colunas do cadastro de `customer` do Asaas
--
-- `address`, `address_number`, `postal_code`, `province`, `income_value` em `workers`;
-- `postal_code`, `address_number`, `province`, `income_value` em `companies`.
--
-- Campo a campo, é o cadastro de cliente da API do Asaas. Nunca foram escritas a partir destas
-- tabelas, e a pausa do processamento de pagamento (ADR-20260822) torna a hipótese remota.
-- Conferido em 25/08/2026: ZERO valores não-nulos nas nove, e ZERO referências no frontend e nas
-- edge functions.
--
-- POR QUE DERRUBAR, E NÃO SÓ DEIXAR VAZIO: coluna que não existe não pode ser preenchida por
-- acidente. Enquanto existirem, endereço residencial e renda declarada seguem sendo campos válidos
-- de escrita para o próprio titular -- dado sensível que o produto não coleta, não usa e não
-- declara na política. É a única defesa que não depende de alguém lembrar de classificar.
--
-- ⚠️ `companies.address` FICA. Não é do lote: é exibida no perfil público da empresa
-- (`/empresa/:id`) e na Carteira de Clientes. Só o endereço do FREELA sai.
--
-- Também ficam de fora, apesar de aparecerem na lápide de anonimização: `workers.goal`,
-- `companies.company_type` e `companies.size` -- o onboarding escreve nas três hoje. Apagá-las na
-- exclusão de conta é certo; derrubá-las quebraria o produto.
--
-- Article 8: não toca saldo.

ALTER TABLE public.workers
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS address_number,
  DROP COLUMN IF EXISTS postal_code,
  DROP COLUMN IF EXISTS province,
  DROP COLUMN IF EXISTS income_value;

ALTER TABLE public.companies
  DROP COLUMN IF EXISTS postal_code,
  DROP COLUMN IF EXISTS address_number,
  DROP COLUMN IF EXISTS province,
  DROP COLUMN IF EXISTS income_value;

NOTIFY pgrst, 'reload schema';
