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
