# Débitos pré-piloto

> Itens levantados pelas revisões durante as features F1–F7 que NÃO bloqueiam merge técnico
> mas precisam ser resolvidos antes do piloto com cliente real. Atualizar ao fechar cada um.

## 1. Política de Privacidade desatualizada — 2 campos novos de dado pessoal

**Origem:** security-reviewer F6 e F7.

- **`service_terms` (F6):** termo de prestação com CPF, nome e valor congelados no aceite, retidos
  indefinidamente. A política vigente não declara essa retenção.
- **`workers.availability_days` (F7):** rotina semanal declarada do freela. É perfil comportamental
  (quando está livre ⇒ quando não está), classe de risco próxima a geolocalização de rotina.
  Visível a empresas com vínculo, armazenado indefinidamente. Não consta como categoria coletada.
- **`worker_certifications` / `worker_trainings` (F8):** certificação profissional declarada
  (título, emissor, número de registro de conselho, validade) e histórico de treinamento interno
  registrado pela empresa. É dado profissional, retido indefinidamente e visível a empresas com
  vínculo. Não consta como categoria coletada na política vigente. **Delimitação explícita a
  declarar:** o Worki **não** coleta documento de saúde (atestado, ASO, exame, vacinação) e
  **não** armazena o arquivo do certificado (v1 é só metadado — ADR-20260821).

**Gate:** LGPD. Não é cortesia — é base legal para o dado que já estamos gravando.

## 2. ✅ RESOLVIDO — `{}` passava no CHECK de `availability_days` (25/08/2026)

**Origem:** security-reviewer F7 (registrado como NOTA consciente).

Containment de objeto vazio (`'{}'::jsonb <@ qualquer`) é sempre verdadeiro, então o CHECK
`workers_availability_days_shape` não barra `{}`. Hoje só não vira bug porque
`normalizeAvailabilityGrade` converte para `null` antes de gravar — a garantia está no client,
não no banco. Qualquer client alternativo, RPC futura ou regressão no normalizador grava `{}`,
e o CTA "Declarar disponibilidade" (R14) some silenciosamente para esse freela: a UI checa
"tem grade?" e `{}` responde que sim, sem nenhum período dentro.

**Correção:** adicionar `AND p <> '{}'::jsonb` (ou exigir cardinalidade >= 1) ao CHECK.

## 3. ✅ RESOLVIDO — `/profile` ganhou campo de CPF (25/08/2026)

> Não era hipótese: **4 dos 15 freelas em produção estão sem CPF**, e todos travariam no primeiro
> turno pago do piloto — já trabalharam, a empresa registra o pagamento, e `acceptServiceTerm`
> devolve `missing_cpf` sem tela onde resolver.
>
> O campo entrou em `pages/Profile.tsx` com a mesma validação do onboarding (11 dígitos +
> `validateCPFOrCNPJ`) e máscara de exibição. **Editável só enquanto vazio:** depois de gravado, o
> CPF identifica a pessoa nos termos já assinados, e campo livre ali seria vetor de fraude. A
> guarda está no payload (`cpf` só entra no update quando não havia CPF antes), então nem uma
> regressão futura na UI sobrescreve.
>
> Verificado no browser contra o cenário real (conta com CPF zerado): mostra "Não informado" →
> edita → grava `11144477735` no banco → reexibe formatado → e ao reeditar **o campo não aparece
> mais**. Fecha também a dependência do item #8.

### Diagnóstico original

**Origem:** F6, outcome `missing_cpf` de `acceptServiceTerm`.

O termo exige CPF. Se o freela não tem CPF cadastrado, o aceite falha e **não há tela onde ele
possa resolver isso sozinho** — `/profile` não expõe o campo. A mensagem hoje é honesta ("fale com
a empresa ou o suporte"), mas o caminho continua sendo humano.

**Correção:** campo de CPF em `pages/Profile.tsx` com a mesma validação do onboarding.

## 4. ✅ RESOLVIDO — GRANT amplo demais em `service_terms` (25/08/2026)

**Origem:** F6. Roteado ao architect, ainda sem parecer.

O grant permite ao papel escrever `term_text` livremente; a imutabilidade é garantida só pelo
trigger `enforce_service_term_immutability`. Defesa em profundidade pede o grant estreitado ao
mínimo que a RPC de aceite precisa.

## 5. ✅ RESOLVIDO — `delete-account` NÃO está mais quebrado (verificado 25/08/2026)

> **A correção descrita no parecer do architect foi aplicada, e este item envelheceu errado.**
> Verificado no catálogo e por execução real, com `ROLLBACK` forçado, sobre um freela **de verdade
> com 3 pagamentos**:
>
> - `workers` **não tem FK nenhuma** — as CASCADEs para `auth.users` foram removidas (a "lápide
>   pseudônima" do parecer), e a proteção que elas davam por acidente foi reposta pelo trigger
>   `lgpd_guard_auth_user_delete`, que barra o `DELETE` enquanto houver perfil vivo.
> - `public.anonymize_account` **existe** e devolveu `outcome='anonymized'`.
> - Em seguida, `DELETE FROM auth.users` apagou **1 linha** — funcionou. A linha em `workers`
>   sobreviveu anonimizada, preservando a trilha de `shift_payments`.
>
> Ou seja: o `RESTRICT` de `shift_payments → workers` **nunca dispara**, porque o perfil não é
> apagado. E o `delete-account` já chama `anonymize_account` antes do `deleteUser`, fail-closed
> (só prossegue com `outcome='anonymized'`).
>
> **O que continua aberto é o item #1** (a política de privacidade precisa declarar a retenção do
> dado anonimizado). O direito de exclusão está tecnicamente cumprido; falta a declaração.
>
> Diagnóstico original preservado abaixo — inclusive porque descreve o segundo caminho de bloqueio
> (via `wallets`), que a mesma remoção de CASCADE resolveu.

### Diagnóstico original (obsoleto)

**Origem:** descoberto durante F6. **Não foi introduzido por nenhuma feature desta leva.**

`workers.id → auth.users` é **CASCADE**, mas `shift_payments.worker_id → workers` é **RESTRICT**.
Logo, `auth.admin.deleteUser` **falha** para qualquer freela que tenha um registro de pagamento —
ou seja, para todo freela que efetivamente trabalhou. O produto acredita cumprir o direito de
exclusão da LGPD e **não cumpre**.

**Gate:** é obrigação legal, e o pilha de dados só cresce depois do piloto. Precisa de decisão do
architect: anonimização em vez de exclusão (preservando a trilha fiscal do pagamento) é o caminho
mais provável, já que `shift_payments` é documento de auditoria e não pode simplesmente sumir.

**Parecer do architect (21/08/2026):** `.harness/spec/lgpd-producao/ddl-aprovado.md` §2 +
ADR-20260821-anonimizacao-em-vez-de-exclusao. **Há um SEGUNDO caminho de bloqueio, não registrado:**
`auth.users --CASCADE--> wallets --NO ACTION-- wallet_transactions/escrow_transactions`
(`001_create_wallet_escrow_tables.sql`) — basta uma linha de razão para `deleteUser` falhar, sem
`shift_payments` nenhum. Decisão: lápide pseudônima (remover as CASCADEs para `auth.users`; a
credencial some, a linha de identidade sobrevive anonimizada) + RPC transacional `anonymize_account`.
**Dois itens aguardam o humano:** prazo de retenção e texto da política (H1) e o aval para remover as
FKs de identidade (H2). Este débito só fecha depois do #1 (política declarar a retenção).

## 6. ✅ RESOLVIDO — aceite do termo agora é garantido pelo banco (25/08/2026)

**Origem:** evaluator F6, finding `C-TERM-FETCH-FAIL` (tipo c — decisão de arquitetura).

Nada em `shift_payments` exige que `service_terms.accepted_at` esteja preenchido antes de
`worker_confirmed_at`: `confirmReceiptByWorker` é um `.update()` direto. O acoplamento entre
"aceitar o termo" e "confirmar o recebimento" vive inteiramente no componente React.

Consequência: qualquer caminho que não passe por `ServiceTermSection` — client alternativo,
chamada direta ao PostgREST, script de suporte, ou uma regressão futura na UI — grava a
confirmação com o termo pendente. A correção da rodada 3 fecha o caso de falha de leitura
(falha fechado), mas continua sendo garantia de client.

**Decisão pendente do architect:** trigger em `shift_payments` recusando `worker_confirmed_at`
quando existir `service_terms` pendente para aquele pagamento. Pesar contra o risco de travar
turnos legados sem termo gerado — a condição precisa ser "existe termo E não foi aceito",
nunca "não existe termo aceito".

**Por que importa:** a feature existe para ser prova. Prova que depende do front estar correto
é mais fraca do que o produto promete ao usar a palavra "termo".

## 7. F6 — resíduos do aceite (INFO, aprovados com ressalva)

**Origem:** evaluator F6, rodada 4 (APPROVED). Nenhum bloqueia; registrados para não sumirem.

1. **O gate de consentimento vive só no `disabled`.** `handleAcceptOnly` e `handleConfirmReceipt`
   não têm guarda defensiva de `agreedToTerm`/`showFullText` no topo. A RPC continua sendo a
   autoridade real e R8 define o checkbox como UX — mas um refactor que remova o `disabled`
   perde o consentimento **em silêncio**, sem quebrar nenhum teste.
2. **`fetchTerm` não reseta `agreedToTerm`.** O consentimento sobrevive a um re-fetch do rascunho.
   Hoje inexplorável (o rascunho só muda no aceite, e depois o checkbox some), mas é estado de
   consentimento persistindo através de uma recarga do objeto consentido.
3. **O banner de falha de leitura aparece para a empresa**, dizendo que "a confirmação de
   recebimento fica bloqueada" — mensagem escrita para o freela, exibida a quem não tem esse botão.

## 8. ✅ RESOLVIDO — A3 do F6 revertida à forma original (25/08/2026)

> Dependia do #3, fechado no mesmo dia. Com o campo de CPF em `/profile`, a mensagem de
> `missing_cpf` volta a apontar o caminho que o próprio freela percorre ("Cadastre o seu em Perfil")
> em vez de mandá-lo ao suporte — que era a redação honesta enquanto o beco não tinha saída.
> O bloco visual ganhou link para `/profile`; o teste passou a exigir que a mensagem cite "Perfil" e
> **não** cite "suporte", para que a reversão não se desfaça em silêncio.

### Registro original

Quando `/profile` ganhar campo de CPF, o critério A3 da spec `termo-prestacao` volta à forma
original (toast "Complete seu CPF no perfil" + link). Enquanto não ganhar, a mensagem honesta é a
correta. Os dois itens andam juntos — não reverter A3 sozinho.

## 9. ✅ RESOLVIDO — `reviews` era varrível por qualquer conta autenticada
> ✅ **RESOLVIDO e CONFERIDO NO CATÁLOGO em 22/08/2026** (não no histórico de migrations, que já
> mentiu neste projeto — a consulta foi `pg_policies` / `pg_get_functiondef` contra produção).
>
> `reviews` tem hoje **uma única** policy de SELECT:
> `reviews_select_related → (reviewer_id = auth.uid() OR reviewed_id = auth.uid() OR can_view_reviews_of(reviewed_id))`.
> A permissiva antiga (`USING (true)`) não existe mais. Aplicado por `20260821000100` +
> `20260821000200` — **foram precisas duas migrations** porque o `DROP POLICY` da primeira mirava
> três nomes inexistentes e passou em silêncio, deixando a permissiva viva; policies de SELECT se
> combinam por `OR`, então a restritiva não restringia nada. Só apareceu ao consultar `pg_policies`
> depois de aplicar.


**Origem:** gate do F12 (badges). **Não introduzido por nenhuma feature desta leva — está em produção.**

`reviews` tem `SELECT USING (true)` (migração `20260309000000`) e `companies` também. Consequência:
qualquer conta autenticada, criada em 30 segundos, **sem vínculo nenhum**, lê todas as avaliações de
qualquer freela e resolve o nome da empresa avaliadora a partir de `reviewer_id`.
`pages/company/WorkerPublicProfile.tsx:120-140` já renderiza exatamente isso.

É a **mesma classe** do problema que a migração `20260816120000` fechou em `workers` (CPF, telefone e
PIX varríveis por qualquer autenticado) — e ficou de fora naquela passagem.

**Por que não foi corrigido junto com o F12:** quebraria `ProfileReviews`, `CompanyProfile`,
`CompanyPublicProfile` e `WorkerPublicProfile` de uma vez. Precisa de spec própria, no molde da
`20260816120000` (escopo por vínculo + RPC DEFINER com mascaramento, como `get_profile_reviews`).

**Efeito sobre o F12:** nenhum. A feature lê por SECURITY DEFINER; quando esta dívida for paga,
o badge não muda uma linha.

**Gate:** é exposição de dado pessoal em produção, e cresce com o piloto.

> ✅ **PAGA em 21/08/2026.** Migrations `20260821000100_reviews_select_by_relationship.sql` +
> `20260821000200_reviews_drop_public_select_policy.sql`, aplicadas e **verificadas no catálogo**:
> `reviews` tem agora uma única policy de SELECT (`reviews_select_related`), e `get_profile_reviews`
> ganhou gate por direção (`'company'` segue aberto — é a prova social deliberada do perfil público
> da empresa; `'worker'` exige `can_view_worker_profile`).
>
> Duas armadilhas no caminho, ambas registradas em `patterns.md`: as colunas são `uuid` e não `text`
> como o repositório declara, e o `DROP POLICY` mirava um nome que não existia — **a policy
> permissiva sobreviveu à primeira aplicação**, deixando a correção inerte até a verificação pegar.

**Parecer do architect (21/08/2026):** `.harness/spec/lgpd-producao/ddl-aprovado.md` §3 +
ADR-20260821-reviews-por-vinculo. Achado que muda o desenho: fechar a policy **sozinha não fecha
nada** — `get_profile_reviews` é `SECURITY DEFINER` e só exige `auth.uid() IS NOT NULL`, devolvendo
o mesmo conteúdo. Tabela e RPC fecham juntas. `direction='company'` fica aberto de propósito
(prova social de `/empresa/:id`). F12 confirmado inalterado.

## 10. `companies` é `USING (true)` com CNPJ, e-mail e endereço

**Origem:** gate do architect sobre o débito #9 (21/08/2026). **Pré-existente, em produção.**

Mesma classe do #9, um nível acima: `companies` tem `SELECT USING (true)` (`20260317160000:23`), e a
tabela carrega `cnpj`, `email` e `address`. Qualquer conta autenticada varre a base de empresas.

**Por que não foi corrigido junto com o #9:** `/empresa/:id` (perfil público) e `CompanyProfile`
dependem dessa policy, e o fecho correto **não é** escopo por linha — é column-scoped (RPC
`get_company_public_profile` devolvendo só as colunas públicas + policy restrita ao dono). Spec própria.

**⚠️ RAIO REAL, MEDIDO EM 25/08/2026 — MAIOR DO QUE ESTE DÉBITO REGISTRAVA:**

O texto abaixo trata a busca do `CreateReferralModal` como *o* consumidor acoplado. São **doze**, e o
pior deles não é uma leitura direta — é **embed**:

- **7 leituras diretas cruzadas:** `CompanyPublicProfile` (perfil público), `QuemTeIndicou`,
  `WorkerPublicProfile`, `MyCertificationsSection`, `WorkerCertificationsPanel`, `CompanyReferrals`,
  `CreateReferralModal`.
- **5 embeds dentro de outras queries** — e estes são o problema, porque PostgREST resolve embed
  **pela RLS da tabela embutida** e devolve `null` quando ela nega, sem erro nenhum:
  `pages/Dashboard.tsx` (dashboard do freela), `pages/Messages.tsx`, `pages/MyJobs.tsx`,
  `pages/company/WorkerPublicProfile.tsx` e **`services/paymentRecordService.ts`** — este último é o
  **recibo**, o artefato central do modo A.

Ou seja: escapar a policy sem reescrever os cinco embeds faz o **nome da empresa sumir do recibo**,
em silêncio, para todo freela. Um `select` embutido não vira RPC sem reestruturar a query inteira.

**O atalho por privilégio de coluna não existe:** `GRANT`/`REVOKE` de coluna é por PAPEL, não por
linha, e a própria empresa lê `select('*')` da sua linha em `CompanyProfile.tsx:113` para editar o
perfil — revogar `cnpj`/`email` de `authenticated` quebraria o dono junto com o intruso.

**Dois caminhos, ambos reais, nenhum trivial:**
1. **Policy escopada + RPCs** (o que o texto abaixo descreve): exige reescrever os 5 embeds. Maior
   risco, e o risco cai justamente sobre o recibo.
2. **Mover `cnpj` e `email` para `company_private`** (tabela nova, RLS só para operador da empresa).
   `companies` continua legível e os embeds seguem funcionando intactos; muda só quem lê os dois
   campos sensíveis (`CompanyProfile`, `CompanyOnboarding` e o render do termo, que já é DEFINER).
   Menor raio, mesmo resultado de privacidade.

**Recomendação:** caminho 2. Mas é mudança de esquema em tabela central, e o débito é
**pré-existente** — não é regressão desta leva. Decisão de quando, do dono.

**Já aplicado e verificado (D3 do ADR, independe da escolha acima):** termo sanitizado (remove
`% _ * \`), mínimo de 3 caracteres e debounce de ~300 ms — conferido em
`CreateReferralModal.tsx` (linhas 29-31, 87-88, 96).

**🔗 CONSUMIDOR ACOPLADO — ler antes de fechar este débito (gate de 21/08/2026, F10):**
`frontend/src/components/company/CreateReferralModal.tsx` busca a empresa destino com
`from('companies').ilike('name', …)`. O gate aprovou a leitura direta **exatamente porque** esta
policy é `USING (true)` — uma RPC hoje não subtrairia capacidade de ninguém. **No dia em que esta
policy for escopada, aquela busca precisa virar RPC na MESMA migration.** Se não virar, a F10 quebra
**em silêncio**: RLS que não casa devolve conjunto vazio (não erro), o campo "Empresa destino" nunca
encontra ninguém e a feature de indicação fica inoperante sem nenhuma mensagem.
O contrato da RPC substituta (`search_companies_for_referral`: só o termo, sem paginação, projeção
`id/name/logo_url` campo a campo, teto e mínimo dentro da função) já está escrito — **não precisa de
novo gate**, é só implementar:
`.harness/memory-bank/decisions/ADR-20260821-busca-de-empresas-acoplada-ao-debito-10.md` §D2 e
`.harness/spec/troca-freelas/ddl-aprovado.md` §6 (DS-BUSCA).

## 11. ✅ RESOLVIDO — `reviews` aceitava avaliação sem turno concluído (25/08/2026)

**Origem:** gate do architect sobre o débito #9 (21/08/2026). **Pré-existente.**

A policy de INSERT é `WITH CHECK (reviewer_id = auth.uid())` (`20260309000000:114`) — nada exige que
exista `applications` concluída entre avaliador e avaliado. Qualquer conta pode inventar avaliação
sobre qualquer id, em qualquer direção. A validação vive só no client ("validated by application
status in app logic", diz o comentário da própria migração).

**Correção:** `WITH CHECK` com `EXISTS` sobre `applications`/`jobs` em status concluído, ou trigger
`BEFORE INSERT`. Não entra no #9 (que é leitura); é escrita e merece verificação própria.

## 12. ✅ RESOLVIDO — o painel contava SOS diferente do chamado de elenco (25/08/2026)

> Fechados juntos: `origin` entrou na consulta de `shift_calls` e o bloco de aceitação passou a
> filtrar `origin !== 'sos'`. Medir só o que dá para medir inteiro é mais honesto que exibir um
> número que favorece uma origem sem dizer. Alcance de SOS, se um dia for exibido, tem de vir de RPC
> DEFINER devolvendo só o número. Teste novo cobre a exclusão (seria 0.67 se o SOS entrasse; é 0.5).

**Origem:** security-reviewer do F11 (classificado como NOTA, não falha).

`operationAnalyticsService` lê `shift_call_targets` sob o client autenticado, logo sob RLS. A policy
nova do SOS libera à empresa **apenas os alvos com `response='accepted'`** quando `origin='sos'` —
que é exatamente a membrana que a feature existe para criar.

Consequência não-óbvia: no painel de operação, um chamado de **elenco** conta todos os alvos, e um
**SOS** conta só quem aceitou. O "tempo de preenchimento" e o alcance ficam sub-representados para
SOS, **sem nenhum sinal na tela**. Quem ler o número vai comparar coisas diferentes.

**Não é bug** — corrigir "mostrando todos" quebraria a promessa do SOS. As saídas honestas são:
(a) separar as duas origens no painel, com rótulo; (b) expor a contagem de alcance de SOS por uma
RPC DEFINER que devolva **só o número**, nunca a lista; ou (c) declarar na tela que SOS conta
diferente.

**Gate:** decidir antes de o SOS ser ligado em produção. Depois, o número já terá sido lido como se
fosse comparável.

## 13. O consentimento do SOS subdeclara o que a empresa passa a ver

**Origem:** evaluator do F11 (ALTO, tipo b — vício do contrato, não da implementação).

O texto do §5, copiado fielmente pelo builder, diz que ao aceitar um SOS a empresa passa a ver
**"telefone e chave PIX"**. Mas `can_view_worker_profile` é **row-level**: no aceite a empresa ganha
a **linha inteira** de `workers` — que inclui **CPF** e **data de nascimento**.

O próprio contrato exige que "o consentimento cubra o que realmente acontece". Hoje não cobre.

**Duas saídas, e a escolha não é do builder:**
1. Ampliar o texto para citar CPF e data de nascimento — honesto, mas pode reduzir adoção do opt-in.
2. Restringir colunas nesse ramo específico do `can_view_worker_profile` — decisão de architect,
   com impacto em todas as features que dependem do ramo operacional.

**Gate:** entra no parecer jurídico/LGPD que o ADR do SOS já exigia. **Este é o item mais forte
desse parecer** — é a primeira vez no produto que uma empresa vê CPF de alguém com quem não tinha
nenhum vínculo prévio.

> ✅ **PARCIALMENTE RESOLVIDO em 22/08/2026 — a saída 1 foi adotada e está EM PRODUÇÃO.**
> O texto acima ("o consentimento não menciona CPF") está DESATUALIZADO. `SosDiscoverySection.tsx`
> (linhas 117-119) hoje diz, e o mesmo texto foi conferido no bundle publicado:
>
> > "Se você aceitar um desses chamados, a empresa passa a ver seus dados de contratação —
> > telefone, CPF, data de nascimento e chave PIX — para poder te pagar. Recusar não tem nenhum
> > efeito no seu perfil. Você pode desligar isto a qualquer momento."
>
> O consentimento agora **cobre o que realmente acontece**, que era a exigência do contrato: cita as
> quatro colunas nominalmente, explica a finalidade ("para poder te pagar"), declara a gratuidade da
> recusa e diz como desligar.
>
> **O que AINDA depende do parecer jurídico:** não se a copy é honesta — é —, mas se **consentimento
> em checkbox é base legal suficiente** para expor CPF e data de nascimento a uma empresa sem
> vínculo prévio, ou se esse alcance precisa de outra base/desenho. A saída 2 (restringir as colunas
> nesse ramo de `can_view_worker_profile`) continua disponível se o parecer disser que não.
>
> Corrigido aqui porque uma dívida que descreve como aberto um problema já resolvido faz o jurídico
> analisar a pergunta errada.

## 14. ✅ RESOLVIDO — o painel de analytics mentia a favor do SOS (25/08/2026)

> Fechados juntos: `origin` entrou na consulta de `shift_calls` e o bloco de aceitação passou a
> filtrar `origin !== 'sos'`. Medir só o que dá para medir inteiro é mais honesto que exibir um
> número que favorece uma origem sem dizer. Alcance de SOS, se um dia for exibido, tem de vir de RPC
> DEFINER devolvendo só o número. Teste novo cobre a exclusão (seria 0.67 se o SOS entrasse; é 0.5).

**Origem:** evaluator do F11 (MÉDIO). Complementa a dívida 12.

`operationAnalyticsService` monta a métrica de aceitação (`received`/`accepted`) a partir das linhas
**visíveis** de `shift_call_targets`. Para chamados SOS, só o alvo **aceito** é visível — então quem
aceitou aparece com `received=1, accepted=1` = **100% de aceitação**, e todos os alcançados que
recusaram somem do denominador.

Não é vazamento: é a membrana funcionando como deve. Mas o número exibido passa a favorecer
sistematicamente o SOS sobre o chamado de elenco, e ninguém saberia disso olhando o painel.

**Saídas:** filtrar `origin='team'` no bloco de aceitação, ou rotular a métrica. A primeira é mais
honesta; a segunda preserva o dado com a ressalva.

**Gate:** decidir antes de ligar o SOS — depois, o número já terá sido lido como comparável.

## 15. ✅ RESOLVIDO — o uuid do freela era credencial de PII
> ✅ **RESOLVIDO e CONFERIDO NO CATÁLOGO em 22/08/2026** (não no histórico de migrations, que já
> mentiu neste projeto — a consulta foi `pg_policies` / `pg_get_functiondef` contra produção).
>
> `can_view_worker_profile` **não tem mais o ramo `'pending'`**: o predicado vivo é
> `tc.status = 'accepted'`. As ocorrências da palavra "pending" no corpo são apenas o comentário que
> explica a remoção e proíbe reintroduzi-la. `list_team_connection_cards()` existe (projeção fechada
> de 6 campos, nenhum PII) e `get_profile_reviews` anula `reviewer_id` para terceiro. Aplicado por
> `20260821000300`.
>
> ⚠️ Ao reconferir isto, **não** teste com `prosrc LIKE '%pending%'`: dá falso positivo no
> comentário. Foi o que aconteceu nesta própria reconferência. Leia o predicado.


**Origem:** gate do `avatar_url` na F10 (21/08/2026). **Não foi introduzido por nenhuma feature
desta leva.** ADR: `ADR-20260821-uuid-de-freela-nao-e-credencial-de-pii.md`.

### O defeito de fundo

`can_view_worker_profile` concede leitura da **linha inteira** de `workers` — cpf, phone, pix_key,
birth_date — por `team_connections.status = 'pending'`. Esse estado é escrito **unilateralmente
pela empresa** (`tc_insert_company` só exige ser dona e nascer `'pending'`).

Logo: **conhecer o uuid de um freela equivale a ter autorização sobre o PII dele.** O uuid é
credencial portadora, e qualquer canal que exponha um identificador vira vazamento.

`'pending'` é a empresa dizendo "quero". `'accepted'` é a pessoa dizendo "pode". CPF e PIX
pertencem ao segundo.

### O canal aberto hoje (desde 16/08)

`get_profile_reviews` devolve `reviewer_id` **cru** para qualquer sessão autenticada. Com
`p_direction='company'` os avaliadores são freelas: a RPC **mascara o nome** ("Carlos S.") e
**entrega o uuid na coluna ao lado**. Colheita em lote sobre qualquer perfil de empresa, depois a
escalada acima. Duas chamadas. Não passa por `ProtectedRoute` — é `.rpc()` direta com `GRANT` a
`authenticated`.

### Por que quase consertamos a coisa errada

O primeiro diagnóstico foi "o `avatar_url` vaza o uuid porque o path do bucket é
`${profile.id}/...`". Verdade, mas é **um** canal. Se a correção tivesse sido trocar a convenção de
path — a opção que parecia consertar "a classe inteira" — este caso continuaria de pé.

**A classe não é "path embute uuid". É "um identificador que autoriza".**

### Correção (DS-PII-1..3, em implementação)

1. `can_view_worker_profile` perde o ramo `'pending'`.
2. `list_team_connection_cards()` DEFINER sem parâmetro — sem ela, o cartão de convite pendente
   perde o nome **em silêncio** (embed PostgREST de linha negada vem `null`, não erro).
3. `get_profile_reviews` devolve `reviewer_id` NULL para terceiro.

### Mina armada relacionada (não vaza hoje)

`CompanyProfile.tsx:233` usa a mesma convenção de path com `companies.id`. Inofensivo enquanto
`companies.id = auth.uid()` e `companies` for `USING (true)`. **O F3/multi-unidade arma o pino:**
`userId` passa a ser o uid do gerente, e o path passa a embutir um `auth.users.id` de pessoa
natural. Uma linha agora; backfill com o furo aberto depois.

## 16. F11 — verificações V1–V8 pendentes (gate de deploy, não de commit)

**Origem:** evaluator do F11 (MÉDIO `C-GATE-VISIBILIDADE`). As verificações existem só em
`.harness/spec/sos-descoberta/ddl-aprovado.md:864-920` e nada em `memory-bank/` apontava para elas.

A migration `20260817001600_sos_discovery.sql` **não foi aplicada**. Antes de ligar o SOS:

- **V8 primeiro, como bloqueio:** turno `status='deleted'` + chamado aberto → `claim_shift_slot`
  deve devolver `{"outcome":"cancelled"}`. Se vier `claimed`, **não subir** — é a regressão que a
  rejeição 1 pegou.
- **V1–V7:** colunas/CHECKs, texto das 3 policies em `pg_policies`, ausência de `42P17` em runtime,
  **V4** (empresa vê 0 alvos de SOS pendente) e **V6** (forjar `origin='sos'` → `42501`), trigger
  ignorando o `origin` do cliente, e Article 8 (0 linhas em `escrow_transactions`).
- **Confirmar `prosrc` depois de aplicar:**
  `SELECT prosrc LIKE '%j.status%' FROM pg_proc WHERE proname='claim_shift_slot';`
  O `{"success": true}` da migration não prova estado final — padrão já registrado em `patterns.md`.

## 17. ✅ RESOLVIDO — `collectRawData`/`resolveCompanyScope` sem cobertura (A15 sem prova)

> ✅ **PAGA em 22/08/2026.** `operationAnalyticsService.test.ts` ganhou 10 testes que mockam
> `supabase.from(...)` e exercitam a API pública `getOperationAnalytics` (nada exportado de
> produção só para testar):
> - Ancoragem dupla (A15) de `resolveCompanyScope`: `companies.id = auth.uid()` sem outra empresa,
>   `owner_id = auth.uid()` com `id` diferente (e prova que a query de `jobs` usa `.in('company_id',
>   ids)` com os DOIS ids), sem sessão, e erro de leitura de `companies` (hasError sobe, escopo
>   cai para `[userId]`).
> - As 9 strings de `.select()` (companies, jobs, applications, shift_payments,
>   escrow_transactions, shift_calls, shift_call_targets, shift_attendance_confirmations, workers),
>   coluna a coluna, `toBe` exato — não `expect.any(String)`.
> - O laço de paginação que **produz** `truncated`: caso que atinge `MAX_PAGES` (10 páginas cheias
>   de `PAGE_SIZE`) e caso de duas páginas (uma cheia, uma incompleta) que prova que as linhas das
>   DUAS páginas foram agregadas (via `hires.jobsCreatedCount`), não só a primeira.
>
> **Verificado por mutante** (3 mutantes, cada um confirmado como matando o teste antes de
> reverter): remover uma coluna do `.select()` de `jobs` (pega pelo teste de strings), zerar o
> laço que soma ids de `companies` em `resolveCompanyScope` (pega pelo teste de ancoragem dupla) e
> forçar a paginação a parar sempre na primeira página (pega pelos dois testes de `truncated`).
>
> O comentário do arquivo que declarava a lacuna foi atualizado para apontar para a cobertura nova
> em vez de continuar descrevendo um buraco fechado.

**Origem:** evaluator do F9 (`C-ANALYTICS-A15-SEM-PROVA`), aceito como dívida consciente.

Os 30 testes do analytics cobrem a função pura `aggregate`, onde mora toda a lógica de negócio.
**Nenhum toca `collectRawData`, `resolveCompanyScope` nem as strings de `select`.** Logo:

- **A15** (ancoragem dupla — o AC de destaque do PRD) não tem teste **nem smoke executado**;
- o laço de paginação que **produz** o flag `truncated` não é exercitado (só a propagação dele);
- as 8 strings de `select` podem perder uma coluna e nada quebra — é **exatamente** o bug que a F7
  teve, onde o mock fabricava o campo que produção não trazia.

O comentário do arquivo de teste declara essa lacuna honestamente (foi corrigido depois de afirmar
o contrário). Existe precedente no repo para fechar: `teamConnectionService.test.ts` assere a string
do `select` de `listTeamMembers`, e foi verificado por mutante.

**Gate:** rodar o smoke (a)/(b)/(c)/(d) do Step 8 do PRD antes do piloto, e escrever o teste da
cadeia quando a frente abrir.

## 18. ✅ RESOLVIDO — limiar de pontualidade ganhou piso (25/08/2026)

> O item registrava como LATENTE que o limiar era de um lado só (`diff <= 10`, sem piso): um
> check-in com âncora de data errada dá adiantamento absurdo e **entrava como pontual**. Era o jeito
> de um bug de fuso se esconder — o painel melhoraria sozinho no dia em que o cálculo quebrasse.
>
> Agora `EARLY_ANOMALY_MINUTES = 180` tira o caso dos **dois** lados da fração: não é pontual (seria
> mentira) e não é atraso (seria inventar falta). Teste novo cobre ~23h de adiantamento.
>
> O par de testes descrito abaixo continua indivisível e agora tem um terceiro que fecha o lado que
> nenhum dos dois pegava. **Durante a correção o `else` do atraso ficou pendurado no `if` novo** —
> atraso deixava de contar e adiantamento virava atraso. Os dois testes existentes pegaram na hora;
> é exatamente para isso que o par existe.

### Registro original

**Origem:** evaluator do F9, que testou a direção oposta por conta própria.

`operationAnalyticsService.ts:963` é um limiar **de um lado só**:
`if (diffMinutes <= LATE_TOLERANCE_MINUTES) punctualCount += 1; else lateCount += 1;` — sem piso.

Consequência para os testes: o de check-in **+40 min** mata o deslocamento **para frente** (o dia
civil pula, o atraso vira −1400 e cai em "pontual"). O de check-in **exato** mata o deslocamento
**para trás**. **Nenhum dos dois pega os dois lados.** Apagar qualquer um reabre metade do buraco,
e a suíte continua verde.

Ambos vivem no describe `C-ANALYTICS-ANCORA-MEIA-NOITE`. **Não remover nenhum sem substituir por
uma asserção genuinamente bilateral.**

**Latente, não é defeito desta entrega:** como o limiar não tem piso, um check-in **23h adiantado**
conta como pontual. É pergunta de produto sobre a métrica, não bug de implementação.

## ✅ SEM OBJETO — Token de cartão permanece no Asaas após exclusão de conta

> **ANULADA em 22/08/2026.** Esta dívida supunha tokens de cartão retidos no processador. Conferido
> no catálogo: **`payment_methods` tem ZERO linhas** — nunca houve cartão tokenizado neste produto.
> Somado à decisão do owner de abandonar o Asaas e pausar o processamento de pagamento
> (`ADR-20260822-pausa-do-processamento-de-pagamento.md`), não há token a revogar, nem pergunta a
> fazer ao suporte deles, nem escolha de owner/jurídico pendente. O item **J5** do contrato de LGPD
> sai da lista de pendências.
>
> As sete Edge Functions do Asaas foram **removidas de produção** na mesma decisão; o código
> permanece no repositório caso o processamento volte.
>
> O texto original fica abaixo como registro do raciocínio — ele continua correto SE o pagamento for
> retomado e cartões passarem a ser tokenizados. Nesse dia, esta dívida reabre.

**Estado:** ABERTO. Bloqueia **publicar** a rotina de exclusão ao usuário; não bloqueia aplicar a migration.

Quando a empresa exclui a conta, `anonymize_account` apaga `payment_methods` — o Worki perde a
referência ao cartão. Mas o **token continua existindo no Asaas**. O dado sai do nosso banco e
permanece no processador.

**Por que não foi resolvido junto:** não existe endpoint confirmado para revogar um
`creditCardToken` isoladamente. A documentação pública do Asaas descreve `POST /v3/creditCard/tokenize`
para criar, e o token é vinculado ao **cliente** — o caminho documentado para eliminar o cartão
parece ser remover o cliente, ação de escopo bem maior (afeta cobranças e histórico), que não se
decide dentro de uma rotina de LGPD sem confirmação.

**Uma tentativa foi escrita e removida.** A primeira versão da Edge Function chamava
`DELETE /creditCard/{token}`, endpoint inventado, como "melhor esforço" não-bloqueante. Removido por
dois motivos: (1) responderia 404 em toda exclusão e logaria "revogação não confirmada" para sempre —
ruído disfarçado de tentativa, que faz quem lê o log concluir que houve esforço legítimo em vez de
endpoint inexistente; (2) logava o próprio token, credencial de pagamento em log, dentro da rotina
de LGPD. Hoje a função emite um aviso único, explícito, apontando para este documento.

**Para fechar:** confirmar contra a API do Asaas (documentação de referência completa ou suporte) se
existe revogação de token; se existir, implementar; se não existir, decidir entre remover o cliente
Asaas ou declarar a retenção na Política de Privacidade — decisão de owner + jurídico, junto de J1–J4.


---

## 19. Doze colunas mortas em `workers` e `companies` — recomendação de `DROP COLUMN` (decisão de owner)

**Não bloqueia nada.** As doze já estão classificadas como APAGADAS em
`.harness/spec/lgpd-producao/ddl-aprovado.md` §2.1 e a rotina de LGPD as apaga. Isto aqui é a
recomendação de derrubá-las de vez. **As duas tabelas vão juntas** — é uma decisão só.

### Lote A — Stripe (3 colunas). A migration já existe e nunca chegou a produção

| Coluna | Tabela | Linhas |
|---|---|---|
| `stripe_account_id`, `stripe_onboarding_completed` | `workers` | 0 |
| `stripe_customer_id` | `companies` | 0 |

`supabase/migrations/20260310000000_drop_stripe_columns.sql` (commit `61e8e957`, "refactor:
migration para remover colunas Stripe do banco") derruba **exatamente estas três**, é idempotente
(`DROP COLUMN IF EXISTS`) e **as três continuam em produção**. Não aparece em nenhum log de
aplicação. Não é "escrever uma migration" — é aplicar uma que o repositório já acredita ter
aplicado.

### Lote B — Asaas (9 colunas). Migration nova

| Coluna | Tabela | Linhas |
|---|---|---|
| `address`, `address_number`, `postal_code`, `province`, `income_value` | `workers` | 0 |
| `postal_code`, `address_number`, `province`, `income_value` | `companies` | 0 |

Campo a campo, o cadastro de `customer` do Asaas. Nunca escritas a partir dessas tabelas; a pausa
do processamento de pagamento (ADR-20260822) torna a hipótese remota.

### Fora do DROP, de propósito

`workers.goal`, `companies.company_type` e `companies.size` são **APAGADAS na lápide** mas estão
**vivas**: o onboarding escreve nas três hoje. Derrubá-las quebraria o produto; apagá-las na
exclusão de conta, não.

### Por que recomendo derrubar

Coluna que não existe não pode ser preenchida por acidente. É a única defesa que não depende de
alguém lembrar de classificar. Enquanto existirem, endereço residencial e renda declarada continuam
sendo campos válidos de escrita para o próprio titular (a policy de UPDATE de `workers` é
`id = auth.uid()`).

### Por que não é grátis — e por isso vai ao owner

1. A migration do DROP **tem de recriar `public.anonymize_user_account`** sem as atribuições
   correspondentes, senão a RPC de LGPD quebra em runtime.
2. Uma reaplicação de `20260821000000` passará a HALTar na asserção (a). Isso é o comportamento
   **correto** (o schema deixou de ser o que aquele arquivo verificou), mas precisa estar escrito
   antes de alguém encontrar o HALT e achar que é defeito.
3. `DROP COLUMN` é irreversível quanto ao dado.

**Ordem obrigatória: `20260821000000` primeiro, DROP depois — inclusive o Lote A**, que é tentador
aplicar já por ser antigo e estar pronto. Aplicá-lo antes faz a #1 HALTar na asserção (a) em três
colunas de uma vez.

### Achado colateral: o Article 6 da constitution não é literalmente verdadeiro

O Article 6 afirma que o **Stripe foi "100% removido"**. Foi removido de funções, pacotes e
frontend; a remoção do **schema foi escrita** (Lote A) **e não chegou ao banco**. As três colunas
estão em produção hoje. Não é desleixo de quem escreveu — é a lacuna estrutural que o
`architecture.md` já documenta em voz alta: *"Estado de produção é a informação mais difícil de
manter honesta no memory-bank, porque muda fora do repositório: nenhum teste, lint ou build a
valida."* Aqui ela produziu uma afirmação constitucional falsa que sobreviveu cinco meses.
Ou o Lote A é aplicado (e o Article volta a ser literal), ou o Article ganha redação honesta —
decisão de owner, com data e justificativa, como manda o próprio documento.
Registrado em `ADR-20260822-coluna-vazia-nao-e-coluna-morta.md`.

---

## 20. ⚠️ AÇÕES DO DONO antes de abrir o piloto — nenhuma é código

**Origem:** navegação ponta a ponta no browser (23–25/08) + varredura de colunas mortas.

Os quatro itens abaixo estão fora do alcance de qualquer commit: dependem de painel externo,
aparelho físico ou decisão de produto. Nenhum bloqueia o build; todos bloqueiam "abrir para
gente real".

### 20.1 — REVOGAR as chaves do Asaas (segurança, urgente)

`wallets.asaas_api_key` guardava **duas chaves reais** do Asaas (166 chars, prefixo `$aact_`),
legíveis pelo dono da carteira direto do cliente — a policy de SELECT de `wallets` é
`auth.uid() = user_id`. A migration `20260825000200` **apagou os valores do banco**.

**Apagar do banco não invalida a chave.** Quem já tiver copiado continua com credencial válida.
A revogação acontece no painel do Asaas e é ação do dono. Como o Asaas está pausado desde 22/08
e nenhum código usa a coluna, revogar não derruba nada.

### 20.2 — Confirmar SMTP (recuperação de senha)

Cadastro **não** depende de e-mail: a confirmação está desligada e isso foi verificado no browser
(conta nova entra direto). Mas "esqueci a senha" depende, e o teste bateu em rate limit do SMTP
padrão do Supabase — que serve para desenvolvimento e **não** para uso real (cota baixa,
entregabilidade ruim). Sem SMTP próprio, o freela que esquecer a senha no dia do turno não
recupera. Configurar em Auth → SMTP Settings.

### 20.3 — Uma passada em aparelho real

O produto foi navegado inteiro em viewport mobile emulado (390×844, UA de iPhone). Emulação não
cobre teclado virtual empurrando layout, `100vh` no Safari iOS, permissão de notificação nem
toque com o dedo em alvo pequeno. O público do piloto é majoritariamente celular. Uma passada
de 15 minutos num aparelho de verdade, no fluxo `convite → aceite → check-in`, vale mais que
qualquer teste emulado adicional.

### 20.5 — ⚠️ Definir `VITE_SENTRY_DSN` na Vercel (observabilidade)

O Sentry **não está ligado em produção**. `Sentry.init` roda dentro de `if (SENTRY_DSN)` e a
variável não existe no build: conferido no bundle servido (nenhum DSN, nenhum host do Sentry) e no
navegador (`window.__SENTRY__` só tem `version`, sem cliente registrado).

Como o ramo PROD de `logError` mandava **apenas** para o Sentry, as 330 chamadas do app
descartavam todo erro em silêncio — nada no console, nada no Sentry. Num piloto: o check-in de um
freela falha, e não existe rastro em lugar nenhum.

**Mitigado em 25/08** (`logger.ts` volta a usar `console` quando o Sentry não está inicializado,
detectado por `Sentry.getClient()`), mas mitigação não é correção: console só ajuda se alguém
estiver com o devtools aberto na hora. Com o DSN definido, o console cala sozinho e o Sentry volta
a ser o canal — sem precisar mexer no código de novo.

### 20.4 — Decidir sobre as três edge functions órfãs

> ✅ **RESOLVIDO em 25/08/2026** — as três foram removidas de produção e respondem 404.

`jobs-api`, `applications-api` e `profiles-api` são anteriores ao pivô e não são chamadas por
nenhum caminho do frontend. Os fontes estão preservados em
`supabase/functions/_orfaos-pre-pivo/`, com os comandos de remoção e a justificativa no
`LEIA-ME.md` de lá. Não fazem mal ligadas; são superfície pública sem consumidor.

---

## 21. ✅ RESOLVIDO — schema Prisma pré-pivô removido (11 tabelas, incluindo PII sem finalidade)

> **Fechado em 25/08/2026** pela migration `20260825000300`. As onze tabelas do backend anterior ao
> pivô foram dropadas; sobraram apenas `Conversation` e `Message`, que são o **chat vivo**. O
> registro abaixo é o diagnóstico que levou à remoção — vale manter porque a distinção entre os
> três grupos é o que impediu de apagar o chat junto.
>
> **Como foi feito, para servir de precedente:** guarda inicial que ABORTA se a realidade mudou
> desde a verificação (conversa usando o vínculo legado, ou tabela declarada vazia com linha),
> ensaio com `ROLLBACK` forçado antes de valer, `DROP` em ordem de dependência explícita
> **sem `CASCADE`** — para falhar alto em vez de destruir em silêncio um objeto não previsto — e
> verificação final que exige exatamente `Conversation, Message` sobrando e o chat com a mesma
> contagem. Confirmado depois no PostgREST: `User` devolve `PGRST205` (some do cache),
> `Conversation.applicationid` devolve `42703` com hint apontando `application_uuid`, e a FK
> `fk_conversation_application_uuid` — a que o frontend nomeia no embed — segue de pé.

### Diagnóstico original

**Origem:** varredura de código morto (25/08/2026), ao verificar se as três edge functions órfãs
podiam ser removidas.

Sobraram **13 tabelas PascalCase** do backend anterior ao pivô. Elas se dividem em três grupos, e
a diferença importa muito:

**(a) Vivas — NÃO TOCAR.** `Conversation` (13 linhas) e `Message` (6 linhas) **são o chat do
produto de hoje**. O frontend as usa em 18 pontos. O nome PascalCase engana: parecem legado e não
são. Foi o que quase me fez classificá-las como mortas.

**(b) Vazias, sem consumidor.** `Job`, `JobApplication`, `ClientProfile`, `ClientReview`,
`FreelancerReview`, `Skill`, `WorkExperience`, `_FreelancerProfileToSkill`, `_JobToSkill` — todas
com 0 linhas e nenhuma referência no frontend. Candidatas a `DROP TABLE` na mesma limpeza de
esquema das colunas mortas (item 19). Sem urgência agora que as funções que as liam sumiram.

**(c) Com dado pessoal e sem consumidor — este é o item de verdade.** `User` (5 linhas) e
`FreelancerProfile` (5 linhas). `User` tem `email`, `firstname`, `lastname`, `avatarurl` — e
**4 dos 5 e-mails correspondem a contas que existem no `auth.users` de hoje**, isto é, pessoas
reais que usam a plataforma, com dado pessoal duplicado numa tabela que nada lê.

A coluna `password` **não** é credencial: as 5 linhas têm o literal `managed_by_supabase_auth`.
Conferido — não é hash, é placeholder.

**Gate:** minimização de dado (LGPD). Não é vazamento; é retenção sem finalidade, que é a categoria
mais fácil de resolver e a mais difícil de justificar se alguém perguntar. `DROP TABLE public."User"`
e `public."FreelancerProfile"` resolvem — decisão de owner, junto com o grupo (b).

### Achado colateral: as 9 edge functions `asaas-*` do repo NUNCA estiveram em produção

Produção tem 4 funções (`admin-data`, `send-notification`, `delete-account`, `expire-invites`).
As nove `asaas-*` existem só no repositório. O `architecture.md` as descreve como se fossem o
trilho de pagamento vigente, e o frontend invoca seis delas — todas atrás de caminho desligado
(`POSTPAY_AUTHORIZE_ENABLED = false`) ou de rota que não existe mais (`/wallet`,
`/company/financeiro`).

**Não removi**: não é código morto, é código **dormente por decisão** (modos B/C, reabríveis por
gatilho do ADR-20260630). Apagar o fonte encareceria a reabertura. Mas fica registrado que
"pausado" aqui significa **nunca deployado**, não "deployado e ocioso" — a diferença aparece no dia
em que alguém tentar reabrir o modo C e descobrir que não há o que ligar.

---

## 22. ✅ RESOLVIDO — `send-notification` aceitava POST anônimo da internet

**Origem:** 25/08/2026, ao verificar por que a função respondia `500` a um GET enquanto as outras
respondiam `401`.

A fonte no repositório checa `Authorization` **antes de tudo** e devolve 401 sem ele. A **versão
deployada não fazia isso**: um `POST` sem cabeçalho nenhum passava direto pela auth e chegava a
consultar `auth.admin.getUserById` com `service_role`, respondendo `HTTP 200`. O `functions list`
explica: versão 8, `updated_at` **idêntico** ao `created_at` — nunca foi redeployada desde março.
A correção existia no repo há meses e nunca chegou a produção.

**O que isso dava a um anônimo:** oráculo de existência de usuário (`user_not_found` vs. resto) e,
com um `userId` real e um `type` válido, **notificação in-app forjada** para essa pessoa mais
**e-mail com remetente `noreply@worki.com.br`**. Primitiva de phishing em nome do Worki, aberta na
internet. Não exercitei contra pessoa real — o `200` sem auth já prova o alcance.

**Segundo achado, na mesma leitura:** o único chamador (`shiftCallService`) mandava
`type: 'shift_invite'`, que **não existe no `switch`**. Caía no `default`, respondia
`{success:false, reason:'unknown_type'}` com HTTP 200 — e como 200 é "fulfilled" para
`Promise.allSettled`, o contador de falhas ficava zerado. **O e-mail de convite de turno nunca
funcionou, e nunca avisou que não funcionava.**

**Ação:** função removida de produção (responde 404) e a chamada morta removida do
`shiftCallService`. Zero regressão: o caminho já era no-op. Produção ficou com **três** funções —
`admin-data`, `delete-account`, `expire-invites`.

**Consequência a declarar:** **não há e-mail transacional no produto hoje.** O aviso ao freela
depende inteiramente da notificação in-app + Realtime (que funcionam, e cujo caminho do gerente foi
corrigido em `20260825000100`). Se e-mail virar requisito do piloto, é trabalho novo: template
`shift_invite`, checagem de auth na função e `RESEND_API_KEY` configurada. Fonte preservada em
`supabase/functions/send-notification/` — nada foi perdido.
