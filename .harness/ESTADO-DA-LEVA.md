# Estado da leva pós-entrevista (F5–F13 + dívidas)

> Atualizado em 21/08/2026. Fonte única de verdade de onde cada coisa está.
> Regra: nada sai deste quadro sem estar **em produção** ou **explicitamente descartado**.

## Legenda
✅ pronto · 🔄 em andamento · ⏸️ parado esperando decisão do owner · ❌ reprovado, com correção em curso

---

## 1. Já em PRODUÇÃO (aplicado e verificado no catálogo)

| O quê | Quando | Verificação |
|---|---|---|
| **F1–F4** (chamado de turno, listas, escala recorrente, véspera) | leva anterior | migrations aplicadas |
| **F5** guarda de risco de vínculo | 21/08 | 2 colunas + 2 funções |
| **F6** termo de prestação | 21/08 | tabela + RLS + policy |
| **F7** disponibilidade declarada | 21/08 | coluna + CHECK |
| **F8** certificações e treinamentos | 21/08 | 2 tabelas + 7 policies + cron |
| **Dívida #9** `reviews` escopado por vínculo | 21/08 | policy única de SELECT (exigiu 2 tentativas — ver `patterns.md`) |
| Frontend F5–F8 | 21/08 | `worki-opal.vercel.app`, verificado por chunk |

## 2. ✅ F9–F12 — commitadas, mergeadas em `main`, migrations APLICADAS

PR #216 mergeado. Migrations `20260821000300` (DS-PII), `20260817001400` (F12), `001500` (F10) e
`001600` (F11) aplicadas e **verificadas no catálogo**.

**V8 do SOS (gate de não-subida) PASSOU:** `claim_shift_slot` preserva a checagem de
`jobs.status='deleted'` e o lock continua em `jobs`. O trigger de `origin` é **BEFORE** — se virasse
AFTER, as duas policies novas deixariam de valer em silêncio.

### 🔴 PENDENTE: deploy do frontend NÃO entrou

`api.vercel.com` está inalcançável desta máquina (`curl` devolve `000`; `vercel.com` e GitHub
respondem). O bundle no ar continua sendo `index-BLTg-_4j.js`, o mesmo da leva F5–F8 — nenhuma tela
nova está publicada.

**Isso não quebrou nada** (a ordem migration-antes-do-frontend foi respeitada), **mas há uma janela
de risco aberta:**

> O frontend no ar ainda usa o embed `worker:workers(...)` em `listAllConnections`, que a DS-PII
> esvaziou para linhas `pending`. Hoje há **0 conexões pendentes**, então nada acontece. Se alguém
> criar um convite antes do deploy, o cartão aparece **sem o nome do freela e sem erro nenhum** —
> exatamente a falha silenciosa que `list_team_connection_cards()` existe para evitar.

**Ação:** rodar `npx vercel --prod` **da raiz** quando a API voltar, e verificar o chunk no ar (não
o hash do build local, que nunca bate). Ver `[[vercel-deploy-setup]]` na memória.

## 3. ⏸️ PARADO ESPERANDO DECISÃO DO OWNER

| # | O quê | O que precisa ser decidido |
|---|---|---|
| **H1** | Exclusão de conta | O que "excluir conta" passa a significar; prazo de retenção de `shift_payments`/`service_terms`; texto da política dizendo que o termo aceito é retido **com nome e CPF** |
| **H2** | FKs CASCADE para `auth.users` | Remover em `workers`/`companies`/`wallets` (aceita linhas órfãs por construção) |
| **F13** | Multi-unidade / gerente | Empresa cria a credencial do gerente **ou** convida conta própria? (architect recomenda: conta própria + convite de 7 dias) |
| **SOS** | Ligar em produção | Parecer jurídico/LGPD do consentimento — **incluindo CPF**, ver dívida #13 |

**Migration de anonimização (`20260821000000`) está escrita, revisada e PARADA.** Não aplicar sem H1+H2.

## 4. ✅ Correção de segurança — APLICADA EM PRODUÇÃO (21/08)

**Dívida #15 — o uuid do freela é credencial de PII.** `get_profile_reviews` entrega uuids de
freelas a qualquer conta autenticada; com o uuid, insere-se `team_connections` em `'pending'`
(gesto unilateral da empresa) e lê-se CPF/telefone/PIX/nascimento.

**Aplicada e verificada no catálogo** (`20260821000300`), não no `{"success":true}`:
`can_view_worker_profile` não menciona mais `'pending'` e só concede por `accepted`;
`list_team_connection_cards` existe, é DEFINER e **sem parâmetro**; `get_profile_reviews` anula
`reviewer_id` para terceiro; **`anon` não tem EXECUTE em nenhuma das três**.

Raio medido antes de aplicar: **0 conexões pendentes** (nada quebrou), **2 uuids expostos**.

Pendente: `V1–V5` da própria migration contra dado real, e o **frontend correspondente ainda não
foi deployado** — `listAllConnections` já chama a RPC nova no código, mas o que está no ar ainda
usa o embed. Não quebra (o embed só perde o `worker` de linhas pending, e não há nenhuma), mas o
deploy fecha o par.

## 5. Dívidas registradas (`debitos-pre-piloto.md`)

| # | Gravidade | Resumo |
|---|---|---|
| 1 | Alta | Política de Privacidade não declara `service_terms` nem `availability_days` |
| 2 | Média | CHECK aceita `{}` em `availability_days` (garantia mora no client) |
| 3 | Média | `/profile` sem campo de CPF — `missing_cpf` do F6 não tem saída |
| 4 | Baixa | `GRANT UPDATE` amplo em `service_terms` |
| 5 | 🔴 Alta | `delete-account` quebrado (CASCADE × RESTRICT) — **pré-existente** |
| 6 | Média | Aceite do termo garantido só pela UI |
| 7 | Baixa | Resíduos do aceite (gate no `disabled`, banner p/ empresa) |
| 8 | — | Reversão do A3 depende do item 3 |
| 9 | ✅ | **PAGA** — `reviews` escopado |
| 10 | Alta | `companies` é `USING (true)` — expõe CNPJ/e-mail/endereço. **Consumidor acoplado:** a busca do F10 quebra em silêncio quando fechar |
| 11 | Alta | INSERT de `reviews` não exige turno concluído — qualquer conta inventa avaliação |
| 12 | Média | F9 × F11: painel conta SOS diferente de chamado de elenco |
| 13 | 🔴 Alta | Consentimento do SOS subdeclara — não menciona **CPF** |
| 14 | Média | Painel de aceitação enviesado a favor do SOS |
| 15 | 🔴🔴 | **uuid é credencial de PII** — em correção |

## 6. Especificações prontas, sem implementação

- **F13** multi-unidade — DDL aprovado, 2 blockers da spec corrigidos no gate. ⏸️ decisão H.

## 7. Pendências de deploy (não de commit)

- **V1–V7 + V8 do SOS** contra o banco, **depois** de aplicar. V4 (empresa vê 0 alvos não aceitos)
  e V6 (forjar `origin='sos'` → 42501) são gate de não-subida.
- `pg_cron` do F8 exercitado.
- Ordem obrigatória: **migration antes do frontend** (coluna ausente = `42703` derruba a query inteira).
