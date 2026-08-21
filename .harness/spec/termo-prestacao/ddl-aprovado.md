# DDL aprovado — Termo de prestação de serviço com aceite eletrônico (F6, `termo-prestacao`)

> **Fonte:** parecer do `harness-architect` (gate de 18/08/2026), veredito `APPROVED_WITH_CHANGES`.
> **ADR:** `.harness/memory-bank/decisions/ADR-20260818-termo-congelado-no-aceite.md`
>
> **Por que este arquivo existe:** o ADR registra a *decisão*; o DDL aprovado se perde na conversa do gate.
> Na F3 isso custou um achado HIGH (o trigger `enforce_job_series_same_owner` foi especificado no parecer,
> não chegou ao ADR, e o builder implementou sem ele). **O que o builder lê tem que ser o que foi aprovado.**
> Este arquivo é normativo. Onde ele diverge de `spec.md`, ele vence.

---

## 0. O que muda em relação ao `spec.md`

| # | Spec | Aprovado | Severidade |
|---|---|---|---|
| C1 | R1/R3/A4: `term_text` congela na **geração** | congela no **ACEITE**; antes disso é rascunho re-renderizado pela RPC | **blocker** |
| C2 | R6: imutabilidade = "não existe policy de UPDATE" | trigger `enforce_service_term_immutability` (`BEFORE UPDATE`), vale p/ `service_role` e owner | **blocker** |
| C3 | R1: `shift_payment_id ... ON DELETE CASCADE` | `ON DELETE RESTRICT` (auditoria não some em cascata) | **blocker** |
| C4 | A6: fronteira jurídica só na UI | a cláusula "a Worki não é parte" entra **dentro** de `term_text` (congelado/impresso) | **major** |
| C5 | — | coluna `anonymized_at` = única porta de reescrita pós-aceite (alavanca LGPD) | **major** |
| C6 | R1: colunas denormalizadas soltas | FK composta `(shift_payment_id, job_id, worker_id, company_id)` → `shift_payments` | **major** |
| C7 | R5: `accepted_ip`/`accepted_user_agent` | `text` (não `inet`), truncados, `NULL`-safe, documentados como **falsificáveis** | **major** |
| C8 | R6: SELECT da empresa por `companies.owner_id` | `public.is_company_owner()` (ancoragem dupla, ADR-20260817-seam-autorizacao-empresa) | **minor** |
| C9 | A9: termo de pagamento estornado "continua legível no recibo" | **inalcançável** por `/recibo/:jobId` — reescrever (ver §6) | **major** |
| C10 | — | trigger de geração **não** engole exceção (ao contrário de `notify_worker_on_shift_payment`) | **minor** |

---

## 1. Respostas diretas às 9 perguntas do gate

### 1. O snapshot de texto realmente congela? — **NÃO, do jeito da spec.**

R6 apoia a imutabilidade em ausência de caminho de escrita: "nenhuma policy de INSERT/UPDATE/DELETE para
`authenticated`". Isso cobre o client via PostgREST e **só isso**. Fica de fora:

- **`service_role`** — tem `BYPASSRLS`. Qualquer Edge Function futura com um `.from('service_terms').update()`
  reescreve um termo assinado sem nenhuma barreira. Não é hipotético: `delete-account` já faz exatamente esse
  tipo de UPDATE em `workers` e `companies`.
- **A própria RPC `accept_service_term`** — é `SECURITY DEFINER`, roda como owner, não passa por RLS. Um bug
  (ou uma edição futura) na RPC reescreve `term_text` de um termo já aceito.
- **owner/`postgres`** — RLS não se aplica ao dono da tabela sem `FORCE ROW LEVEL SECURITY`, e o projeto
  proíbe `FORCE` (ver `20260630000000`: `FORCE` + `REVOKE` bloquearia o `service_role` do BI).

O precedente do projeto é o oposto do que a spec propõe. `enforce_shift_payment_immutability` diz, literalmente,
que as colunas materiais são *"imutáveis para TODOS (inclusive service_role)"* e enforça por trigger `BEFORE
UPDATE` comparando `OLD`/`NEW`. **É esse o padrão aqui** (§3.5). "Ninguém escreveu ainda o código que reescreve"
não é imutabilidade — é dívida com prazo.

Segundo furo do congelamento: `ON DELETE CASCADE` em `shift_payment_id` (R1). Um `DELETE` em `shift_payments`
— hoje impossível via `authenticated`, trivial via `service_role` — apaga o termo assinado em silêncio.
`shift_payments` protege a *própria* auditoria com `ON DELETE RESTRICT` em todas as FKs; um documento assinado
merece pelo menos o mesmo. → **`RESTRICT`** (C3).

Terceiro ponto, e é a decisão de fundo (ADR): **o momento do congelamento está errado.** Ver pergunta 4.

### 2. `current_setting('request.headers', true)` funciona mesmo? — **Sim, mas só num caminho, e o valor é falsificável.**

**Como funciona.** O PostgREST abre uma transação por request e faz `set_config('request.headers', <json>, true)`
— com `is_local = true`. Todos os headers da request entram como **um objeto JSON com chaves em minúsculas**.
Ler é `current_setting('request.headers', true)::jsonb ->> 'user-agent'`. Funciona normalmente dentro de
`SECURITY DEFINER`: `DEFINER` troca o *role* de execução, não os GUCs da transação — mesmo raciocínio que já
está documentado em `architecture.md` para `auth.uid()` (as claims vivem em `request.jwt.claims`, outro GUC
posto pelo mesmo mecanismo).

**Quando NÃO vem nada** (`current_setting(..., true)` devolve `NULL`, e sem o `true` levantaria `42704`):

| Chamador | `request.headers` |
|---|---|
| Browser → Kong → PostgREST (`supabase-js .rpc()`) | ✅ populado — **único caminho probatório** |
| Edge Function (Deno) → PostgREST via `supabase-js` | ⚠️ populado, mas com os headers **da Edge Function** (UA do Deno, IP interno). Pior que vazio: parece dado e não é. |
| `pg_cron` / trigger disparado por outro backend | ❌ `NULL` |
| SQL Editor do dashboard / `psql` / conexão direta | ❌ `NULL` |
| `service_role` chamando direto no banco | ❌ `NULL` |

**Por que o valor é fraco mesmo no caminho bom.** O `x-forwarded-for` que chega ao Postgres é uma lista
(`cliente, proxy1, proxy2`). O primeiro elemento é o que o **cliente enviou** — e o cliente pode enviar o que
quiser: proxies em modo *append* (Kong/nginx padrão) acrescentam o IP real ao **fim**, não sobrescrevem o
começo. Ou seja: o campo que a spec chama de "reforço probatório" é, no elemento que todo mundo lê,
**controlado pelo próprio signatário**.

**Veredito.** Aceito como best-effort, com quatro condições (implementadas em §3.6/§3.7):
1. `text`, não `inet`. Um cast `::inet` num header lixo levanta `22P02` e derruba o aceite inteiro.
2. Leitura via helper com `EXCEPTION WHEN OTHERS THEN RETURN NULL` (o GUC pode existir e não ser JSON válido).
3. **Truncar**: `left(ip, 100)` e `left(ua, 512)`, reforçado por `CHECK`. O `User-Agent` é atacante-controlado
   e ilimitado — sem truncagem, um cliente grava dezenas de KB numa linha que a empresa vai ler e imprimir.
4. **Nome e comentário de coluna dizem que é indício, não prova.** Um campo de valor probatório que às vezes
   vem vazio e às vezes vem forjado tem que estar documentado como tal — no `COMMENT ON COLUMN`, no tipo
   TypeScript e na UI (não escrever "IP de origem verificado" em lugar nenhum).

O que **de fato** carrega valor probatório aqui é: `accepted_at` + `term_text` congelado + a autoria
`auth.uid() = worker_id` validada pela RPC. IP/UA são acessórios.

### 3. O gatilho é o momento certo? — **Sim, com três ajustes.**

`scheduled→recorded` casa com a fala da entrevista ("assina quando recebe") e não dá poder de veto do termo
sobre o dinheiro. Mantido. Mas:

**(a) Estorno depois do aceite.** Correto não deletar (A9). O que a spec não previu: depois do `voided`, a
empresa pode registrar um **novo** marcador para o mesmo `(job_id, worker_id)` — o UNIQUE parcial
`uq_shift_payments_job_worker_active` só barra os ativos. Esse novo marcador gera um **novo `service_terms`**,
que o freela precisa aceitar de novo. Está certo (novo pagamento = nova declaração), mas é uma consequência
não escrita: existem **N termos por (turno, freela)** ao longo do tempo, no máximo um ligado a um pagamento
ativo. `getByShiftPayment(shiftPaymentId)` — chaveado no **pagamento**, nunca no `job_id` — já resolve; o
service **não** pode ter um `getByJob`.

**Furo real de A9:** "quando qualquer parte reabre o recibo, o `service_terms` histórico continua legível".
Isso **não acontece**. `getReceipt()` filtra `.in('status', ['scheduled','recorded'])`
(`paymentRecordService.ts:521-561`) — para um pagamento `voided` ele devolve `null` e `ReceiptView` cai no
estado vazio, sem chegar perto do termo. É o mesmo motivo pelo qual `20260816140000` manda o link de estorno
para `/recebimentos` e não para `/recibo/`. → A9 reescrito em §6.

**(b) `recorded` direto, sem passar por `scheduled`.** Existe e é suportado (policy `sp_insert_company`
aceita `status IN ('scheduled','recorded')`; `recordExternalPayment` usa esse caminho). Por isso são **dois
triggers, uma função** — exatamente a arquitetura de `notify_worker_on_shift_payment`, e pelo mesmo motivo:
o `WHEN` de um trigger de INSERT não pode referenciar `OLD`. Ver §3.4.

**(c) Convivência com `enforce_shift_payment_immutability`.** Sem conflito, e não por sorte:
- Timing diferente: aquele é `BEFORE UPDATE`, este é `AFTER INSERT/UPDATE`. Todo `BEFORE` roda antes de todo
  `AFTER`, então o novo trigger só vê linhas que já passaram pela validação da máquina de estados.
- Entre os `AFTER`, a ordem é **alfabética pelo nome do trigger**: `trg_generate_service_term_*` roda antes de
  `trg_notify_worker_on_shift_payment_*`. Nenhum dos dois lê o efeito do outro — ordem é irrelevante.
- O trigger novo **não escreve em `shift_payments`**. Se escrevesse, reentraria no `BEFORE UPDATE` e bateria
  na imutabilidade. Não escreve: só lê `NEW` e insere em `service_terms`.

**Decisão adicional (C10): o trigger de geração NÃO engole exceção.** `notify_worker_on_shift_payment` usa
`EXCEPTION WHEN OTHERS THEN RETURN NEW` porque uma notificação perdida é um aborrecimento. Um termo perdido é
a feature inteira faltando em silêncio, sem backfill (out-of-scope da spec) e sem ninguém percebendo — a
empresa acha que tem o documento e não tem. Então falha alto: aborta o registro do pagamento com erro visível
e recuperável. O preço é aceitável **porque o corpo do trigger é construído para não poder falhar**:
- `concat()`/`coalesce()`, **nunca `||`** — `'x' || NULL` é `NULL`, e `term_text` é `NOT NULL`: seria uma
  violação `23502` abortando o registro do pagamento. `20260816150000` já tropeçou nessa classe
  ("Concatenação NULL-safe: start_date NULL → sufixo vazio").
- zero cast de texto para tipo (`::inet`, `::uuid`, `::date` sobre string);
- render é função pura, sem leitura de tabela;
- `ON CONFLICT (shift_payment_id) DO NOTHING` — re-entrada não levanta `23505`.

### 4. CPF ausente bloqueia o aceite. — **A consequência real é pior que a apontada, e é o motivo do ADR.**

A pergunta era sobre dívida operacional. A dívida operacional é **pequena**; o problema é outro.

**Dívida operacional: menor que o temido.** `WorkerOnboarding.tsx:160` exige CPF com 11 dígitos para sair do
passo 1, e `ProtectedRoute` exige `onboarding_completed` para chegar a `/recibo/:jobId` (Article 12). Nenhum
outro caminho cria linha em `workers` — `20260702120000_worker_join_by_invite_token.sql` **não** insere em
`workers`. Logo o `missing_cpf` só alcança **freelas legados**, onboardados antes de o CPF ser obrigatório.
Isso é contável antes do merge (§5, query V0) e é um número, não um risco. Se der zero, o branch é puramente
defensivo. Se der >0, a ação é uma campanha de completar perfil, não um redesenho.

**O problema de verdade: o desenho da spec produz um documento assinado sem CPF.** Com o congelamento na
geração (R1/R3/A4), a sequência é:

1. pagamento registrado → termo nasce com `CPF: não informado`;
2. freela tenta aceitar → `missing_cpf`;
3. freela preenche o CPF;
4. freela aceita → **A4 exige que o texto NÃO seja recalculado** → o documento assinado continua dizendo
   `CPF: não informado`.

O bloqueio de R4 cobra a fricção e não entrega o benefício. O único documento que precisava do CPF sai sem ele.
E o freela sem CPF é exatamente a população em que isso acontece — não é caso de borda dentro do caso de borda.

**Decisão (ADR-20260818): `term_text` congela no ACEITE, não na geração.** O trigger grava um **rascunho**
(o freela precisa ler o que vai assinar, e o read path é `.from()` direto — Article 5); a RPC
`accept_service_term` **re-renderiza com os dados vigentes e grava `term_text` junto com `accepted_at`, no
mesmo UPDATE**. A partir daí é imutável (trigger C2). O que congela passa a ser o que a pessoa aceitou — que é
o que o congelamento existia para garantir.

Custo assumido: entre ler a tela e clicar, os dados podem mudar (segundos a dias). Aceito — a alternativa é
congelar um texto sabidamente errado.

**Sobre "a empresa acha que ele não assinou":** aceitável no piloto, **desde que a UI não minta**. O bloco da
empresa em `ReceiptView` mostra "Aguardando aceite do termo pelo freela" e a empresa **lê o rascunho**, que
literalmente diz `CPF: não informado` — o diagnóstico está na tela, sem coluna nova, sem vazar nada que a
empresa já não veja. Não adicionar campo de status para isso.

### 5. A fronteira jurídica é estrutural ou só copy? — **Só copy, na spec. Precisa de uma peça estrutural.**

**O que o schema aprovado NÃO tem, deliberadamente** — o builder não pode introduzir nenhum destes:

- ❌ `validated_by`, `validated_at`, `verified`, `approved_by`, `reviewed_at` — qualquer coisa que leia como
  "a Worki conferiu".
- ❌ coluna `status` com valores tipo `'approved'`/`'valid'`. **O estado do termo é a presença de
  `accepted_at`**, e nada mais. Um enum com `'approved'` transforma a Worki em quem aprova.
- ❌ `company_accepted_at` / assinatura da empresa — fora de escopo na spec e **deve continuar fora**: aceite
  bilateral posiciona a Worki como plataforma que executa a assinatura de um contrato entre terceiros.
- ❌ `term_text_sha256`, `signature_hash`, `certificate_id`, "carimbo do tempo" — cerimônia de certificação
  sem certificação. Sugere ICP-Brasil onde não há (out-of-scope explícito da spec).
- ❌ `is_valid`, `nullified_at`, "invalidar termo" — invalidar é ato das partes ou de um juiz, não da Worki.

**A peça estrutural que falta (C4): a cláusula de fronteira tem que estar DENTRO de `term_text`.** A6 põe o
aviso na UI. UI se refatora; texto congelado, não. Se um dia o bloco amarelo do rodapé sumir num redesign do
`ReceiptView`, o documento impresso passa a ser um contrato distribuído pela Worki **sem nenhuma ressalva** —
e os documentos já assinados também, porque a ressalva nunca fez parte deles. Com a cláusula dentro do texto
(item 4 do render, §3.3), ela é congelada, impressa e inseparável do que foi aceito.

**Exposição residual, que schema nenhum resolve:** a Worki **fornece o texto** do contrato entre duas outras
partes. Isso é decisão de negócio do owner com o jurídico dele (a spec já joga a validação do conteúdo para
fora de escopo, corretamente). Mitigação disponível de graça: `term_version` deve valer `'modelo-worki-v1'`
— "modelo" (sugestão) e não "termo oficial".

### 6. LGPD — **quem lê está certo; `delete-account` NÃO deve ser estendido por default, mas a alavanca tem que existir.**

**Quem lê:** só o freela (`worker_id = auth.uid()`) e a empresa dona (`is_company_owner(company_id)`).
`anon` revogado, sem policy de escrita para `authenticated`. Nenhum terceiro alcança CPF/CNPJ. A5 satisfeito.

**O que acontece hoje no `delete-account`:** a função anonimiza `workers` (`cpf → null`, `full_name → '[Conta
Deletada]'`) e depois chama `auth.admin.deleteUser`. **`service_terms.term_text` não é tocado** — o CPF e o
nome completo do freela permanecem congelados no texto, depois de a conta ser apagada. É exposição nova, que
`shift_payments` não tinha (aquela tabela só guarda FKs e valores).

**Recomendação: NÃO anonimizar por default.** Um termo de responsabilidade tributária assinado é precisamente
a prova que a empresa precisa para se defender numa reclamatória — é a razão de a feature existir. Apagá-lo a
pedido da contraparte destrói a defesa de um terceiro. LGPD Art. 7, VI (exercício regular de direitos em
processo judicial) e Art. 16, I/II (conservação para cumprimento de obrigação legal e para exercício de
direitos) sustentam a retenção. A anonimização do perfil (`workers.cpf`) e a retenção do documento assinado
não são contraditórias: uma é dado para *operar* o produto, a outra é prova de uma transação encerrada.

**O que muda no `delete-account`, então:** nada de código. Mas **três itens obrigatórios**:

1. **Política de Privacidade** precisa dizer, antes do piloto, que termos de prestação de serviço aceitos são
   retidos após a exclusão da conta, com a base legal. Isso é entrega de conteúdo, não de schema — e é
   bloqueante de piloto, não de merge.
2. **A alavanca tem que existir no schema (C5).** Com a imutabilidade de C2, se o jurídico do owner decidir o
   contrário depois, honrar um pedido de titular exigiria cirurgia de DDL em produção. Por isso `anonymized_at`:
   a transição `NULL → timestamp` é a **única** circunstância em que `term_text` pode ser reescrito depois do
   aceite. Sem policy de UPDATE para `authenticated` → só `service_role`/owner alcança. Custa uma coluna e três
   linhas de trigger, e converte um caminho irreversível em reversível.
3. **Verificar antes do merge se `delete-account` ainda funciona.** `service_terms.worker_id → workers(id) ON
   DELETE RESTRICT` acrescenta mais uma trava à deleção do usuário. Se `workers.id → auth.users(id)` for
   `ON DELETE CASCADE`, `auth.admin.deleteUser` já falha hoje por causa do `RESTRICT` de `shift_payments` —
   ou seja, não é regressão nova, mas é um bug latente que esta feature agrava. Query V6 em §5 mede isso.

### 7. DDL final + landmines — §3 e §7.

### 8. Article 8 — **intacto, confirmado.**

- Nenhum `UPDATE wallets`, nenhuma linha em `escrow_transactions`, nenhuma chamada a `reserve_escrow` /
  `release_escrow` / `refund_escrow` / `credit_deposit` / `update_wallet_balance` / `authorize_*` / `capture_*`.
- `service_terms` **não referencia e não é referenciada por** `wallets` ou `escrow_transactions`. As FKs saem
  para `shift_payments`/`jobs`/`workers`/`companies` — nunca o inverso.
- `service_terms.amount` é **cópia declaratória** de `shift_payments.amount`, para auditoria. Não é saldo, não
  entra em soma de carteira, não é lido por RPC financeira. Precedente idêntico:
  `shift_payments.amount` (`20260630000000`).
- **`shift_payments` continua sendo auditoria, não liquidação.** A feature é estritamente **aditiva** sobre ela:
  dois `AFTER` triggers de leitura. Nenhuma coluna nova, nenhuma constraint alterada, nenhuma policy tocada, o
  `enforce_shift_payment_immutability` não é reescrito. A única alteração em `shift_payments` é a constraint
  `uq_shift_payments_identity` (C6), que é `UNIQUE (id, ...)` — logicamente impossível de violar (`id` é PK),
  existe só como alvo de FK.
- Article 9 não se aplica (não é `wallet_transactions`); a idempotência equivalente aqui é
  `UNIQUE (shift_payment_id)` + `ON CONFLICT DO NOTHING`.
- Article 10 intacto: nenhuma `service_role` no frontend; a RPC é `authenticated`.

### 9. ADR — **emitido:** `ADR-20260818-termo-congelado-no-aceite.md`.

Reversibilidade difícil em três eixos: momento do congelamento (texto já assinado não se re-assina),
imutabilidade por trigger (destravar depois é reescrever a semântica do documento) e retenção LGPD (dado
apagado não volta; dado retido sem base declarada é passivo).

---

## 2. Ordem obrigatória do arquivo

**Landmine que já custou uma migration inaplicável neste projeto:** função `LANGUAGE sql` tem o corpo validado
no `CREATE`. Nesta migration `render_service_term_text` **não lê tabela nenhuma** (é pura, recebe escalares),
então poderia vir em qualquer ponto — mas as funções que leem `service_terms` (imutabilidade, RPC de aceite)
**precisam** vir depois do `CREATE TABLE`. Ordem obrigatória:

1. `uq_shift_payments_identity` em `shift_payments` (alvo da FK composta)
2. `CREATE TABLE service_terms` + comentários + índices
3. Helpers puros: `render_service_term_text`, `request_header`
4. Trigger de imutabilidade (lê a tabela)
5. Trigger de geração (lê `shift_payments`/`workers`/`companies`/`jobs`, escreve em `service_terms`)
6. RPC `accept_service_term`
7. GRANT/REVOKE de funções
8. Policies
9. `ENABLE ROW LEVEL SECURITY` (**depois** das policies, **sem** `FORCE`)

---

## 3. Migration

**Arquivo:** `supabase/migrations/20260817001100_service_terms.sql`

> Numeração coordenada com o gate paralelo da F5, que ocupa `20260817000900`+. A última aplicada em produção
> é `20260817000800`. **Uma migration só** — a feature é uma tabela e suas funções; partir em duas cria
> ordem parcial sem ganho.

### 3.1 Cabeçalho e alvo da FK composta

```sql
-- Migration: Termo de prestação de serviço com aceite eletrônico (F6, modo A)
-- File: supabase/migrations/20260817001100_service_terms.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260818-termo-congelado-no-aceite.md
-- DDL aprovado: .harness/spec/termo-prestacao/ddl-aprovado.md (normativo)
-- Depende de: 20260630000000_shift_payments.sql, 20260712000000_shift_payment_scheduled.sql,
--             20260816220000_shift_payments_unique_por_freela.sql,
--             20260817000300_team_lists.sql (is_company_owner),
--             20260817000600_shift_attendance_confirmations.sql (job_local_date)
-- Gate: harness-architect (18/08/2026) — APPROVED_WITH_CHANGES.
--
-- ============================================================================
-- FRONTEIRA CRÍTICA (Article 8/9/10) — INALTERADA
-- ----------------------------------------------------------------------------
--   NÃO move saldo: nenhum UPDATE em wallets, nenhuma linha em escrow_transactions,
--   nenhuma RPC de saldo. `service_terms.amount` é CÓPIA DECLARATÓRIA de
--   shift_payments.amount para auditoria — não é saldo e não entra em soma alguma.
--   `shift_payments` continua REGISTRO, não liquidação: esta migration só ACRESCENTA
--   dois triggers AFTER de leitura + uma UNIQUE logicamente inviolável (alvo de FK).
--   Não reescreve enforce_shift_payment_immutability, não altera policy nem constraint.
--
-- FRONTEIRA JURÍDICA (estrutural, não copy) — LER ANTES DE ADICIONAR COLUNA
-- ----------------------------------------------------------------------------
--   A Worki NÃO é parte deste termo. NÃO adicionar, nunca: validated_by/validated_at,
--   verified, approved_by, reviewed_at, status com 'approved'/'valid', is_valid,
--   company_accepted_at, term_text_sha256/signature_hash/certificate_id.
--   O estado do termo é a presença de `accepted_at` — e nada mais.
--   A cláusula "a Worki não é parte / não valida / não garante" vive DENTRO de
--   term_text (item 4 do render), congelada e impressa. Requisito de UI se perde
--   numa refatoração; texto congelado, não.
--
-- CONGELAMENTO (decisão central do ADR)
-- ----------------------------------------------------------------------------
--   term_text é RASCUNHO enquanto accepted_at IS NULL (o freela precisa ler o que vai
--   assinar) e CONGELA no aceite: accept_service_term re-renderiza com os dados
--   vigentes e grava term_text + accepted_at no MESMO UPDATE. Depois disso, imutável
--   para TODOS os papéis — inclusive service_role e owner (trigger, §4).
--   Congelar na geração produzia documento assinado com "CPF: não informado" sempre
--   que o bloqueio de missing_cpf disparava. Ver ADR §Contexto.
--
-- DOWN (rollback): ver rodapé.
-- ============================================================================

-- =============================================
-- 1. ALVO DA FK COMPOSTA (em shift_payments)
-- =============================================
-- UNIQUE (id, job_id, worker_id, company_id) é LOGICAMENTE INVIOLÁVEL — `id` já é PK.
-- Existe só para ser alvo de FK composta: garante que as colunas denormalizadas de
-- service_terms NÃO PODEM divergir do marcador de pagamento. Sem isso, um bug no
-- trigger gravaria company_id errado e a RLS entregaria o CPF do freela para a
-- empresa errada. Colunas materiais de shift_payments são imutáveis → não há drift.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.shift_payments'::regclass
           AND conname  = 'uq_shift_payments_identity'
    ) THEN
        ALTER TABLE public.shift_payments
            ADD CONSTRAINT uq_shift_payments_identity
            UNIQUE (id, job_id, worker_id, company_id);
    END IF;
END $$;
```

### 3.2 Tabela

```sql
-- =============================================
-- 2. TABELA
-- =============================================
CREATE TABLE IF NOT EXISTS public.service_terms (
    id                  uuid          DEFAULT gen_random_uuid() PRIMARY KEY,

    -- 1:1 com o marcador de pagamento. RESTRICT (NÃO cascade): documento assinado é
    -- auditoria e não some em cascata — mesma regra das FKs de shift_payments.
    shift_payment_id    uuid          NOT NULL UNIQUE
                                      REFERENCES public.shift_payments(id) ON DELETE RESTRICT,

    -- Denormalizados: âncora barata de RLS + auto-contenção do snapshot.
    -- A FK COMPOSTA abaixo garante que casam com o marcador. Não remover.
    job_id              uuid          NOT NULL REFERENCES public.jobs(id)      ON DELETE RESTRICT,
    worker_id           uuid          NOT NULL REFERENCES public.workers(id)   ON DELETE RESTRICT,
    company_id          uuid          NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,

    -- 'modelo-worki-v1' — MODELO (sugestão), não "termo oficial da Worki".
    term_version        text          NOT NULL,

    -- Texto RENDERIZADO. Rascunho enquanto accepted_at IS NULL; congelado depois.
    term_text           text          NOT NULL,

    -- Cópia declaratória do valor no momento do aceite. NÃO É SALDO (Article 8).
    amount              numeric(12,2) NOT NULL CHECK (amount > 0),

    created_at          timestamptz   NOT NULL DEFAULT now(),

    -- NULL = pendente. É o ÚNICO estado do termo (não existe coluna `status`).
    accepted_at         timestamptz,

    -- BEST-EFFORT e FALSIFICÁVEIS. text (nunca inet): cast de header lixo derrubaria
    -- o aceite. Ver §1 pergunta 2.
    accepted_ip         text,
    accepted_user_agent text,

    -- Única porta de reescrita de term_text depois do aceite (alavanca LGPD, ADR C5).
    -- Fechada ao client (não há policy de UPDATE para authenticated). NÃO usar por default.
    anonymized_at       timestamptz,

    -- IP/UA só existem se houve aceite.
    CONSTRAINT service_terms_accept_consistency CHECK (
        accepted_at IS NOT NULL
        OR (accepted_ip IS NULL AND accepted_user_agent IS NULL)
    ),
    -- Truncagem defensiva: User-Agent é atacante-controlado e ilimitado.
    CONSTRAINT service_terms_ip_len CHECK (accepted_ip IS NULL OR length(accepted_ip) <= 100),
    CONSTRAINT service_terms_ua_len CHECK (accepted_user_agent IS NULL OR length(accepted_user_agent) <= 512),

    -- Denormalização não pode divergir do marcador.
    CONSTRAINT service_terms_payment_identity
        FOREIGN KEY (shift_payment_id, job_id, worker_id, company_id)
        REFERENCES public.shift_payments (id, job_id, worker_id, company_id)
        ON DELETE RESTRICT
);

COMMENT ON TABLE public.service_terms IS
    'Termo de prestacao de servico autonomo + responsabilidade tributaria, 1:1 com shift_payments (modo A). '
    'REGISTRO DECLARATORIO entre empresa e freela: a Worki NAO e parte, nao valida e nao garante validade '
    'juridica (a clausula esta DENTRO de term_text). NAO move saldo (Article 8). Retencao pos-exclusao de '
    'conta: prova de transacao encerrada (LGPD Art. 7 VI / Art. 16 I-II) — ver ADR-20260818.';
COMMENT ON COLUMN public.service_terms.term_text IS
    'Texto renderizado. RASCUNHO enquanto accepted_at IS NULL; CONGELADO no aceite (accept_service_term '
    're-renderiza e grava junto com accepted_at). Imutavel depois, para TODOS os papeis (trigger).';
COMMENT ON COLUMN public.service_terms.accepted_at IS
    'Timestamp do aceite eletronico. NULL = pendente. UNICO estado do termo — nao existe coluna status.';
COMMENT ON COLUMN public.service_terms.accepted_ip IS
    'BEST-EFFORT e FALSIFICAVEL. Primeiro elemento de x-forwarded-for, que o proprio cliente pode forjar '
    '(proxies fazem append). NULL quando a chamada nao vem do PostgREST. Indicio, NAO prova. Nunca rotular '
    'como "IP verificado" na UI.';
COMMENT ON COLUMN public.service_terms.accepted_user_agent IS
    'BEST-EFFORT. Header user-agent truncado em 512 chars. NULL fora do PostgREST. Indicio, nao prova.';
COMMENT ON COLUMN public.service_terms.amount IS
    'Copia DECLARATORIA de shift_payments.amount no momento do aceite (auditoria). NAO e saldo — nenhuma RPC.';
COMMENT ON COLUMN public.service_terms.anonymized_at IS
    'Unica transicao que permite reescrever term_text apos o aceite (LGPD). NULL->ts, one-way, fechada ao '
    'client. Por DEFAULT nao e usada: termo assinado e retido como prova (ADR-20260818 §Consequencias).';

-- =============================================
-- 3. ÍNDICES (tabela nova/vazia → CREATE INDEX simples; sem CONCURRENTLY)
-- =============================================
CREATE INDEX IF NOT EXISTS idx_service_terms_worker  ON public.service_terms (worker_id);
CREATE INDEX IF NOT EXISTS idx_service_terms_company ON public.service_terms (company_id);
CREATE INDEX IF NOT EXISTS idx_service_terms_job     ON public.service_terms (job_id);
-- (shift_payment_id já tem índice único pela constraint UNIQUE.)
-- Pendentes — usado pela query de ops V4 e por qualquer painel futuro de cobrança de aceite.
CREATE INDEX IF NOT EXISTS idx_service_terms_pending
    ON public.service_terms (company_id, created_at)
    WHERE accepted_at IS NULL;
```

### 3.3 Render — função PURA (R2)

```sql
-- =============================================
-- 4. RENDER — função PURA (recebe escalares, NÃO lê tabela)
-- =============================================
-- Pura de propósito: é chamada de dentro do trigger de geração, e uma exceção ali
-- ABORTA o registro do pagamento. Sem leitura de tabela, sem cast de texto, concat/coalesce
-- (nunca `||`: 'x' || NULL = NULL, e term_text é NOT NULL → 23502 derrubando o pagamento).
--
-- STABLE, não IMMUTABLE: to_char(numeric, text) é STABLE (depende de lc_numeric).
-- Marcar IMMUTABLE seria mentira e habilitaria constant-folding indevido.
CREATE OR REPLACE FUNCTION public.render_service_term_text(
    p_worker_name   text,
    p_worker_cpf    text,
    p_company_name  text,
    p_company_cnpj  text,
    p_job_title     text,
    p_job_date      date,
    p_amount        numeric,
    p_term_version  text
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT concat(
        'TERMO DE PRESTAÇÃO DE SERVIÇO AUTÔNOMO E RESPONSABILIDADE TRIBUTÁRIA', E'\n',
        'Modelo ', coalesce(nullif(btrim(p_term_version), ''), 'modelo-worki-v1'), E'\n\n',

        'PRESTADOR: ', coalesce(nullif(btrim(p_worker_name), ''), 'não informado'), E'\n',
        'CPF: ', coalesce(
            nullif(regexp_replace(coalesce(p_worker_cpf, ''), '\D', '', 'g'), ''),
            'não informado'
        ), E'\n\n',

        'CONTRATANTE: ', coalesce(nullif(btrim(p_company_name), ''), 'não informado'), E'\n',
        'CNPJ: ', coalesce(
            nullif(regexp_replace(coalesce(p_company_cnpj, ''), '\D', '', 'g'), ''),
            'não informado'
        ), E'\n\n',

        'SERVIÇO: ', coalesce(nullif(btrim(p_job_title), ''), 'sem título'), E'\n',
        'DATA DA PRESTAÇÃO: ', coalesce(to_char(p_job_date, 'DD/MM/YYYY'), 'não informada'), E'\n',
        'VALOR BRUTO: R$ ', coalesce(replace(to_char(p_amount, 'FM9999999990.00'), '.', ','), '0,00'),
        E'\n\n',

        '1. O PRESTADOR declara que executou o serviço acima de forma AUTÔNOMA, sem subordinação, ',
        'habitualidade ou exclusividade, não se caracterizando vínculo empregatício com a CONTRATANTE.',
        E'\n\n',
        '2. O valor acima é BRUTO. O PRESTADOR declara ser o único responsável pelo recolhimento dos ',
        'tributos e das contribuições previdenciárias incidentes sobre o valor recebido, isentando a ',
        'CONTRATANTE de tal responsabilidade.',
        E'\n\n',
        '3. O PRESTADOR declara ter recebido o valor acima diretamente da CONTRATANTE, por meio externo ',
        'à plataforma Worki.',
        E'\n\n',
        '4. A plataforma Worki NÃO é parte deste termo. Ela apenas REGISTRA a declaração e o aceite entre ',
        'PRESTADOR e CONTRATANTE. A Worki não é empregadora, não intermedia o pagamento, não presta ',
        'consultoria jurídica e não garante a validade jurídica deste documento.',
        E'\n\n',
        'Aceite eletrônico registrado pela plataforma na data e hora indicadas neste recibo.'
    );
$$;

COMMENT ON FUNCTION public.render_service_term_text(text,text,text,text,text,date,numeric,text) IS
    'Renderiza o texto do termo a partir de ESCALARES (nao le tabela). Chamada de dentro de triggers/RPC '
    'SECURITY DEFINER, onde uma excecao abortaria o registro do pagamento — por isso concat/coalesce e zero '
    'cast. O item 4 do texto (fronteira juridica) e ESTRUTURAL: nao remover.';

-- Ambos os chamadores (generate_service_term_on_payment, accept_service_term) são
-- SECURITY DEFINER de propriedade de `postgres` → o privilégio de EXECUTE é checado
-- contra postgres, não contra o usuário da sessão. Por isso NÃO precisa (e não deve)
-- ser exposta a `authenticated` via PostgREST.
-- ⚠️ Se algum dia um chamador virar SECURITY INVOKER, este GRANT precisa ser revisto.
REVOKE ALL ON FUNCTION public.render_service_term_text(text,text,text,text,text,date,numeric,text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.render_service_term_text(text,text,text,text,text,date,numeric,text)
    TO service_role;
```

### 3.4 Helper de header + trigger de geração (R3)

```sql
-- =============================================
-- 5. HEADER BEST-EFFORT
-- =============================================
-- PostgREST faz set_config('request.headers', <json de todos os headers>, true) por
-- transação, chaves em MINÚSCULAS. Funciona dentro de SECURITY DEFINER (DEFINER troca o
-- ROLE, não os GUCs — mesmo raciocínio de auth.uid()/request.jwt.claims).
-- Devolve NULL fora do PostgREST (pg_cron, psql, SQL editor, service_role direto) e
-- devolve os headers da EDGE FUNCTION quando a chamada vem de lá (não do usuário final).
-- plpgsql por causa do EXCEPTION: o GUC pode existir e não ser JSON válido.
CREATE OR REPLACE FUNCTION public.request_header(p_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
    v_raw text;
BEGIN
    v_raw := current_setting('request.headers', true);
    IF v_raw IS NULL OR btrim(v_raw) = '' THEN
        RETURN NULL;
    END IF;
    RETURN nullif(btrim((v_raw::jsonb) ->> lower(p_name)), '');
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.request_header(text) IS
    'Le um header HTTP da request PostgREST (GUC request.headers, chaves minusculas). NULL fora do '
    'PostgREST. BEST-EFFORT: nunca levanta excecao. Valores derivados sao INDICIO, nao prova — '
    'x-forwarded-for e forjavel pelo cliente.';

REVOKE ALL ON FUNCTION public.request_header(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_header(text) TO service_role;

-- =============================================
-- 6. GERAÇÃO DO TERMO (rascunho) — AFTER INSERT/UPDATE em shift_payments
-- =============================================
-- Dispara na PRIMEIRA vez que o marcador vira 'recorded' (INSERT direto OU scheduled->recorded).
-- 'scheduled' NÃO gera termo (promessa ≠ pagamento) — A8 da spec.
--
-- NÃO engole exceção (ao contrário de notify_worker_on_shift_payment): termo faltando em
-- silêncio, sem backfill, é a feature inteira sumindo sem ninguém perceber. O corpo é
-- construído para não poder falhar (render puro, concat/coalesce, ON CONFLICT DO NOTHING).
--
-- NÃO escreve em shift_payments — se escrevesse, reentraria no BEFORE UPDATE de
-- enforce_shift_payment_immutability e bateria na imutabilidade das colunas materiais.
CREATE OR REPLACE FUNCTION public.generate_service_term_on_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_worker_name  text;
    v_worker_cpf   text;
    v_company_name text;
    v_company_cnpj text;
    v_job_title    text;
    v_job_date     date;
    v_version      text := 'modelo-worki-v1';
BEGIN
    SELECT w.full_name, w.cpf INTO v_worker_name, v_worker_cpf
      FROM public.workers w WHERE w.id = NEW.worker_id;

    SELECT c.name, c.cnpj INTO v_company_name, v_company_cnpj
      FROM public.companies c WHERE c.id = NEW.company_id;

    SELECT j.title INTO v_job_title
      FROM public.jobs j WHERE j.id = NEW.job_id;

    -- Data LOCAL do turno (America/Sao_Paulo) — ::date cru usaria UTC do servidor.
    v_job_date := public.job_local_date(NEW.job_id);

    INSERT INTO public.service_terms (
        shift_payment_id, job_id, worker_id, company_id,
        term_version, term_text, amount
    )
    VALUES (
        NEW.id, NEW.job_id, NEW.worker_id, NEW.company_id,
        v_version,
        public.render_service_term_text(
            v_worker_name, v_worker_cpf,
            v_company_name, v_company_cnpj,
            v_job_title, v_job_date,
            NEW.amount, v_version
        ),
        NEW.amount
    )
    ON CONFLICT (shift_payment_id) DO NOTHING;  -- idempotente por construção

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.generate_service_term_on_payment() IS
    'AFTER INSERT/UPDATE em shift_payments: cria o RASCUNHO do termo quando o marcador vira recorded. '
    'Idempotente (UNIQUE shift_payment_id + ON CONFLICT DO NOTHING). NAO move saldo (Article 8). '
    'NAO engole excecao — ver ADR-20260818.';

-- Trigger functions MANTÊM EXECUTE para authenticated: o privilégio é checado contra o
-- usuário da sessão que dispara o trigger. Revogar quebra o INSERT do pagamento
-- (landmine de 20260816201420 / corrigido em 20260816201457).
REVOKE ALL ON FUNCTION public.generate_service_term_on_payment() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_service_term_on_payment() TO authenticated, service_role;

-- INSERT direto com status='recorded' (recordExternalPayment — caminho legado suportado).
DROP TRIGGER IF EXISTS trg_generate_service_term_insert ON public.shift_payments;
CREATE TRIGGER trg_generate_service_term_insert
    AFTER INSERT ON public.shift_payments
    FOR EACH ROW
    WHEN (NEW.status = 'recorded')
    EXECUTE FUNCTION public.generate_service_term_on_payment();

-- Efetivação scheduled->recorded. WHEN de INSERT não pode referenciar OLD → dois triggers,
-- uma função (mesma arquitetura de notify_worker_on_shift_payment).
DROP TRIGGER IF EXISTS trg_generate_service_term_update ON public.shift_payments;
CREATE TRIGGER trg_generate_service_term_update
    AFTER UPDATE ON public.shift_payments
    FOR EACH ROW
    WHEN (NEW.status = 'recorded' AND OLD.status IS DISTINCT FROM 'recorded')
    EXECUTE FUNCTION public.generate_service_term_on_payment();
```

### 3.5 Imutabilidade (C2 — a peça que a spec não tinha)

```sql
-- =============================================
-- 7. IMUTABILIDADE — BEFORE UPDATE (padrão enforce_shift_payment_immutability)
-- =============================================
-- Vale para TODOS os papéis, inclusive service_role e owner. RLS não bastaria:
-- service_role tem BYPASSRLS, o owner ignora RLS sem FORCE (e FORCE é proibido no
-- projeto), e a própria accept_service_term é SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.enforce_service_term_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- === Vínculo e valor: imutáveis SEMPRE ===
    IF NEW.id               IS DISTINCT FROM OLD.id
       OR NEW.shift_payment_id IS DISTINCT FROM OLD.shift_payment_id
       OR NEW.job_id           IS DISTINCT FROM OLD.job_id
       OR NEW.worker_id        IS DISTINCT FROM OLD.worker_id
       OR NEW.company_id       IS DISTINCT FROM OLD.company_id
       OR NEW.amount           IS DISTINCT FROM OLD.amount
       OR NEW.created_at       IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'service_terms: vinculo e valor sao imutaveis (shift_payment_id, job_id, worker_id, company_id, amount, created_at).';
    END IF;

    -- === accepted_at: ONE-WAY (NULL -> timestamp). Nunca altera, nunca limpa. ===
    IF OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
        RAISE EXCEPTION 'service_terms: accepted_at e imutavel apos o aceite.';
    END IF;

    -- === IP/UA: só podem ser gravados NO aceite; nunca reescritos depois. ===
    IF OLD.accepted_at IS NOT NULL
       AND (NEW.accepted_ip         IS DISTINCT FROM OLD.accepted_ip
         OR NEW.accepted_user_agent IS DISTINCT FROM OLD.accepted_user_agent)
    THEN
        RAISE EXCEPTION 'service_terms: accepted_ip/accepted_user_agent sao imutaveis apos o aceite.';
    END IF;

    -- === anonymized_at: ONE-WAY (NULL -> timestamp). Nunca volta. ===
    IF OLD.anonymized_at IS NOT NULL AND NEW.anonymized_at IS DISTINCT FROM OLD.anonymized_at THEN
        RAISE EXCEPTION 'service_terms: anonymized_at e imutavel.';
    END IF;

    -- === term_text / term_version: livres ENQUANTO rascunho; congelados no aceite. ===
    -- Única exceção pós-aceite: a anonimização LGPD (NULL -> ts), que é o ato de
    -- reescrever o texto. Fora dela, um termo aceito não muda mais.
    IF OLD.accepted_at IS NOT NULL
       AND (NEW.term_text IS DISTINCT FROM OLD.term_text
         OR NEW.term_version IS DISTINCT FROM OLD.term_version)
       AND NOT (OLD.anonymized_at IS NULL AND NEW.anonymized_at IS NOT NULL)
    THEN
        RAISE EXCEPTION 'service_terms: term_text/term_version sao imutaveis apos o aceite (unica excecao: anonimizacao LGPD).';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_service_term_immutability() IS
    'BEFORE UPDATE em service_terms. term_text e rascunho enquanto accepted_at IS NULL e CONGELA no aceite. '
    'Vale para TODOS os papeis (service_role e owner inclusive) — RLS nao cobriria. Unica reescrita '
    'pos-aceite: anonimizacao LGPD (anonymized_at NULL->ts). ADR-20260818.';

REVOKE ALL ON FUNCTION public.enforce_service_term_immutability() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_service_term_immutability() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_service_term_immutability ON public.service_terms;
CREATE TRIGGER trg_enforce_service_term_immutability
    BEFORE UPDATE ON public.service_terms
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_service_term_immutability();
```

### 3.6 RPC de aceite (R5)

```sql
-- =============================================
-- 8. RPC accept_service_term — outcomes, nunca exceção em caminho esperado
-- =============================================
-- Padrão do projeto: RETURNS jsonb com jsonb_build_object('outcome', ...) —
-- mesmo de respond_attendance_confirmation (20260817000700).
--
-- RE-RENDERIZA o texto e grava junto com accepted_at, no MESMO UPDATE (ADR): o que
-- congela é o que a pessoa aceitou, com o CPF que ela acabou de preencher.
CREATE OR REPLACE FUNCTION public.accept_service_term(p_service_term_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid            uuid := (SELECT auth.uid());
    v_term           public.service_terms%ROWTYPE;
    v_payment_status text;
    v_worker_name    text;
    v_worker_cpf     text;
    v_company_name   text;
    v_company_cnpj   text;
    v_job_title      text;
    v_job_date       date;
    v_text           text;
    v_ip             text;
    v_ua             text;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    -- FOR UPDATE: duplo clique / retry viram serial, não corrida.
    SELECT * INTO v_term
      FROM public.service_terms
     WHERE id = p_service_term_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_term.worker_id <> v_uid THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- Idempotente: não altera nada, devolve o estado (A7).
    IF v_term.accepted_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'outcome', 'already_accepted',
            'accepted_at', v_term.accepted_at
        );
    END IF;

    SELECT sp.status INTO v_payment_status
      FROM public.shift_payments sp
     WHERE sp.id = v_term.shift_payment_id;

    IF v_payment_status IS DISTINCT FROM 'recorded' THEN
        RETURN jsonb_build_object('outcome', 'payment_voided');
    END IF;

    SELECT w.full_name, w.cpf INTO v_worker_name, v_worker_cpf
      FROM public.workers w WHERE w.id = v_term.worker_id;

    -- 11 dígitos: onboarding já exige (WorkerOnboarding.tsx:160). Alcança só legados.
    IF length(regexp_replace(coalesce(v_worker_cpf, ''), '\D', '', 'g')) <> 11 THEN
        RETURN jsonb_build_object('outcome', 'missing_cpf');
    END IF;

    SELECT c.name, c.cnpj INTO v_company_name, v_company_cnpj
      FROM public.companies c WHERE c.id = v_term.company_id;

    SELECT j.title INTO v_job_title
      FROM public.jobs j WHERE j.id = v_term.job_id;

    v_job_date := public.job_local_date(v_term.job_id);

    -- Congela AGORA, com os dados vigentes.
    v_text := public.render_service_term_text(
        v_worker_name, v_worker_cpf,
        v_company_name, v_company_cnpj,
        v_job_title, v_job_date,
        v_term.amount, v_term.term_version
    );

    -- Best-effort. x-forwarded-for pode vir como "cliente, proxy1, proxy2" — o primeiro
    -- elemento é o que o CLIENTE enviou (forjável). Fallbacks para quando não vier.
    v_ip := left(
        coalesce(
            nullif(btrim(split_part(coalesce(public.request_header('x-forwarded-for'), ''), ',', 1)), ''),
            public.request_header('cf-connecting-ip'),
            public.request_header('x-real-ip')
        ), 100);
    v_ua := left(public.request_header('user-agent'), 512);

    UPDATE public.service_terms
       SET term_text           = v_text,
           accepted_at         = now(),
           accepted_ip         = v_ip,
           accepted_user_agent = v_ua
     WHERE id = v_term.id
       AND accepted_at IS NULL
    RETURNING accepted_at INTO v_term.accepted_at;

    IF v_term.accepted_at IS NULL THEN
        -- Perdeu a corrida (não deveria acontecer com FOR UPDATE). Trata como aceito.
        RETURN jsonb_build_object('outcome', 'already_accepted');
    END IF;

    RETURN jsonb_build_object(
        'outcome', 'accepted',
        'accepted_at', v_term.accepted_at
    );
END;
$$;

COMMENT ON FUNCTION public.accept_service_term(uuid) IS
    'Aceite eletronico do termo pelo freela. Re-renderiza e CONGELA term_text junto com accepted_at '
    '(ADR-20260818). Outcomes: unauthenticated | not_found | forbidden | already_accepted | payment_voided | '
    'missing_cpf | accepted. IP/UA best-effort (podem vir NULL). NAO move saldo (Article 8).';

REVOKE ALL ON FUNCTION public.accept_service_term(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_service_term(uuid) TO authenticated, service_role;
```

### 3.7 GRANTs de tabela, policies, RLS

```sql
-- =============================================
-- 9. GRANTS DE TABELA
-- =============================================
-- ⚠️ NUNCA `REVOKE ALL ... FROM PUBLIC` em TABELA (só em função). Em tabela, revogar de
-- anon é o suficiente e é o padrão do projeto.
REVOKE ALL ON public.service_terms FROM anon;

-- authenticated LÊ e só. Não há INSERT/UPDATE/DELETE para o client em nenhuma hipótese:
-- as duas únicas escritas são o trigger de geração e a RPC de aceite, ambos SECURITY DEFINER.
GRANT SELECT ON public.service_terms TO authenticated;

-- service_role: leitura + a alavanca de anonimização. SEM INSERT (quem insere é o trigger,
-- que roda como owner) e SEM DELETE (auditoria não se apaga). Deliberadamente diferente do
-- `GRANT ALL TO service_role` de shift_payments.
GRANT SELECT, UPDATE ON public.service_terms TO service_role;

-- =============================================
-- 10. POLICIES (antes do ENABLE RLS)
-- =============================================
-- SELECT: só as duas partes. Empresa por is_company_owner (ancoragem DUPLA —
-- ADR-20260817-seam-autorizacao-empresa), superset do critério de sp_select_participants.
DROP POLICY IF EXISTS "st_select_participants" ON public.service_terms;
CREATE POLICY "st_select_participants" ON public.service_terms
    FOR SELECT TO authenticated
    USING (
        worker_id = (SELECT auth.uid())
        OR public.is_company_owner(company_id)
    );

-- SEM policy de INSERT / UPDATE / DELETE para authenticated. Intencional:
-- a única escrita é via trigger e RPC SECURITY DEFINER. A imutabilidade, porém, NÃO
-- depende disso — depende do trigger (§7), porque service_role e owner ignoram RLS.

-- =============================================
-- 11. RLS (depois das policies; SEM FORCE — ver 20260630000000)
-- =============================================
ALTER TABLE public.service_terms ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- DOWN (rollback) — sem impacto em saldo/escrow (nenhuma RPC financeira tocada):
--   DROP TRIGGER IF EXISTS trg_generate_service_term_insert ON public.shift_payments;
--   DROP TRIGGER IF EXISTS trg_generate_service_term_update ON public.shift_payments;
--   DROP TRIGGER IF EXISTS trg_enforce_service_term_immutability ON public.service_terms;
--   DROP FUNCTION IF EXISTS public.accept_service_term(uuid);
--   DROP FUNCTION IF EXISTS public.enforce_service_term_immutability();
--   DROP FUNCTION IF EXISTS public.generate_service_term_on_payment();
--   DROP FUNCTION IF EXISTS public.request_header(text);
--   DROP FUNCTION IF EXISTS public.render_service_term_text(text,text,text,text,text,date,numeric,text);
--   DROP TABLE IF EXISTS public.service_terms;   -- ⚠️ destrói termos ACEITOS. Exportar antes.
--   ALTER TABLE public.shift_payments DROP CONSTRAINT IF EXISTS uq_shift_payments_identity;
-- ============================================================================
```

---

## 4. Contrato consumido pelo frontend

### `types/index.ts` (à mão, Article 2)

```ts
export interface ServiceTerm {
  id: string;
  shift_payment_id: string;
  job_id: string;
  worker_id: string;
  company_id: string;
  term_version: string;
  /** Rascunho enquanto accepted_at é null; snapshot congelado depois. */
  term_text: string;
  amount: number;
  created_at: string;
  /** null = pendente. Único estado do termo — não existe coluna `status`. */
  accepted_at: string | null;
  /** BEST-EFFORT e falsificável. Pode vir null. Nunca rotular como "verificado" na UI. */
  accepted_ip: string | null;
  /** BEST-EFFORT. Pode vir null. */
  accepted_user_agent: string | null;
  anonymized_at: string | null;
}

export type ServiceTermAcceptOutcome =
  | 'accepted'
  | 'already_accepted'
  | 'unauthenticated'
  | 'not_found'
  | 'forbidden'
  | 'payment_voided'
  | 'missing_cpf';
```

### `services/serviceTermService.ts`

- `getByShiftPayment(shiftPaymentId)` → `.from('service_terms').select('*').eq('shift_payment_id', …).maybeSingle()`.
  **Chaveado no pagamento, nunca no `job_id`** — existem N termos por `(job_id, worker_id)` ao longo do tempo
  (um por marcador, incluindo os estornados). Um `getByJob` devolveria o termo errado. **Não criar.**
- `acceptServiceTerm(serviceTermId)` → `.rpc('accept_service_term', { p_service_term_id })`, lê
  `data.outcome`. `data` é `jsonb` (objeto), não string.
- Sem `service_role`, sem RPC financeira, `logError`, `.from` direto (Articles 5/8/10).

### Notas para o builder de UI

- `ReceiptView.tsx:189` usa `isCompanyViewer = currentUserId === payment.company_id` — **ancoragem simples**,
  enquanto a RLS da tabela nova usa `is_company_owner` (dupla). Um operador ancorado por `companies.owner_id`
  **lê** a linha mas a UI o trata como "nem worker nem company". Não corrigir nesta fatia (fora de escopo),
  mas **não replicar** o padrão no bloco novo: derivar a visão do termo de `isWorkerViewer` e do fato de a
  linha ter sido retornada pela RLS.
- Termo só existe para `payment.status === 'recorded'`. Em `scheduled`, `getByShiftPayment` devolve `null` e o
  bloco não renderiza (A8).
- Nada na UI pode dizer "verificado pela Worki", "validado", "documento oficial", "assinatura digital
  certificada". O aviso amarelo do rodapé é obrigatório **além** da cláusula 4 já embutida no texto.

---

## 5. Verificação (read-only, depois de aplicar)

```sql
-- V0. PRÉ-MERGE: dimensionar a população que bate em missing_cpf.
--     Se der 0, o branch é puramente defensivo. Se der >0, é campanha de perfil, não redesenho.
SELECT count(*) AS workers_sem_cpf_valido
  FROM public.workers
 WHERE length(regexp_replace(coalesce(cpf, ''), '\D', '', 'g')) <> 11;

-- V1. Estrutura: FKs de service_terms devem ser TODAS 'r' (RESTRICT). Nenhum 'c' (CASCADE).
SELECT conname, confdeltype
  FROM pg_constraint
 WHERE conrelid = 'public.service_terms'::regclass AND contype = 'f';

-- V2. RLS ligada, FORCE desligada.
SELECT relrowsecurity, relforcerowsecurity
  FROM pg_class WHERE oid = 'public.service_terms'::regclass;
-- ESPERADO: true, false

-- V3. Policies: exatamente UMA, de SELECT.
SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.service_terms'::regclass;
-- ESPERADO: st_select_participants | r

-- V4. Grants: authenticated só com SELECT.
SELECT grantee, privilege_type FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name='service_terms' ORDER BY grantee, privilege_type;
-- ESPERADO: authenticated → SELECT (e nada mais); service_role → SELECT, UPDATE; anon ausente.

-- V5. Acentuação do texto de produto (landmine conhecido do projeto).
SELECT public.render_service_term_text(
    'Maria Aparecida', '12345678901', 'Divino Fogão Unidade Centro', '12345678000199',
    'Garçom — jantar', current_date, 180.00, 'modelo-worki-v1');
-- CONFERIR NA SAÍDA: "PRESTAÇÃO", "AUTÔNOMO", "TRIBUTÁRIA", "não informado",
-- "contribuições previdenciárias", "à plataforma Worki", "eletrônico".

-- V6. delete-account ainda funciona? Ver se workers.id cascateia de auth.users
--     (se cascatear, os RESTRICT de shift_payments/service_terms travam deleteUser).
SELECT conname, confdeltype
  FROM pg_constraint
 WHERE conrelid = 'public.workers'::regclass AND contype = 'f'
   AND confrelid = 'auth.users'::regclass;
-- 'c' = CASCADE → há bug latente (pré-existente, agravado por esta feature). Reportar.

-- V7. Ordem dos AFTER triggers em shift_payments (alfabética).
SELECT tgname FROM pg_trigger
 WHERE tgrelid='public.shift_payments'::regclass AND NOT tgisinternal ORDER BY tgname;

-- V8. Ops (rodar periodicamente no piloto): pagamento recorded SEM termo = falha silenciosa.
--     Deve ser sempre 0. Se não for, o trigger não disparou (linhas anteriores ao deploy
--     não contam — backfill é out-of-scope).
SELECT sp.id, sp.job_id, sp.worker_id, sp.paid_at
  FROM public.shift_payments sp
  LEFT JOIN public.service_terms st ON st.shift_payment_id = sp.id
 WHERE sp.status = 'recorded'
   AND st.id IS NULL
   AND sp.created_at > '2026-08-18'::date;
```

### Smoke test manual (obrigatório antes do merge)

1. Registrar pagamento `recorded` → conferir que nasceu 1 linha em `service_terms` com `accepted_at IS NULL`.
2. Como o freela, `select` na linha → volta. Como um terceiro autenticado → **0 linhas** (A5).
3. Como o freela, tentar `update` direto via PostgREST em `term_text` → negado (sem policy).
4. Como `service_role`, tentar `update` em `term_text` de um termo **aceito** → `EXCEPTION` do trigger (C2).
   **Este é o teste que a F3 não teve.**
5. `accept_service_term` duas vezes seguidas → `accepted` depois `already_accepted`, com `accepted_at`
   idêntico (A7).
6. Estornar o pagamento (`voided`) e chamar a RPC num termo pendente → `payment_voided`.

---

## 6. Ajustes obrigatórios no `spec.md`

O builder deve tratar estes critérios como **reescritos**:

- **R1:** `shift_payment_id ... ON DELETE RESTRICT` (não CASCADE). Somar `anonymized_at`.
- **R3:** o trigger grava **rascunho**; não "snapshot congelado".
- **R4:** o CPF ausente segue bloqueando o aceite, **e agora isso compra algo** — o texto é re-renderizado no
  aceite, então o documento assinado sai com o CPF preenchido.
- **R6:** a imutabilidade **não** vem da ausência de policy; vem do trigger `enforce_service_term_immutability`.
  A frase "a imutabilidade dos campos materiais vem de nunca existir um caminho de UPDATE aberto ao client"
  está **errada** e não pode ser reproduzida em comentário de código.
- **A4 (reescrito):** *"Dado um termo já **aceito**, quando qualquer parte reabre `/recibo/:jobId` (inclusive
  depois de o freela editar o próprio CPF), então o `term_text` exibido é o snapshot congelado **no momento do
  aceite** (não recalculado), e 'Imprimir' inclui o texto do termo."*
- **A6 (reforçado):** além do aviso na UI, a cláusula "a Worki não é parte / não valida / não garante" tem de
  estar **dentro** de `term_text` e aparecer na impressão.
- **A9 (reescrito):** *"Dado um `shift_payment` estornado com termo já aceito, então a linha de `service_terms`
  **permanece no banco e legível pela RLS das duas partes** (nunca é deletada), e uma nova chamada a
  `accept_service_term` devolve `payment_voided`. **A tela `/recibo/:jobId` não exibe esse histórico** —
  `getReceipt()` filtra `status IN ('scheduled','recorded')` e devolve `null` para um pagamento estornado
  (mesmo motivo pelo qual `20260816140000` linka estorno para `/recebimentos`). Exibir termo de pagamento
  estornado é out-of-scope desta fatia."*

---

## 7. Landmines (o builder lê esta lista antes de escrever a primeira linha)

1. **`REVOKE ALL ... FROM PUBLIC` em TABELA: nunca.** Só em função (onde é obrigatório). Em `service_terms`,
   revogar de `anon` e ponto.
2. **Funções de trigger MANTÊM `EXECUTE` para `authenticated`.** `generate_service_term_on_payment` e
   `enforce_service_term_immutability` são disparadas por usuários autenticados e o privilégio é checado
   contra a sessão. Revogar quebra o registro de pagamento. É exatamente o incidente de `20260816201420`,
   revertido por `20260816201457`.
3. **`render_service_term_text` e `request_header` são o caso oposto:** só `service_role`, porque só são
   chamadas de dentro de funções `SECURITY DEFINER` de propriedade de `postgres`. Se algum chamador virar
   `SECURITY INVOKER`, os GRANTs mudam junto.
4. **Policies antes de `ENABLE RLS`. `NO FORCE`** (`FORCE` bloquearia o `service_role`, ver `20260630000000`).
5. **`LANGUAGE sql` valida o corpo no `CREATE`** — funções que leem `service_terms` só depois do `CREATE
   TABLE`. (`render_service_term_text` não lê tabela, então é imune — mas a ordem de §2 vale mesmo assim.)
6. **Nunca `||` na montagem do texto.** `'x' || NULL` = `NULL`, `term_text` é `NOT NULL` → `23502` abortando o
   registro do pagamento da empresa. `concat()` + `coalesce()`, sempre.
7. **`render_service_term_text` é `STABLE`, não `IMMUTABLE`** — `to_char(numeric, text)` depende de
   `lc_numeric`. Marcar `IMMUTABLE` é mentira e habilita constant-folding indevido.
8. **Nada de `::inet`** em `accepted_ip`. Header lixo → `22P02` → aceite derrubado.
9. **Texto acentuado**: conferir a saída de V5 **depois de aplicar** (`PRESTAÇÃO`, `AUTÔNOMO`, `TRIBUTÁRIA`,
   `contribuições previdenciárias`, `eletrônico`). Já houve migration de correção só de acentos
   (`20260816201322`).
10. **`ON CONFLICT (shift_payment_id) DO NOTHING`** exige a `UNIQUE` na coluna — ela está na declaração da
    tabela. Não trocar por `NOT EXISTS` (corrida sob concorrência).
11. **O trigger de geração não pode escrever em `shift_payments`.** Reentraria no `BEFORE UPDATE` de
    `enforce_shift_payment_immutability` e explodiria na imutabilidade das colunas materiais.
12. **`data` da RPC é `jsonb` (objeto)**, não string: ler `data.outcome`, não comparar `data === 'accepted'`.
13. **Não criar `getByJob`** no service. N termos por `(job, worker)` ao longo do tempo; a chave é o pagamento.
14. **Não adicionar** `validated_by`, `status`, `company_accepted_at`, `signature_hash` ou qualquer coisa que
    posicione a Worki como validadora — nem "só para debugar". Ver §1 pergunta 5.
15. **`getReceipt()` filtra `status IN ('scheduled','recorded')`** — não tente exibir termo de pagamento
    estornado por `/recibo/:jobId`; não tem como chegar lá.
16. **Numeração:** `20260817001100`. A F5 ocupa `20260817000900`+. Última aplicada em produção:
    `20260817000800`.

---

## 8. Fora do escopo do builder (mas bloqueante de PILOTO)

- **Política de Privacidade** precisa declarar a retenção de termos aceitos após exclusão de conta, com base
  legal (LGPD Art. 7, VI / Art. 16, I-II). Sem isso, o piloto grava CPF de conta apagada sem informar.
- **Validação do texto do termo por advogado do owner** — a spec já joga fora de escopo e está certa.
  O schema garante que a Worki não se posiciona como parte; não garante que o texto funciona.
