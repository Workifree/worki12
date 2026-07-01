---
name: project_ouvidoria_anonima
description: "Feature de ouvidoria/denúncia anônima (SOTA) — arquitetura de anonimato, allowlist owner-only, seed manual"
metadata: 
  node_type: memory
  type: project
  originSessionId: 94f0bc03-fc28-4fa3-ac78-3a6c5f08dd0a
---

Canal de **ouvidoria anônima** para as donas (feat entregue em stg 2026-06-16). Spec em `.harness/spec/ouvidoria-anonima/spec.md`; ADR em `.harness/memory-bank/decisions/ADR-20260616-ouvidoria-anonima-acesso-owner-only.md`. Migration `supabase/migrations/20260616140000_ouvidoria_anonima.sql`.

**Anonimato é propriedade de engenharia:** tabela `ouvidoria_denuncias` não tem nenhuma coluna de identidade do remetente; insert/consulta/resposta do denunciante só via RPC `SECURITY DEFINER` que **nunca chama auth.uid()** (`criar_denuncia_ouvidoria`, `consultar_protocolo_ouvidoria`, `responder_protocolo_ouvidoria`, concedidas a anon). Frontend público usa `src/features/ouvidoria/lib/anonClient.ts` (Supabase sem sessão/JWT). Retorno de mão dupla por **protocolo `OUV-…` + senha** (bcrypt, irrecuperável).

**Acesso de leitura = allowlist `ouvidoria_acesso`** (NÃO role/permissão — `operações` vazaria; ver [[project_role_operacoes_duplicada]]). Gate via RPC `can_view_ouvidoria()`; o item de menu e a rota driblam o bypass de `isAdmin`. 

**OPERACIONAL — para uma dona ver as denúncias é preciso seed manual via SQL:**
`INSERT INTO public.ouvidoria_acesso(user_id, observacao) VALUES ('<uuid-da-dona>', 'Proprietária');`
Sem isso, NINGUÉM lê (nem admin). Rota pública: `/ouvidoria-anonima` (sem login). Painel donas: `/ouvidoria` e `/ouvidoria/:id`.

Status: implementado, testado (9 testes), tsc/eslint/build verdes, 2 reviews remediadas. **Não foi feito push/PR** ainda (aguarda ordem). Out-of-scope v1: anexos, LGPD-retenção, rate-limit avançado.
