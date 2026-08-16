# Aplicação em produção — 16/08/2026 (revisão pré-piloto)

As migrations desta leva foram aplicadas em **produção** (`vrklakcbkcsonarmhqhp`) via MCP do
Supabase, uma por vez, com verificação read-only após cada uma.

## Divergência de versão entre repositório e banco

O MCP registra a versão pelo **timestamp da aplicação**, não pelo nome do arquivo. Por isso o
histórico do banco não bate com o nome dos arquivos. Mapeamento real:

| Arquivo no repositório | Versão registrada no banco |
|---|---|
| `20260816000000_team_connections_delete_guard_blocked.sql` | `20260816200842` |
| `20260816120000_workers_select_by_relationship.sql` (§1-2, índices + função) | `20260816200913` |
| `20260816120000_workers_select_by_relationship.sql` (§3-4, policy + grants) | `20260816201034` |
| `20260816130000_profile_reviews_reader.sql` | `20260816201114` |
| `20260816140000_notify_worker_on_shift_payment.sql` | `20260816201238` |
| `20260816150000_notify_counterpart_on_application_cancel.sql` | `20260816201303` |
| `20260816201322_notify_worker_shift_payment_acentos.sql` | `20260816201322` |
| `20260816201420_revoke_anon_execute_definer_functions.sql` | `20260816201420` |
| `20260816201457_restore_execute_authenticated_trigger_functions.sql` | `20260816201457` |

A `20260816120000` foi **aplicada em dois passos de propósito**: criar a função primeiro permitiu
testá-la contra dados reais antes de trocar a policy, eliminando a janela em que produção poderia
ficar com a policy errada. O arquivo no repositório continua único e idempotente.

Todas as migrations usam `DROP ... IF EXISTS` / `CREATE OR REPLACE` / `IF NOT EXISTS`, então
reaplicá-las (ex.: `supabase db reset` num banco novo) converge para o mesmo estado. A divergência
de numeração é ruído de histórico, não risco de estado.

## Verificações executadas contra dados reais

Base no momento da aplicação: 15 workers, 7 empresas, 4 vínculos de elenco ativos, 13 applications,
4 pagamentos, 8 avaliações.

| Verificação | Resultado |
|---|---|
| `tc_delete_company` com guarda de `blocked` | policy confirmada em `pg_policies` |
| `can_view_worker_profile` nos 4 vínculos reais | `true` nos 4 |
| freela lendo o próprio perfil | `true` |
| empresa sem relação nenhuma com o freela | `false` (5 pares) |
| freela lendo outro freela | `false` (3 pares) |
| policy `USING (true)` em `workers` | **removida** — varredura de CPF/PIX fechada |
| `get_profile_reviews`, freela terceiro | `"Luiz R."` (mascarado) |
| `get_profile_reviews`, dono do perfil | `"Luiz Guilherme Barreto dos Reis"` (completo) |
| trigger de pagamento (INSERT real, com rollback) | notificação correta gerada, rollback limpo |
| `trg_notify_company_on_worker_cancel` (bug de atribuição) | **removido**, substituído |
| `EXECUTE` para `anon` nas 5 funções novas | `false` em todas |
| advisor de segurança (lint 0028) | fechado para os objetos desta leva |

## Lacuna declarada

O branch **"vínculo operacional"** de `can_view_worker_profile` (empresa que tem `applications` do
freela, sem elenco) **não foi exercitado**: na base atual, todo par com `application` também tem
`team_connections`, então o branch de elenco curto-circuita antes. A lógica é estruturalmente
idêntica à testada, mas isso é inferência, não verificação. Vale um teste manual no piloto:
convidar um freela para um turno **sem** adicioná-lo ao elenco e confirmar que a empresa
continua vendo o perfil dele.

## Pendências pré-existentes (fora desta leva, NÃO corrigidas)

O advisor reporta outros achados anteriores a este trabalho, entre eles um `ERROR`
`policy_exists_rls_disabled` e funções legadas sem `search_path` fixo (`handle_new_user`,
`increment_worker_view`, `reserve_escrow`, `release_escrow`, `update_wallet_balance` e outras).
Não foram tocados: mexer em RLS de tabela legada ou em RPC de saldo exige gate do architect
(Article 8) e está fora do escopo da revisão pré-piloto.
