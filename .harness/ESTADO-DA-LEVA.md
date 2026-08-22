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

## 3. ✅ DECISÕES TOMADAS (21/08/2026 — owner delegou: "tome a decisão recomendada")

Todas seguem a recomendação já produzida pelo `harness-architect` nos respectivos gates.
**Onde eu escolhi um número que o contrato deixou em aberto, está marcado — esses pontos merecem
confirmação de um advogado antes do piloto, e a implementação não depende disso para andar.**

### H1 — "Excluir conta" passa a significar perder o acesso + anonimizar, com retenção de 5 anos

- **Anonimização com lápide pseudônima**, não exclusão física. Não existe caminho que cumpra o
  art. 18, VI **e** preserve a trilha fiscal; a alternativa seria destruir `shift_payments`, que é
  documento de auditoria.
- **Prazo de retenção: 6 anos** de `shift_payments` e `service_terms`, contados de `paid_at` /
  `accepted_at`. **Corrigido de 5 para 6 em 21/08**, por recomendação do architect, e ele estava
  certo: eu tinha raciocinado a partir da prescrição **civil** (CC art. 206, §5º, I — cobrança de
  dívidas), mas o risco que este produto corre é **reclamação trabalhista alegando vínculo**. Ela
  cabe até 2 anos após o fim da relação (CF art. 7º, XXIX) e o processo dura anos — a prova que
  interessa é exatamente o `term_text`, que declara ausência de vínculo, e o cenário realista é
  precisar dele **no ano 6 ou 7**. Cinco anos deixaria a prova expirar antes do risco.
  **Ainda assim é escolha de orquestração, não parecer jurídico — confirmar com advogado.**
  O prazo mora isolado em `lgpd_retention_interval()`: trocar é `CREATE OR REPLACE` de três linhas.
- **O expurgo apaga CONTEÚDO PESSOAL, não a LINHA** (ADR-20260821-expurgo-de-conteudo-nao-de-linha).
  O que a LGPD exige eliminar é o dado pessoal; o registro contábil pseudônimo não é dado pessoal
  depois que nome e CPF saem, e é ele que sustenta a trilha fiscal.
- **O prazo é do DADO, não da conta.** Conta excluída hoje com pagamento de 4 anos atrás: expurgo em
  2 anos. Contar da exclusão faria quem exerce o art. 18, VI **prolongar** a retenção dos próprios
  dados (6 anos para quem não pede, 10 para quem pede) — e deixaria todo registro de conta viva fora
  do expurgo para sempre.
- Decorrido o prazo, expurgo por cron — **não existe hoje**, é a migration `20260821000400`, e passa
  a ser parte da entrega.
- **A política e a tela precisam dizer, com todas as letras**, que o termo aceito é retido **com
  nome e CPF** por esse período. Sem isso a promessa continua falsa, só que na direção oposta.
- Nota de honestidade que fica no ADR: isto **não é anonimização** no sentido do art. 5º, XI — é
  eliminação parcial com retenção justificada sobre chave pseudônima. Não chamar de anonimização
  na política.

### H2 — Remover as FKs CASCADE para `auth.users`

Em `workers`, `companies` e `wallets`. **A cascata é o bug, não o RESTRICT:** trocar por CASCADE
destruiria o livro-caixa (Article 9). Aceita-se linhas órfãs por construção — é o que torna a
lápide possível.

### F13 — O gerente cria a própria credencial; a conta-mãe convida

Convite por **token de link** (`invite_company_manager` → `/convite-gerente/:token` →
`accept_manager_invite`), precedente `ADR-20260702-worker-join-by-invite-token`. **Criação direta
de credencial pela empresa é rejeitada:** a empresa criaria senha para outra pessoa, e exigiria uma
Edge Function nova com `service_role` chamando `auth.admin.createUser` para resolver o que o token
já resolve.

O custo aceito: a conta-mãe **não** pode resetar a senha do gerente. O ganho: vínculo consentido,
auditável, revogável em soft-delete, e a saída do gerente não leva o Elenco junto.

### SOS — o consentimento passa a nomear CPF e data de nascimento

Das duas saídas da dívida #13, escolhida a **(i) ampliar o texto**. A (ii) — restringir colunas no
ramo operacional de `can_view_worker_profile` — é decisão de arquitetura que atinge **todas** as
features que dependem daquele ramo, e não cabe às vésperas do piloto.

O texto hoje promete "telefone e chave PIX"; a empresa passa a ver a **linha inteira**. Um opt-in
que não diz o que expõe não é consentimento informado — e é essa defesa que sustenta a feature.

> **O parecer jurídico do ADR do SOS continua pendente** e não é substituído por esta decisão. O que
> foi decidido é qual correção implementar agora; a revisão jurídica segue como gate de pré-piloto.

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
