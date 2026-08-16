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

---

# Segunda leva — RLS que nunca foi ligada (mesmo dia)

## A descoberta que muda o método

Rodando o advisor de segurança **depois** de aplicar a primeira leva, apareceu que
`public.jobs` e `public.Conversation` tinham policies mas **RLS desligada** — policies que
nunca foram avaliadas.

Causa raiz, provada por contagem de policies pelo `harness-architect`: a migration
`20260309000000_enable_rls_all_tables.sql` **nunca teve efeito em produção**. Ela cria 4
policies em `jobs`; produção tinha 2, e são de outra migration. Alguém ligou RLS **à mão pelo
dashboard**, tabela por tabela, e passou por `jobs` e `Conversation`. Duas migrations depois
rodaram `FORCE ROW LEVEL SECURITY` — que **sem `ENABLE` é no-op**.

**Consequência para o processo: o repositório de migrations não é a fonte da verdade do
estado de produção. Só o catálogo é.** Toda revisão de segurança deve começar por um censo
de `pg_class.relrowsecurity` + `has_table_privilege`, nunca por leitura de arquivo. Os
reviewers desta sessão liam as policies nos arquivos e concluíam que a tabela estava
protegida — inclusive afirmando por escrito que "a defesa real está no RLS" para
`Conversation`.

## Impacto do buraco de `jobs`

`authenticated` tinha `UPDATE` e `DELETE` em **qualquer** turno de qualquer empresa. Como
`PATCH /rest/v1/jobs` sem filtro atinge todas as linhas, um request tornava o atacante dono
de toda a base. E `jobs.company_id` ancora **cinco** caminhos de autorização — entre eles a
função `can_view_worker_profile`, aplicada horas antes: reescrever um turno dava acesso a
CPF, data de nascimento, telefone e chave PIX de todo freela com candidatura.

Aresta de Article 8 identificada e fechada junto: `jobs.budget` era gravável por terceiros e
é o valor que `auto_reserve_escrow_on_hire` passa a `reserve_escrow` no fluxo pull legado.

## Aplicado

| Versão | O quê |
|---|---|
| `enable_rls_jobs` | RLS em `jobs` + 4 policies com ancoragem dupla. **SELECT mantido `USING (true)`** de propósito — o vetor é escrita, e apertar SELECT no mesmo passo mudaria em silêncio as policies de `applications`, `Conversation` e `Message`, que fazem subquery em `jobs`. Um passo, uma variável. |
| `lockdown_legacy_prisma_tables` | `FreelancerReview`, `ClientReview`, `_FreelancerProfileToSkill`, `_JobToSkill`: RLS sem policy (deny-all) + `REVOKE` de `anon`/`authenticated`. As 4 estavam **vazias** e sem call site — não houve exposição real, mas tinham `anon` com `SELECT` **e `INSERT`**. Trancadas, não dropadas. |
| `enable_rls_conversation_message` | RLS em `Conversation` + `REVOKE` de `anon` nas duas tabelas do chat + a policy de UPDATE que faltava em `Message`. |

**Não** foram reaproveitadas as policies legadas de `jobs`: `"Company owner can manage jobs"`
ancora só em `companies.owner_id`, e se algum registro tiver `owner_id` NULL (bug histórico
cujo backfill pode não ter rodado — mesmo motivo) a empresa perderia os próprios turnos no
instante em que a RLS ligasse. As novas usam ancoragem dupla.

## O censo respondeu duas perguntas em aberto

- **`Message` já tinha RLS ligada com 4 policies** — o pior cenário (conteúdo das mensagens
  aberto a `anon`) **não se aplicava**. Só a metadata de `Conversation` estava exposta.
- **`Message` não tinha policy de UPDATE**, com RLS ligada. Ou seja: o `read_at` gravado por
  `Messages.tsx:56` afetava **0 linhas, em silêncio** — o recibo de leitura do chat já estava
  quebrado em produção. A migration corrige.

Mantidas de propósito as duas policies antigas de `Message`
(`"Users can view/insert messages in their conversations"`): são permissivas e logicamente
idênticas às novas, então servem de rede de segurança caso `can_access_conversation` tenha
defeito. Limpeza pós-piloto.

## Verificações executadas (produção, com `BEGIN`/`ROLLBACK`)

| Verificação | Resultado |
|---|---|
| Empresa vê os próprios 13 turnos | 13 (igual ao baseline) |
| Empresa edita os próprios turnos | 13 linhas afetadas |
| **Freela tenta reescrever TODOS os turnos** | **0 linhas** (antes: 16) |
| Freela participante vê a conversa | 1 |
| Empresa participante vê a conversa | 1 |
| Terceiro autenticado vê a conversa | 0 |
| `anon` lê `Conversation` | `ERROR 42501: permission denied` |
| Tabelas em `public` com RLS desligada | **nenhuma** |

## Pendente — teste manual obrigatório

**O Realtime da mensageria não é provável por SQL.** Ele passa a respeitar RLS a partir desta
leva. Antes de considerar o chat liberado: abrir a conversa nos dois lados, enviar uma
mensagem de cada, confirmar que aparece em tempo real e que o contador de não-lidas zera
(este último exercita a policy de `read_at`, que **nunca funcionou** antes).

## Pendências pré-existentes (fora desta leva, NÃO corrigidas)

O advisor reporta outros achados anteriores a este trabalho, entre eles um `ERROR`
`policy_exists_rls_disabled` e funções legadas sem `search_path` fixo (`handle_new_user`,
`increment_worker_view`, `reserve_escrow`, `release_escrow`, `update_wallet_balance` e outras).
Não foram tocados: mexer em RLS de tabela legada ou em RPC de saldo exige gate do architect
(Article 8) e está fora do escopo da revisão pré-piloto.
