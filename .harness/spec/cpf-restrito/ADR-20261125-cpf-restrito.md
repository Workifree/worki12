# ADR-20261125 — CPF e data de nascimento do freela fora do alcance da empresa

## Status
ACEITO (decisão do dono). Etapa 1 escrita, não aplicada. Etapa 2 em rascunho (`etapa2_trava_coluna.sql.pendente`).

## Contexto
`can_view_worker_profile` libera a **linha inteira** de `workers` para empresa com vínculo aceito ou operacional:
CPF e `birth_date` incluídos. A decisão do dono é que a empresa só precisa do CPF no recibo e no termo de serviço,
e esses dois já o leem por funções SECURITY DEFINER (`generate_service_term_on_payment`, `accept_service_term`).
RLS é por linha e não corta coluna. O site publicado (`main`) faz `select('*')` em `workers` (Dashboard, Profile),
e o onboarding faz `upsert` com `cpf`. Revogar a coluna hoje derruba as três telas do próprio freela com 42501.

## Decisão
Duas etapas, nesta ordem:
1. **Etapa 1 (aditiva, sem risco):** RPCs `get_my_worker_profile()` (lê o próprio cadastro completo) e
   `set_my_worker_identity(cpf, birth_date)` (CPF só se ainda vazio). O frontend troca `select('*')` pela RPC e tira
   `cpf`/`birth_date` do upsert do onboarding. Publicar.
2. **Etapa 2 (só depois da publicação):** privilégio por coluna. `REVOKE SELECT ON workers FROM anon, authenticated`
   e `GRANT SELECT (<todas menos cpf, birth_date>) TO authenticated`. INSERT e UPDATE ficam como estão.

## Consequências
### Positivas
- A trava fica no banco e vale para qualquer caminho (PostgREST, embed, Realtime), não só para a UI.
- Não exige mudança em termos, trilha, `anonymize_account` nem `delete-account`: todos são DEFINER de `postgres`
  ou `service_role`. Provado no PGlite (`supabase/tests/pglite-cpf/run.mjs`, 23 checagens).
- O rollback da etapa 2 é uma linha (`GRANT SELECT ON public.workers TO authenticated`).
### Negativas / Trade-offs
- **Coluna nova em `workers` nasce invisível** para `authenticated` até ganhar `GRANT SELECT (col)`. Toda migration
  que adiciona coluna em `workers` precisa disso. Fica escrito no COMMENT da coluna e na spec.
- `select('*')` em `workers` passa a falhar **também para o próprio freela**. É intencional: obriga a RPC.
- Upsert com `cpf` quebra (`ON CONFLICT DO UPDATE` lê `EXCLUDED.cpf` e exige SELECT). Por isso a etapa 1 tira o CPF.
- O CPF passa a ser travado no servidor depois de gravado (`cpf_locked`). Antes a trava era só do client.

## Alternativas rejeitadas
- **Tabela separada `worker_identity` (RLS só self):** mais forte em tese, porque coluna nova não vaza, mas exige
  backfill, reescrever `generate_service_term_on_payment`, `accept_service_term`, `bonus_worker_exclusion`,
  `anonymize_account`, a lista de colunas do `profile_trust_guard` e o upsert do onboarding, e depois dropar as
  colunas. Muito mais superfície para o mesmo efeito. Reabrir se surgir terceira coluna sensível (ex.: RG).
- **Revogar a coluna já (etapa única):** quebra o site publicado.
- **Só tirar do frontend:** a empresa continuaria lendo o CPF pela API com a própria sessão. Não atende à decisão.
- **View mascarada:** muda o nome do recurso para todos os leitores e não impede a leitura da tabela base.

## Referências
- Spec: `.harness/spec/cpf-restrito/spec.md`; integração: `.harness/spec/cpf-restrito/integracao.md`
- Migration: `supabase/migrations/20261129000100_cpf_leitura_propria.sql`
