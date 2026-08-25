# Achados navegando o produto no browser (22/08/2026)

Brave real, via porta de debug (CDP), contra **produção**. Cadastro de freela e de empresa feitos
pelo fluxo real, console e rede lidos a cada passo.

Contas de teste criadas em produção: `qa.freela.claude@worki.test` e `qa.empresa.claude@worki.test`.

---

## ✅ CORRIGIDOS

### 1. 🔴 BLOQUEADOR — nenhuma empresa nova conseguia se cadastrar
**Regressão introduzida por mim hoje**, na Fase 1 da F13.

`companies.organization_id` virou NOT NULL, preenchida por trigger BEFORE INSERT. Mas o trigger
tinha a guarda `IF EXISTS (linha) THEN RETURN NEW` — que devolvia `organization_id` NULL. O
onboarding grava com `.upsert()`, que é `INSERT ... ON CONFLICT DO UPDATE`, e o NOT NULL é avaliado
sobre a **tupla proposta, antes** do ON CONFLICT. Resultado:

```
HTTP 400  23502: null value in column "organization_id" violates not-null constraint
```

A tela ficava parada, **sem mensagem de erro**. Corrigido em `20260822000700`: o trigger passa a
**herdar** o `organization_id` da linha existente em vez de desistir. Validado por simulação com
rollback e confirmado no browser — o cadastro conclui e cai no dashboard.

**Só apareceu clicando.** Build, lint, 915 testes e revisão de código não pegaram — eu inclusive
revisei essa guarda e a aprovei como correta.

### 2. 🟠 Especialidade do freela era coletada e jogada fora
O onboarding pergunta "QUAIS SUAS ESPECIALIDADES?" e grava em `workers.roles`. **Nenhuma tela da
empresa lê `roles`** — todas exibem `primary_role`, que só era escrito na página de Perfil.

Medido em produção: **11 de 16 freelas** tinham declarado a especialidade e apareciam **sem função**
para a empresa — inclusive sumindo da busca por função do `ShiftCallModal`.

Corrigido no onboarding (grava `primary_role`) + backfill (`20260822000600`) dos 11 existentes.
Depois: 14 de 16 com função visível, zero invisíveis.

---

## 🟡 ABERTOS — conteúdo e produto

### 3. A tela de login da empresa promete "10k+ profissionais avaliados"
Existem **16** freelas em produção. É a primeira frase que um cliente do piloto lê.

### 4. O campo SETOR é do marketplace antigo
Opções: Desenvolvimento, Design, Marketing, Vendas, Suporte. **Um restaurante — o cliente do
piloto — não tem onde se encaixar.** Tive de escolher "Suporte" para um restaurante.

### 5. "DISPONIBILIDADE" significa duas coisas na mesma tela
No perfil do freela aparecem, uma embaixo da outra: **"DISPONIBILIDADE"** (Manhã/Tarde/Noite/
Madrugada/Fim de Semana — array do cadastro) e **"DISPONIBILIDADE DA SEMANA"** (a grade dia×período
do F7). São colunas diferentes com o mesmo nome. Pior: quem acaba de declarar no cadastro cai no
dashboard e lê "Declare sua disponibilidade" — parece que o que ele preencheu não valeu.

### 6. Perfil aceita texto livre onde a empresa espera uma função
`primary_role` e `roles` não têm validação. Em produção hoje:
- um freela tem **o próprio e-mail** gravado como função;
- outro tem uma **bio inteira** dentro do array de especialidades;
- convivem **"Garcom"** e **"Garçom"** — a busca por função no `ShiftCallModal` compara texto, então
  quem digitou sem cedilha não é encontrado por quem busca com.

---

## 🔵 ABERTOS — menores

### 7. Inputs de login sem `autocomplete`
Console do Brave: `[DOM] Input elements should have autocomplete attributes (suggested:
"current-password")`. Atrapalha gerenciador de senhas.

### 8. Botão desabilitado não diz o que falta
No onboarding do freela, com um campo obrigatório vazio, o PRÓXIMO fica `disabled` **sem nenhuma
indicação de qual campo falta**. A pessoa não tem como saber o que corrigir.

---

## ✅ Verificado e funcionando

- **Cadastro do freela** ponta a ponta (3 passos), console limpo.
- **Cadastro da empresa** ponta a ponta (2 passos), depois do conserto #1.
- **F7 disponibilidade**: marquei SEG-noite e TER-tarde; o banco gravou `{"1":["noite"],"2":["tarde"]}`
  — exato, e confirma a convenção 0=domingo.
- **8 rotas do freela** e **10 da empresa** (incluindo Operação/F9, Indicações/F10 e Organização/F13)
  carregam com console limpo.
- Login, logout e roteamento por papel funcionam; empresa com onboarding pendente é levada de volta
  a ele corretamente.

## Nota de método

Um "bug" que reportei primeiro **não existia**: o botão travado no onboarding do freela era
contaminação da minha própria automação (escrevi um valor inválido dentro de um `<select>`, o
`onChange` gravou vazio). Conferi antes de concluir. Vale a regra: automação que escreve direto no
DOM pode **criar** o defeito que ela está investigando.

---

# Segunda passagem — o ciclo completo ponta a ponta (23/08/2026)

Método: um turno real levado do nascimento à morte no navegador — criar → chamar → aceitar →
check-in → check-out → confirmar presença → registrar pagamento → recibo → aceitar termo →
avaliar. Cada tela lida, cada resultado conferido no catálogo do banco, não na resposta da UI.

## 🔴 Quebravam feature inteira

### 9. O painel de chamados era invisível para TODA empresa, sempre
`shift_call_targets.worker_id` não tinha FK para `workers`. O PostgREST resolve embed **por
foreign key**, então `listCallsByJob` — que pede `worker:workers(...)` — voltava
`HTTP 400 PGRST200` em 100% das chamadas. O serviço captura o erro e devolve `[]`, e o painel
retorna `null` com lista vazia. A empresa disparava o chamado, o freela era notificado, e a tela
dizia "Nenhum freela atrelado a este turno".

Isto é o F1 inteiro — a feature-cabeça do produto. Não dava para ver quem foi chamado, quem
respondeu, nem cancelar.

Três coisas esconderam: os testes do painel são de componente com fixture pronta e nenhum
exercita a query; `logError` em produção manda para o Sentry e **não escreve no console**; e a
tela vazia se parece com "ainda não chamei ninguém", que é um estado legítimo.
Corrigido em `20260823000500` — as três FKs faltantes da família F1/F4.

### 10. Três cartões do analytics estavam mortos desde sempre
Custo por hora, Horas realizadas÷previstas e Desempenho por freela filtravam por
`jobs.status === 'completed'`. **Nada no produto grava esse valor** — em produção `jobs.status`
só assume `open` e `deleted`. O resto do app define conclusão por `applications.status`.

## 🟠 Mentiam para o usuário

### 11. Promessa de escrow que não existe
`MyJobs` dizia "Pagamento em garantia até confirmação da empresa" em todo turno em andamento.
Não há garantia: o piloto é 100% modo A e o turno tinha zero linhas em `escrow_transactions`.
A mesma sessão mostrava o modal de pagamento dizendo, corretamente, "O dinheiro não passa pelo
Worki" — duas telas do mesmo fluxo se contradizendo sobre custódia de dinheiro alheio.

### 12. "Horas Totais" era `completed_jobs_count * 6`
Um chute de seis horas por turno exibido como estatística. Turno de 1 minuto anunciava "6h",
enquanto o recibo, na mesma conta, mostrava a duração real.

### 13. Confirmação de véspera dizia "amanhã" para turno de 5 dias
O texto era literal, mas a RPC aceita turno de até 7 dias. A notificação do mesmo pedido dizia
"28/08" — os dois canais discordavam sobre o dia de comparecer.

### 14. O termo jurídico chamava CPF de CNPJ
`render_service_term_text` rotulava o documento da contratante sempre como "CNPJ", mas o
cadastro aceita 11 **ou** 14 dígitos de propósito (MEI/empresário individual) e valida o dígito
verificador dos dois. Termo já aceito não foi reescrito: `term_text` é imutável após
`accepted_at`, e documento assinado não se corrige em silêncio.

### 15. A copy da guarda de vínculo dizia o oposto do código
Cinco textos diziam "avisar **a partir de** N", mas a regra é `contagem + 1 > N` — N é o teto
tolerado. O código está certo (a entrevista pediu "máximo 2x por semana", logo 2 é aceitável);
as palavras é que estavam invertidas, inclusive dentro do próprio balão de aviso.

## 🟡 Contradiziam o que acabara de acontecer

### 16. Aceitar convite pelo takeover deixava o convite na tela
`useWorkerInvites` roda em duas instâncias (takeover no `MainLayout`, lista na página). Só a que
respondeu recarregava. O aceite funcionava, mas a tela convidava a clicar de novo.

### 17. "último em Invalid Date" no cartão do elenco
`formatHistoryDate` documentava aceitar `YYYY-MM-DD`, mas os dois chamadores passam
`jobs.start_date`, que é `timestamptz`. O arquivo não tinha teste nenhum.

### 18. Dashboard do freela lia coluna inexistente
`nextJob.job.start_time` — `jobs` tem `work_start_time`. O cast `as unknown as` calava o
TypeScript, e "Horário indefinido" aparecia para todo freela, sempre.

### 19. Plurais fixos no singular
"1 jobs", "Chamado enviado para 1 freelas", "Chamar 1 freelas", "1 freelas receberam este
turno", "1 AVALIAÇÕES" — todos no caminho **mais comum**, o convite de um alvo só.

## ✅ Verificado funcionando ponta a ponta
Chamado 1→N com primeiro-aceite e `first_claim_at`; confirmação de véspera nos dois sentidos
(pedido → notificação → resposta → painel da empresa); check-in/check-out com confirmação
bilateral; registro de pagamento modo A com a copy honesta e a chave PIX do freela; recibo
bilateral; termo F6 com gate de leitura, aceite com IP/user-agent e congelamento; avaliação
com `aria-label` correto; agregados do freela (LVL 1 → LVL 2 ao concluir); listas do elenco (F2)
e o chip no chamado; guarda de vínculo avisando sem bloquear; SOS travado fora da janela de 4h;
notificação de convite de elenco nos dois sentidos.

## Nota de método (segunda passagem)
- **Console limpo não prova nada neste app**: em produção `logError` só fala com o Sentry. O
  400 do F1 aconteceu em silêncio absoluto no console. Para achar, tive de repetir a requisição
  REST de dentro da sessão do navegador e bissecar o `select`.
- **HTTP 200 não prova que o arquivo existe**: o SPA devolve `index.html` com 200 para qualquer
  caminho. Conferir deploy exige comparar **conteúdo**, e pelo chunk que o índice em produção
  realmente referencia — não pelo nome do arquivo local, que pode ser de um build antigo.
- **Teste que passa não prova que pega**: dois testes meus sobreviveram à mutação nesta sessão
  (um do analytics, um do `formatHistoryDate`). Só reverter o fix e ver o teste falhar distingue
  guarda de decoração.

---

# Terceira passagem — features que faltavam (23/08/2026)

Cobertura: dispensa/cancelamento, recusa de chamado, F11 SOS (quatro portões + disparo real),
F13 convite de gerente ponta a ponta, F8 certificações e treinamentos, F7 grade de
disponibilidade, F12 selos com privacidade, veto indelével do freela.

## 🔴 Impediam a pessoa de usar a feature

### 20. Convite de gerente levava a criar conta de FREELA
O link redireciona para `/login?redirect=...` **sem `type`**, e o Login faz
`explicitType || 'work'`: o convidado era recebido com "COMECE A TRABALHAR — ganhe dinheiro no
seu próprio horário". Quem se cadastrasse por ali viraria worker, e worker não pode ser gerente
(a RPC tem o outcome `worker_cannot_be_manager`). O convite ficava inutilizável exatamente pela
única pessoa a quem foi enviado — e o erro só apareceria depois da conta criada.

### 21. Telas de empresa assumiam que o usuário logado É a empresa
Seis telas escrevem `company_id = user.id`, o que só vale para o dono. Entrei como gerente:
`/company/team` mostrava o elenco certo (usa o seam `getAuthenticatedCompanyId`), mas o dashboard
dizia "Bem-vindo de volta, Empresa" com 0 turnos e `/company/jobs` vinha vazio — para uma unidade
com 12 turnos. `CompanyCreateJob` mandava `company_id: user.id` no INSERT, que a RLS recusaria.

O banco nunca esteve em risco: `is_company_owner(próprio_id)` = false e
`is_company_owner(unidade)` = true, conferido em produção. Era fiação de frontend, não fase
adiada — **as quatro RPCs da "Fase 3" existem e o fluxo inteiro roda**; a nota do memory-bank
dizendo "F13 Fase 3 — NÃO APLICADA" está desatualizada.

## 🟠 Diziam coisas que não são verdade

### 22. Freela sem nenhuma avaliação aparecia com nota 5.0
`rating_average ? … : '5.0'` no cartão onde a empresa decide quem chamar, e o mesmo `|| 5.0` no
selo do perfil da empresa — que é a prova social que o freela lê antes de aceitar convite. Nota
cheia lê como "excelente" quando o que existe é ausência de dado.

### 23. As notificações escritas em SQL eram as únicas do produto sem acento
Cinco funções: `claim_shift_slot`, `decline_shift_call`, `create_sos_call`,
`notify_on_worker_referral`, `notify_on_team_connection` — esta última escrita por mim horas
antes, no mesmo dia. Corrigido lendo a definição do catálogo e recriando, com assertiva por par.
Precisou de duas levas: meu inventário extraía literais por pareamento de aspas, método que sai
de fase com `''` escapada, e dois textos de `claim_shift_slot` sumiram da lista sem aviso —
justamente as frases que consolam quem **perde** a corrida do chamado.

### 24. `cancelled` era rotulado "Descartado"
Palavra de triagem de candidato para um freela que a empresa acabou de **dispensar**. Agora
`cancelled` → "Dispensado", `declined` → "Recusou", `expired` → "Expirou".

### 25. Mais plurais no singular
"1 profissionais fora do seu Elenco foram avisados" (o SOS de um alvo só é o caso comum em
cidade pequena), "(1 avaliações)" no cartão do candidato e no perfil público.

## ✅ Verificado funcionando (sem defeito encontrado)
Dispensa com modal de consequência e notificação ao freela; recusa neutra de chamado avisando a
empresa; os **quatro portões do SOS** em sequência (`not_urgent` → `team_not_tried` →
`team_call_still_open` → `ok`), pool calculado internamente, `pool_empty` recusado com mensagem,
disparo real mostrando só a contagem, e o aceite **sem** entrar no elenco (C7 do ADR); convite de
gerente ponta a ponta com bloqueio correto de `/company/organization` (R16); certificação com
aviso de dado de saúde, conferência com copy jurídica e **guarda DS8** (editar o conteúdo zera a
conferência); treinamento que se revoga, não se apaga; grade de disponibilidade F7 persistindo;
selos F12 com assimetria correta (terceiro vê zero, dono vê `hidden=true` para reverter) e guarda
DS3 (sem histórico, não grava); **veto do freela indelével** — empresa não consegue deletar nem
reverter a linha bloqueada, e a indicação passa a ser recusada com `not_in_roster`.

## Nota de método (terceira passagem)
- **Ler a tela cedo demais produz falso "quebrado"**: duas páginas pareceram travadas em spinner
  e as duas tinham apenas terminado de montar depois da minha leitura. Antes de afirmar hang,
  reler com espera maior e inspecionar `#root`.
- **Meu próprio inventário pode ser o defeito**: a assertiva na migration de acentos apontou o
  que meu extrator de literais não via. Ferramenta de varredura também precisa de verificação.

---

# Quarta passagem — o papel de gerente, ponta a ponta (24/08/2026)

Entrar como gerente de unidade expôs uma família inteira de defeitos que nenhuma outra sessão
podia ver: **quatro camadas independentes decidiam "quem é a empresa?" reescrevendo a pergunta na
mão**, em vez de perguntar ao seam (`is_company_owner` → `is_job_owner` →
`getAuthenticatedCompanyId`).

### 26. 🔴 O gerente enxergava tudo e não conseguia operar nada
Policy de UPDATE em `applications`: `job_id IN (SELECT id FROM jobs WHERE company_id = auth.uid())`.
Sem erro — a RLS filtra e devolve zero linhas. Confirmar presença é **o** gesto diário do produto
(a tela se chama "Presença e Pagamento"). Sem esse UPDATE ele também não confirma saída, não
conclui turno e não dispensa. Um botão que aceita o clique e não faz nada.

### 27. 🔴 Corrigir a policy só trocou silêncio por ruído
`validate_application_update` tinha a mesma âncora numa linha. Bom que a segunda camada exista —
é defesa em profundidade real; o problema era as duas repetirem a pergunta.

### 28. 🔴 Dez resolvedores locais no frontend, três com o nome do seam
`.eq('owner_id', user.id)` em paymentRecordService, shiftInviteService, shiftCallService,
jobSeriesService, certificationService, teamListService, operationAnalyticsService,
useTeamConnections, InviteToShiftModal e CompanyMessages. Três se chamavam
`getAuthenticatedCompanyId`/`getAuthCompanyId` — **o mesmo nome do seam**, que foi o que me fez
concluir errado, na véspera, que já usavam a costura. `owner_id` é a mais fraca das três âncoras:
nem cobre a empresa cujo id é o do usuário (duas cópias remendavam com `?? user.id`).

Isso explica a meia-verdade do dia anterior: em `/company/team` a lista aparecia (vem do serviço
que já usava o seam) mas o `companyId` local ficava nulo, e o histórico sumia do cartão — duas
metades da mesma tela discordando sobre qual empresa é aquela.

### 29. 🔴 Agendava o pagamento e não conseguia efetivar
`enforce_shift_payment_immutability` exigia `owner_id = auth.uid()` — a mais estreita de todas.
Só apareceu interceptando a rede: `PATCH /shift_payments → 400 P0001`.

### 30. 🟠 Convite de gerente levava a criar conta de freela
(ver terceira passagem, item 20 — mesma família: o convite existia, o caminho não.)

## ✅ Verificado depois das correções
Gerente: dashboard com a unidade certa ("Bem-vindo de volta, Bar do QA", 11 turnos), agenda real,
**cria turno** que nasce pertencendo à unidade (o INSERT que a RLS recusaria antes), confirma
chegada e saída, agenda pagamento, efetiva (`scheduled → recorded` com `scheduled_for`
preservado), e acessa o chat. E **continua barrado** onde deve: não altera check-in/check-out do
freela, não confirma recebimento pelo freela, e `/company/organization` segue bloqueado (R16).
Ele entra pela porta da empresa, com as restrições da empresa.

## Nota de método (quarta passagem)
- **Achar uma camada por vez é o erro.** Só na terceira eu varri o schema inteiro pelas duas
  formas da âncora antiga, em funções **e** policies, e classifiquei as 20 restantes uma a uma.
  Deveria ter sido o primeiro passo, não o terceiro.
- **Nome igual não é implementação igual.** Três serviços tinham função local com o mesmo nome do
  seam. Grep por nome disse "já usa"; a verdade estava no corpo.
- **A asserção pagou o próprio custo.** A migration do pagamento falhou na própria asserção
  (casei o trecho por literal, e a fonte usa CRLF). Sem ela, teria "aplicado" sem corrigir nada.

---

# Quinta passagem — o que faltava (24/08/2026)

Série recorrente (editar/parar), listas do elenco (editar/apagar), WhatsApp, cancelar convite,
recibo/impressão, QR e link transitivo, notificações, recuperação de senha, painel admin.

### 31. 🔴 Qualquer freela entrava sozinho no elenco de qualquer empresa
O link de convite era `/convite/<base64url(company_id)>` — **função pura de um identificador
público**. `companies` tem SELECT `USING (true)`, então qualquer sessão lista todas as empresas e
seus ids; `generateInviteToken` era só `btoa(companyId)` no cliente; e o aceite decodificava de
volta e inseria `status='accepted'`.

Reproduzido em produção com rollback forçado: o freela de QA enumerou 9 empresas, derivou o token
de uma com quem não tem relação nenhuma e entrou no elenco dela como aceito. Aquela empresa nunca
emitiu convite. O comentário da própria RPC dizia *"Ambos consentiram (empresa gerou+enviou o
link)"* — a primeira metade era falsa.

Estar no elenco **aceito** é o que torna a pessoa selecionável no Chamado de Turno, incluível em
`team_lists` e elegível como indicada. "Lista fechada" é a premissa do modelo push inteiro.

Corrigido: token aleatório opaco em `company_invite_links`, com RLS. O segredo não podia morar em
`companies` — aquele SELECT liberado publicaria a coluna. Segunda migration devolve a leitura a
quem tem vínculo **aceito**, para não matar o link transitivo (o mecanismo de crescimento do
produto: fechado, mas transitivo). Conferido: o freela lê exatamente 2 tokens para 2 elencos.

O sentido inverso (empresa adiciona pelo Worki ID do freela) **não** tinha o problema: cria
`pending`, que ainda depende do "sim" do freela.

### 32. 🟠 Agenda dizia "SÉRIE · TODA SÁBADO"
Duas telas montavam `toda ${dia}` fixo; domingo e sábado são masculinos. O resumo pós-criação
ainda juntava gêneros numa lista ("toda sexta e sábado"). Extraído para `lib/weekdayLabels.ts`
com teste — cada tela tinha sua cópia da lista de dias.

### 33. 🟠 Nota 5.0 num terceiro lugar, e textos de auth sem acento
Carteira de Clientes mostrava "5.0 (0)" — o selo que o freela lê antes de aceitar convite.
E as telas de recuperação de senha e do admin ("ENVIAR LINK DE RECUPERACAO", "Este email nao tem
permissao") — justamente as telas de quem já está com problema para entrar.

## ✅ Verificado funcionando
Série: edição em massa com dry-run exato ("7 turnos serão atualizados, 1 será mantido porque já
tem freela confirmado") e cancelamento com **soft delete** — série `stopped`, 7 ocorrências
`deleted`, e as 8 linhas ainda no banco, sem destruir métrica em cascata. Listas: criar, renomear
e excluir. WhatsApp: telefone normalizado com DDI 55, horário fatiado para `HH:MM`, valor e link.
Cancelar convite com aviso diferenciado ao freela. Recibo com impressão. QR e Worki ID.
Notificações com marcar-todas-como-lidas. Recuperação de senha (rate-limit tratado). Admin com
gate próprio, negando freela comum.

## ⚠️ Superfície morta em produção (não removi — é decisão sua)
`jobs-api`, `applications-api` e `profiles-api` estão **ativas**, com `verify_jwt: false`, **sem
código no repositório** e **sem nenhum chamador no frontend** — resíduo do backend anterior ao
pivô. Exigem `Authorization` (não estão abertas), mas são código não auditável rodando em
produção. Apagar função em produção é destrutivo e fica para você decidir.

## Nota de método (quinta passagem)
- **Meus próprios filtros produziram três falsos "não existe"**: descartar botões por
  `innerText.length > 3` esconde botões de ícone — que é justamente como editar/excluir lista e
  abrir o menu da série são expostos (todos com `aria-label` correto). Antes de afirmar que uma
  ação não existe na UI, listar os botões **sem filtro**, com `aria-label` e `title`.
- **Comando longo demais chega truncado**: dois heredocs falharam com "unexpected EOF" porque o
  conteúdo era grande. Escrever migration extensa em partes, verificando `wc -l` a cada uma.

---

# Sexta passagem — pronto para o piloto (24/08/2026)

Lente: piloto real com alguns freelas e uma empresa. Testado nos dois papéis, em **viewport de
celular** (390×844), que é como o piloto vai rodar.

### 34. 🔴 Todo horário do chat aparecia 3 horas no futuro
Mandei mensagem às 18:41 (BRT) e o app mostrou **21:40**. `Message.createdat` era `timestamp`
**sem fuso** guardando UTC, e o JS lê string naive como hora local. Pior: o eco otimista usava
`toISOString()`, então a mensagem aparecia certa ao enviar e **pulava 3 horas depois do reload** —
dois horários para a mesma mensagem. O chat é onde o turno se combina ("chego 15 min antes").

### 35. 🔴 "Cadastrar como Trabalhador" abria a tela de ENTRAR
O freela novo digitava e recebia "Email ou senha incorretos" — para uma conta que nem existe. É o
primeiro passo de todo participante, e o atrito mais caro que existe: acontece antes de a pessoa
ter qualquer motivo para insistir.

### 36. 🔴 Notificação nunca chegava sem recarregar
`notifications` não estava na publicação `supabase_realtime` — só `Conversation` e `Message`.
Lendo o cliente, as duas pareciam tempo real; a diferença só aparecia no catálogo. Sem isso, "o
primeiro que aceitar preenche" vira corrida entre quem por acaso estava com o app aberto.

### 37. 🔴 Data de pagamento virava o dia anterior no CSV do financeiro
Relatório mostrava turno em 23/08 e pagamento em **22/08** — pago antes de acontecer. A data pura
do `<input type="date">` ia crua e virava meia-noite UTC = 21h do dia anterior no Brasil.

### 38. 🟠 Painel dizia "Vaga preenchida" quando a EMPRESA cancelava
Chamado `cancelled`, alvo `closed`, **zero contratados** — e a tela dizia que a vaga foi
preenchida. Painel de operação que mente uma vez deixa de ser consultado.

### 39. 🟠 Chamado vencido continuava exibido como ABERTO
Às 20:23, "CHAMADO ABERTO … expira **16:23**", com botão de cancelar. Nada no sistema transiciona
chamado vencido: o `expire-invites` existe, está no ar, mas só mexe em `applications` e **nenhum
cron o chama**. A empresa abre de manhã, vê um chamado "aberto" que morreu à noite e **espera por
ele** — exatamente a quebra de escala que o produto existe para evitar.

## ✅ Verificado funcionando
Cadastro completo de freela novo **pelo celular**, com `primary_role` e grade de disponibilidade
gravando certo; perfil público da empresa com avaliador mascarado; freela iniciando conversa e a
empresa sendo notificada; **os três `pg_cron` rodando diariamente** — e o da véspera de fato
*produziu* um pedido automático às 21:00 UTC, não só "succeeded"; revogação de gerente com perda
de acesso imediata; recusa de indicação **neutra** (sem vínculo criado, e a pessoa segue no elenco
de quem indicou); export CSV no formato brasileiro; páginas estáticas com Termos e Privacidade
reais. **Nenhuma tela com rolagem horizontal no celular.**

## Nota de método (sexta passagem)
- **Testar no viewport errado esconde uma dimensão inteira.** O produto é mobile-first e eu tinha
  testado tudo em desktop até aqui. Passar para 390×844 foi o que colocou o cadastro do freela no
  caminho — e foi lá que o CTA quebrado apareceu.
- **"Succeeded" não é "funcionou".** Os crons apareciam como sucesso todo dia; só olhando se
  *produziram linha* dá para saber se a promessa é real.

---

# Sétima passagem — o laço do dinheiro, ponta a ponta (25/08/2026)

Motivo: as mudanças estruturais de 25/08 (drop de 11 tabelas, remoção de uma FK e de uma coluna da
`Conversation` **viva**, troca da policy de INSERT em `notifications`, remoção de 4 edge functions)
foram verificadas no catálogo e no PostgREST, mas **não** com alguém logado usando o produto — as
contas de QA tinham sido apagadas na véspera. Criei um par novo, percorri o laço inteiro e apaguei
no fim.

## ✅ Verificado funcionando (segunda metade do laço, que a sexta passagem não cobriu)

Check-in do freela → check-out → empresa confirma chegada → confirma saída → **REGISTRAR PAGAMENTO**
(modal com a chave PIX do freela e a copy declaratória) → notificação "Pagamento registrado —
confirme" → `/recibo/:jobId` com chegada, saída, horas, valor, forma e nota → **termo F6** renderizado
com `CNPJ` corretamente rotulado para a empresa → aceite eletrônico → avaliação 5.0 com a contagem.

Conferido no banco ao fim: `shift_payments.status='recorded'`, `worker_confirmed_at` preenchido,
`service_terms.accepted_at/accepted_ip/accepted_user_agent` preenchidos com o texto congelado,
`applications.status='completed'`, agregados do freela recomputados (**LVL 1 → LVL 2**, xp 175) e
**`escrow_transactions` inalterado** — Article 8 intacto, nenhum saldo se moveu.

Também revalidada a primeira metade depois das mudanças: convite de elenco nos dois sentidos, chamado
de turno com notificação, `first_claim_at` ("Primeira vaga preenchida em 2 min"), e o **chat** —
criar conversa, enviar e ler dos dois lados, com horário em BRT correto.

## 🐛 Achados (corrigidos no mesmo dia)

### 40. 🔴 Erro em produção não ia para lugar nenhum
`Sentry.init` roda dentro de `if (SENTRY_DSN)` e `VITE_SENTRY_DSN` não existe no build da Vercel —
conferido no bundle servido (nenhum DSN) e no navegador (`window.__SENTRY__` só com `version`, sem
cliente). Como o ramo PROD de `logError` **não** chamava `console.error`, as 330 chamadas do app
descartavam todo erro em silêncio. Mitigado: o logger volta a usar o console quando detecta que o
Sentry não subiu. A correção real é o DSN, que depende da conta do dono.

### 41. 🟡 Dois textos sem acento
Página 404 inteira ("Pagina nao encontrada") e a dica do onboarding da empresa ("volume de
contratacao") — justamente a frase que diz ao usuário o que falta para habilitar FINALIZAR.

## Nota de método (sétima passagem) — três falsos positivos meus

Nenhum dos três era defeito do produto. Todos vieram do **instrumento**, e dois quase viraram bug
reportado:

1. **"Página em branco"** no criar-turno: `document.visibilityState === "hidden"`. As duas sessões
   rodam em janelas separadas e o navegador não calcula layout para a janela em segundo plano —
   `innerText` volta vazio mesmo com o DOM inteiro montado. Corrigido com `Page.bringToFront` antes
   de cada leitura.
2. **"Chat não envia"**: cheguei a confirmar no banco que a mensagem não entrava. O `Input.dispatchMouseEvent`
   do CDP não chega ao React nessas janelas; com `.click()` via JS enviou na hora. O mesmo vale para
   o checkbox do termo, que só marcou com o setter nativo + evento `change`.
3. **"Turno duplicado"**: criei 4 turnos clicando programaticamente um botão que, para um humano,
   está a 1512px de altura atrás de dois overlays — `elementFromPoint` devolveu `nada` e
   `ALCANCAVEL=false`.

Regra que passa a valer para qualquer passagem futura: **suspeita de bug em interação sintética só
vira achado depois de conferir no banco ou no DOM**. E `.click()`, clique real do CDP e setter nativo
são três caminhos diferentes — quando um falha, testar os outros antes de concluir qualquer coisa.
