# ADR-20260822 — Fronteira LGPD × multi-unidade: vínculo de operação é soft-remove, e `pg_constraint` não basta como guarda

## Status

ACEITO (21→22/08/2026). Emenda pontual a `.harness/spec/lgpd-producao/ddl-aprovado.md`
(§2.1, §2.1.1, §2.1.2, §2.2, §2.5, §4.4, §5.4) e a
`supabase/migrations/20260821000000_lgpd_account_anonymization.sql`.
Complementa ADR-20260821-lapide-neutraliza-acao-referencial e ADR-20260821-anonimizacao-em-vez-de-exclusao.

## Contexto

A leva de LGPD (débito #5) troca "excluir a conta" por **lápide pseudônima**: a credencial em
`auth.users` é apagada, as linhas de `workers`/`companies` sobrevivem sem conteúdo pessoal, e as FKs
`CASCADE` para `auth.users` são **removidas** (H2). Consequência já registrada em ADR-20260821: a
lápide nunca é apagada, logo **nenhum `ON DELETE` dispara mais** — o que o banco limpava de graça
virou código na RPC. A asserção (c) da migration foi o mecanismo criado para descobrir tabela nova:
enumera `pg_constraint` contra `workers`/`companies` e **HALTa** se algum dependente não estiver na
allow-list classificada.

A F13 (multi-unidade) introduz três tabelas — `organizations`, `organization_members`,
`company_members` — e expôs, no mesmo dia, os dois lados do mecanismo:

1. **`company_members` tem FK para `companies`** e portanto seria vista — a ponto de **travar** a
   migration de LGPD. A F13 ordena em `20260818100000`, antes de `20260821000000`: em todo replay de
   CI/staging a partir do zero, a asserção (c) HALTaria. Em produção, onde a fila incremental põe a
   LGPD primeiro, a asserção não veria nada e a lacuna passaria **em silêncio**. O mesmo defeito
   falhando de formas opostas conforme o ambiente.
2. **`organization_members.user_id` e `organizations.created_by` são `uuid` nu, sem FK** —
   invisíveis para a asserção (que lê `pg_constraint`) **e** para `anonymize_account` (que resolve
   o escopo por FK). Um sócio anonimizado permaneceria `status='active'`.

Levantou-se também que o gerente da F13, depois de `accept_manager_invite`, **não tem linha em
`workers` nem em `companies`** (a casca de `companies` é apagada de propósito) — classe de usuário
para a qual `anonymize_account` devolve `not_found`.

Nada das duas levas está aplicado. F1–F12, dívida #9 e DS-PII estão em produção.

## Decisão

### D1 — `company_members` e `organization_members`: **SOFT-REMOVE**, nunca `DELETE`

`status='removed'` (valor do `CHECK` existente — **não** `'revoked'`, que não é aceito),
`invited_email = NULL`, `invite_token = NULL`. `user_id`, `created_by`, `invited_at` e
`accepted_at` são **retidos** como trilha pseudônima.

- `DELETE` está fora porque **a própria F13 já recusou apagar este vínculo**
  (`revoke_company_manager`: "NUNCA DELETE"; `ON DELETE RESTRICT` em `company_id`). A rotina de
  LGPD não pode ser a porta dos fundos que faz o que a RPC do produto proíbe. Some o registro de
  quem operou a unidade e quando, enquanto turnos, convites e pagamentos criados por essa pessoa
  continuam existindo, pendurados na unidade, sem referência de autoria.
- **Reter** está fora sem discussão: `status='active'` é autorização operacional.
- O que sai é **PII, não a linha**: `invited_email` é e-mail de pessoa natural (dado pessoal
  direto, não pseudônimo) e `invite_token` é credencial portadora — convite pendente de conta
  excluída não pode continuar resgatável.
- **Dois predicados em `company_members`** (`user_id` do titular **ou** `company_id` das empresas do
  titular): quando a **empresa** sai, seus gerentes são terceiros que continuam na plataforma; a
  unidade virou lápide, ninguém opera lápide, e o e-mail deles perde a base que o sustentava.
- **`organization_members` NÃO tem ramo por empresa**: a organização pertence também às unidades
  **irmãs, de outros sócios**. Excluir a conta de um sócio não desliga os demais. O segundo
  predicado cobre o convite **ainda pendente** emitido por quem está saindo.

### D2 — `organizations` é RETIDA, protegida pela **GUARDA 4**

`name` é o nome da rede, compartilhado com as irmãs — apagá-lo é dano a terceiro. Mas a retenção só
é segura acompanhada de uma guarda: `anonymize_account` **recusa** com
`outcome='sole_organization_owner'` quando o titular é o **único `role='owner'` ativo** de uma
organização que ainda tem unidade **que não é dele**. Sem isso, fechar os `organization_members`
deixaria a rede **órfã** — ninguém passa em `is_organization_operator`, e os dois
`ON DELETE RESTRICT` impedem qualquer limpeza. Rede inoperável **e** inapagável, com unidades de
sócios que não pediram nada. Mesma filosofia das guardas 1–3: recusar e dizer o que fazer, em vez de
destruir em silêncio. Remediável pelo próprio titular (promover outro sócio). ⚖️ §5.4 J1.

### D3 — **Não** exigir FK. A guarda ganha duas varreduras **por nome de coluna**

A pergunta "a asserção deve ganhar segunda varredura ou a resposta é exigir FK?" tem resposta
assimétrica: **exigir FK é ativamente errado aqui.** Uma FK de `organization_members.user_id →
auth.users` teria que escolher entre `CASCADE` — que apagaria a linha e destruiria a trilha que D1
acabou de preservar — e `NO ACTION`/`RESTRICT`, que voltaria a **bloquear o `deleteUser`**, que é o
bug que esta leva inteira existe para corrigir. Exigir FK seria desfazer H2 por outro nome.

Portanto **"uuid nu apontando para gente" é a forma canônica e permanente deste desenho**, e
qualquer guarda que dependa só do catálogo de FK nasce incompleta. Entram:

- **(d)** coluna `uuid` cujo **nome** está no vocabulário de ponteiro-de-pessoa (`user_id`,
  `owner_id`, `created_by`, `worker_id`, `company_id`, `reviewer_id`, `recorded_by`, …), em tabela
  `public` fora da lista classificada → HALT.
- **(e)** coluna cujo nome casa `(email|phone|cpf|cnpj|pix|birth_date|full_name)`, idem → HALT.
  Pega dado pessoal **direto** independentemente da questão de uuid; teria pego
  `company_spend_limits.financial_contact_email` meses antes.

Granularidade de **tabela** (igual a (c)); `pg_catalog` e **não** `information_schema` (que filtra
por privilégio e portanto **falha aberto**).

**Regra de construção permanente:** toda migration que criar tabela com ponteiro-de-pessoa ou coluna
de contato classifica a tabela em §2.1 **na mesma migration**. O catálogo *descobre*; a lista à mão
apenas *declara que foi decidido*.

### D4 — `not_found` é FALHA; a classe GERENTE é dependência da F13

A Edge Function `delete-account` **não** pode tratar `not_found` como "nada a fazer" e seguir para
`deleteUser`: apagaria a credencial deixando `company_members` `active` com `invited_email` intacto.
Responde 400 e aborta. O **reconhecimento** do gerente (deixar de devolver `not_found` para quem tem
membership) é emenda mínima que pertence à **migration da F13**, que ordena depois — o corpo de
`anonymize_account` já age sobre as tabelas via `to_regclass`. E2E de exclusão de conta de gerente é
critério de aceite da F13, não desta leva.

### D5 — correção de `regclass::text` (achado colateral, classe blocker)

As varreduras existentes comparavam `conrelid::regclass::text` contra `'public.shift_payments'`.
`regclass::text` **omite o schema** quando ele está no `search_path`, e as migrations do Supabase
rodam com `public` no `search_path`: a asserção (c) acusaria **todas** as tabelas. Nunca detonou
porque a migration nunca foi aplicada. Trocado por `format('%I.%I', ns.nspname, cl.relname)` em (c),
(d), (e) e na varredura de `CASCADE` remanescente do §2.3.

## Consequências

### Positivas

- A migration de LGPD deixa de travar no replay de CI, **e** a lacuna deixa de ser silenciosa em
  produção — os dois modos de falha somem com uma edição de arquivo, porque nada foi aplicado.
- A guarda passa a cobrir a dependência **real**, não só a **declarada** — a classe de bug que
  produziu `financial_contact_email`, `worker_referrals` e `worker_company_badge_prefs` fica coberta
  por mecanismo, não por memória de revisor.
- O vínculo de operação ganha uma regra única: LGPD e produto dizem a mesma coisa (soft, nunca
  DELETE), em vez de duas rotas com reversibilidades diferentes sobre a mesma linha.
- Rede órfã e inapagável deixa de ser possível.
- D5 corrige um guard que estava quebrado e verde.

### Negativas / Trade-offs

- A allow-list cresce de 13 nomes para ~40 (todas as tabelas de `public`). É **declaração**, não
  decisão — mas é manutenção real, e a primeira aplicação em staging pode revelar tabelas que este
  repositório não conhece (as tabelas base foram criadas fora de migration). HALT nesse caso é o
  comportamento correto, não um defeito.
- As varreduras por nome são **vocabulário**: uma coluna chamada `dono` ou `pessoa_ref` escapa.
  Mitigado pela regra de construção, não eliminado. Conscientemente preferido a exigir FK (que
  quebraria H2) ou a varrer todo `uuid` (ruído que faria a guarda ser ignorada).
- `company_members` sobrevive à exclusão com `user_id`/`created_by`. É pseudônimo sob a mesma régua
  já aceita, mas é retenção **sem prazo** — se J2 vier contrário, a linha migra para o expurgo (#3).
- A GUARDA 4 pode bloquear a exclusão de um sócio único até que ele promova outro. ⚖️ J1.
- Tabelas legadas Prisma (`"User"`, `"ClientReview"`, `"FreelancerReview"`, `messages`, …) entraram
  na allow-list para não HALTar: "olhamos e adiamos", não "resolvido". Dívida em §5.3.

## Alternativas rejeitadas

- **`DELETE` em `company_members`**: contradiz a decisão da própria F13 e deixa turnos/pagamentos
  sem referência de autoria. Ver D1.
- **Reter o vínculo intocado**: acesso operacional depois do pedido de exclusão. Inaceitável.
- **Exigir FK para toda coluna que aponta para pessoa**: desfaz H2 e reabre o bug do `deleteUser`.
  Ver D3 — esta é a alternativa que parecia óbvia e é a mais errada.
- **Varrer todo `uuid` sem filtro de nome**: ruído em toda tabela do schema; guarda ruidosa é guarda
  desligada.
- **Deixar a classificação para uma migration nova depois da F13**: só funcionaria em produção; o CI
  continuaria HALTando, e produção ficaria com a janela silenciosa entre F13 e a correção.
- **Anonimizar as unidades irmãs junto** (usar a costura da F13 para resolver escopo de empresa em
  vez da ancoragem dupla `id`/`owner_id`): a exclusão de **um** sócio apagaria o perfil de **dez**
  restaurantes. A ancoragem dupla em `anonymize_account` é **deliberada** e não deve ser
  "consertada" para usar `is_company_owner` pós-F13.

## Referências

- Contrato: `.harness/spec/lgpd-producao/ddl-aprovado.md` §2.1, §2.1.1, §2.1.2, §2.5, §4.4, §5.4
- Migration: `supabase/migrations/20260821000000_lgpd_account_anonymization.sql`
- F13: `.harness/spec/multi-unidade/ddl-aprovado.md`; `20260818100000`, `20260818100300`,
  `20260821001000`, `20260821001100`
- ADR-20260821-lapide-neutraliza-acao-referencial · ADR-20260821-anonimizacao-em-vez-de-exclusao ·
  ADR-20260821-uuid-de-freela-nao-e-credencial-de-pii · ADR-20260817-seam-autorizacao-empresa
