-- Seed: contexto global do negócio para agentes estratégicos
-- Rodar: npx supabase db execute --project-ref vrklakcbkcsonarmhqhp -f scripts/seed-agent-memory.sql

INSERT INTO agent_memory (plan_name, category, key, value, updated_by) VALUES
(NULL, 'business_context', 'product', '{
  "name": "Worki",
  "type": "freelance marketplace",
  "market": "Brazil",
  "target_workers": ["garcom", "cozinheiro", "barman", "atendente", "limpeza", "recepcionista", "promotor", "entregador", "seguranca"],
  "target_companies": ["bares", "restaurantes", "eventos", "buffets", "hoteis"],
  "stage": "MVP completo, pre-launch, 0 usuarios reais",
  "domain": "worki.com.br",
  "stack": "React 19 + Vite + TypeScript + Supabase + Asaas"
}'::jsonb, 'seed'),

(NULL, 'business_context', 'pricing', '{
  "company_deposit_fee_pct": 8,
  "company_deposit_fee_fixed_brl": 4.00,
  "worker_withdrawal_fee_pct": 5,
  "worker_withdrawal_fee_fixed_brl": 3.00,
  "combined_take_rate_pct": 13,
  "minimum_deposit_brl": 50,
  "minimum_withdrawal_brl": 5,
  "payment_methods": ["PIX", "credit_card", "boleto"]
}'::jsonb, 'seed'),

(NULL, 'business_context', 'brand', '{
  "worker_color": "#00A651",
  "company_color": "#2563EB",
  "style": "neo-brutalist",
  "language": "pt-BR",
  "tone": "direto, profissional, acessivel"
}'::jsonb, 'seed'),

(NULL, 'business_context', 'payment_provider', '{
  "provider": "Asaas",
  "model": "central_wallet_no_subaccounts",
  "environment": "sandbox",
  "capabilities": ["PIX_deposit", "PIX_withdrawal", "credit_card", "boleto"],
  "escrow": "virtual_db_level_not_asaas_native",
  "webhook": "asaas-webhook (deploy with --no-verify-jwt)"
}'::jsonb, 'seed'),

(NULL, 'business_context', 'infrastructure', '{
  "database": "Supabase PostgreSQL with RLS",
  "auth": "Supabase Auth",
  "edge_functions": 10,
  "hosting": "Netlify staging, Vercel configured",
  "monitoring": "Sentry",
  "email": "Resend",
  "supabase_project_ref": "vrklakcbkcsonarmhqhp"
}'::jsonb, 'seed'),

(NULL, 'config', 'guardrails', '{
  "max_emails_per_task": 50,
  "max_emails_per_day": 100,
  "require_ceo_approval": ["strategic_decisions", "tactical_plans"],
  "auto_execute": ["operational_tasks_within_guardrails"],
  "never_auto": ["financial_mutations", "code_deployment", "schema_changes", "public_content_publish"]
}'::jsonb, 'seed')

ON CONFLICT (plan_name, category, key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_by = EXCLUDED.updated_by,
  updated_at = NOW();
