# ADR-20260822 — Fronteira LGPD × multi-unidade: vínculo de operação é soft-remove, e `pg_constraint` não basta como guarda

## Status

ACEITO (21→22/08/2026). **REVISADO em 22/08/2026** pelo gate do architect, provocado por rejeição do
evaluator: **D4 mudou de lugar** (o reconhecimento da classe gerente fica na migration de LGPD, não
na da F13 — ver D4), **D1 ganhou um terceiro predicado** em `company_members`, e entrou **D6**
(redação de texto livre em tabela retida). Emenda a
`.harness/spec/lgpd-producao/ddl-aprovado.md` (§2.1, §2.1.1, §2.1.2, §2.2, §2.5, §4.4, §5.3, §5.4,
§5.5) e a `supabase/migrations/20260821000000_lgpd_account_anonymization.sql`.
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
- **TERCEIRO predicado (revisão 22/08): `status='invited' AND created_by = <titular>`.** Quem emite
  convite de gerente é o **operador de rede** (`invite_company_manager` exige
  `is_organization_operator`), logo ele convida para unidades **irmãs** — que **não** estão em
  `v_company_ids`. Com o portão da classe gerente/sócio aberto (D4), a exclusão passaria a apagar a
  credencial deixando para trás linhas `status='invited'` com `invited_email` **de terceiro** e
  `invite_token` **vivo** (índice único, 7 dias), assinadas por uma conta inexistente: credencial
  portadora resgatável emitida por ninguém. **Restrito a `'invited'` de propósito** — a linha
  **ativa** é do **gerente**, terceiro que opera unidade de outro dono, e `created_by` ali é só a
  trilha de quem convidou; derrubar o acesso dele porque o convidante saiu seria dano a terceiro.
  É a **simetria exata** do predicado que `organization_members` já tinha; a assimetria era o bug.
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

### D4 — `not_found` é FALHA **e** a classe GERENTE é reconhecida **nesta** migration (revisado 22/08)

A Edge Function `delete-account` **não** pode tratar `not_found` como "nada a fazer" e seguir para
`deleteUser`: apagaria a credencial deixando `company_members` `active` com `invited_email` intacto.
Responde 400 e aborta. **Isso continua valendo.**

**O que mudou.** A versão original mandava fazer o **reconhecimento** do gerente (deixar de devolver
`not_found` para quem tem membership) "na migration da F13, que ordena depois". Duas correções:

1. **Só a Edge Function não basta — seria trocar um furo de segurança por um furo de direito.**
   Abortar em `not_found` protege o vínculo, mas deixa o gerente **permanentemente impedido** de
   excluir a própria conta, dentro da rotina que existe para cumprir o art. 18, VI. O portão certo
   é reconhecer a classe, não recusá-la.
2. **"Na migration da F13" só funciona em produção.** Em replay do zero, a F13 é `20260818100000`
   e roda **antes** de `20260821000000`: um `CREATE OR REPLACE anonymize_account` lá seria
   **sobrescrito** por esta migration, e o reconhecimento **existiria em produção e sumiria em CI**
   — exatamente o defeito que o Contexto deste ADR e o D5 existem para matar, reintroduzido pela
   recomendação do próprio ADR.

**Regra que fica: o corpo de `anonymize_account` tem um único dono — a migration que o define.**
Fronteira com feature futura se resolve com `pg_catalog.to_regclass` (execução dinâmica, no-op
enquanto a tabela não existir), **nunca** com reescrita da função a partir de outra leva. O
reconhecimento (`v_is_member`) está na migration de LGPD, guardado assim, e sobe junto com o
terceiro predicado de D1 — portão e predicado são a mesma decisão.

E2E de exclusão de conta de gerente **continua** sendo critério de aceite da F13 (só lá a classe
existe de verdade). O que a F13 **não** faz mais: tocar no corpo desta função.

**Corolário de forma (D4.1):** o retorno da rotina passa a declarar **`is_member`** e a nascer com
todas as chaves de `counts` em zero. Para a classe gerente o retorno era `is_worker=false`,
`company_ids=[]` e as chaves de domínio **ausentes** (viviam dentro de `IF`) — indistinguível de
"bug: as âncoras não resolveram". Chave ausente e chave zero são fatos diferentes; uma rotina de
LGPD tem de conseguir dizer "olhei e não havia nada".

### D6 — texto livre em tabela RETIDA é REDIGIDO; a linha é que fica (novo, 22/08)

`applications`, `jobs`, `shift_calls`, `shift_call_targets` e `shift_attendance_confirmations`
estavam classificadas como RETIDAS com a justificativa "chaves pseudônimas + timestamps, **nenhum
conteúdo pessoal**". **Isso era falso para três delas**, e falso de um jeito que o próprio contrato
já contradizia: ele **apaga** `companies.default_briefing` porque "é texto da empresa e pode conter
nomes", **deleta** `job_series` porque "`job_template` carrega o briefing — mesma classe" — e
`create_job_series` (`20260817000400`) escreve `jobs.briefing` **copiando `job_template`
literalmente**. A rotina apagava o **molde** e retinha as **cópias**. Nada disso constava dos riscos
residuais (§5.3), que registram `shift_payments.note`, `reviews.comment` e `verified_note` — a mesma
família.

**Decisão:** a **linha** continua retida (é âncora de `shift_payments`/`service_terms`, do BI e da
integridade referencial — apagá-la nunca esteve em jogo) e o **conteúdo** sai. É o padrão de
`ADR-20260821-expurgo-de-conteudo-nao-de-linha`, aplicado agora fora do expurgo por prazo.

- **Redigidas:** `jobs.briefing`, `jobs.description`, `jobs.requirements`,
  `jobs.certification_requirement` (empresa); `applications.cover_letter`, `applications.message`
  (freela — só o ramo do freela: o texto é dele, a empresa que sai não o apaga);
  `shift_calls.message` (empresa **ou** `created_by`, porque `shift_calls.company_id` e
  `created_by` são `uuid` nu, sem FK, e `created_by` é a única forma de alcançar o texto escrito
  pelo **gerente**, cuja unidade nunca aparece em `v_company_ids`).
- **A lista acima é do catálogo, não da memória (D6.1).** A primeira versão desta decisão
  enumerou as colunas que o revisor conhecia e deixou **duas** de fora:
  `jobs.certification_requirement` (F8 — `<input maxLength={200}>`, "texto livre, advisory" pelo
  comentário do próprio código) e `applications.message`. Ambas com **0 linhas hoje** — a primeira
  porque o F8 acabou de subir, a segunda por ser legada do pull. **Volume não é critério de
  classificação:** classificar coluna vazia custa uma linha; classificar depois que ela enche
  custa uma migration nova *e* um intervalo em que o dado sobreviveu à exclusão. Na mesma
  varredura, dois falsos positivos foram descartados **com evidência** — `jobs.scope` (2 valores
  distintos, 7 chars) e `applications.invitation_response` (1 valor distinto, 8 chars) são enums
  em coluna `text`.
- **A classificação textual dessas três tabelas passa a ser FECHADA (D6.2 — asserção `(b2)`).**
  As asserções (a)/(b) varrem coluna a coluna só `workers`/`companies`; (c)/(d)/(e) têm
  granularidade de **tabela** — uma coluna de texto livre nova em `jobs` entraria retida em
  silêncio, que foi exatamente como `certification_requirement` passou. Agora toda coluna textual
  de `jobs`/`applications`/`shift_calls` tem de estar redigida **ou** retida; coluna nova ⇒
  **HALT**. Isto só pôde ser escrito **depois** do catálogo: enumerar às cegas produziria HALT
  garantido e lista inventada — guarda fail-closed com lista inventada é pior que guarda ausente,
  e por isso a lacuna ficou registrada como pendência (Hh2) até o dado chegar.
- **Marcador, não `NULL`:** `jobs.title`/`location` mostram que este schema tem coluna textual
  `NOT NULL` e a lista vai crescer — um `NULL` em coluna `NOT NULL` estouraria **dentro** da
  transação destrutiva, com metade da conta já anonimizada. O marcador também explica o vazio para
  a contraparte em vez de parecer defeito. Acompanhado da asserção **(a2)**, que exige que cada
  coluna redigida exista **e seja textual** antes de a parte destrutiva começar.
- **`jobs.title` e `jobs.location` ficam** — decisão escrita, não omissão: não são narrativa livre,
  são o rótulo operacional e o local que o **freela (terceiro que continua na plataforma)** lê no
  próprio recibo, e ambos já estão **congelados** dentro de `service_terms.term_text` aceito, que é
  retido integralmente como prova. Apagar em `jobs` não elimina a informação e degrada dado de
  terceiro. Risco residual registrado.

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
- *(revisão 22/08)* O gerente/sócio deixa de ser a única classe de usuário sem caminho de exclusão,
  **e** o convite que ele emitiu para unidade irmã deixa de sobreviver como token vivo assinado por
  conta inexistente. As duas coisas são a mesma decisão e sobem juntas.
- *(revisão 22/08)* O contrato deixa de dizer "nenhum conteúdo pessoal" sobre tabelas que têm texto
  livre — e a rotina deixa de apagar o molde guardando as cópias.

### Negativas / Trade-offs (revisão 22/08)

- A varredura fechada cobre `jobs`, `applications` e `shift_calls`, mas **não**
  `shift_call_targets` nem `shift_attendance_confirmations` (não inventariadas), e (b2) por
  construção **não alcança `metadata jsonb`** — nenhuma asserção textual alcança. Registrado em
  §5.3; fechar exige o mesmo trabalho de catálogo.
- (b2) é uma allow-list mantida à mão: vai HALTar em toda coluna textual nova dessas três tabelas,
  inclusive as óbvias e inofensivas. É o custo aceito — o mesmo já pago em (c)/(d)/(e) — para que
  a decisão sobre texto livre seja sempre **escrita**, nunca implícita.
- O marcador de redação aparece na UI da contraparte (recibo, histórico). É deliberado — vazio
  silencioso parece defeito — mas é copy que ninguém revisou ainda.
- `jobs.title`/`location` da empresa excluída sobrevivem e podem conter dado pessoal. Aceito com
  justificativa (o termo aceito já os congela como prova); remoção específica = atendimento manual.

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
- **Emendar `anonymize_account` a partir da migration da F13** (D4 original): funciona só em
  produção; em CI a F13 roda antes e a emenda é sobrescrita. Ver D4 revisado.
- **Deixar `jobs`/`applications`/`shift_calls` retidas e apenas registrar o texto livre em §5.3**
  (risco residual): seria coerente se o contrato não **apagasse** o molde (`default_briefing`,
  `job_template`) do mesmo texto. Registrar como risco o que a rotina já trata em outro lugar é
  escolher a inconsistência e chamá-la de decisão.
- **Apagar a linha de `jobs`/`applications`** em vez de redigir: destrói âncora de
  `shift_payments`/`service_terms`, o BI e o registro da contraparte. Nunca esteve em jogo.
- **Usar `NULL` em vez de marcador**: quebra em coluna `NOT NULL` no meio da transação destrutiva.
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
