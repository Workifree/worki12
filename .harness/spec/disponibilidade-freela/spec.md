# Disponibilidade declarada pelo freela (F7) — spec

> Feature F7 do backlog pós-entrevista Divino Fogão. Slug: `disponibilidade-freela`. Tipo: feature (M).
> Todas as decisões de escopo abaixo foram fixadas pelo clarifier sem confirmação humana, por instrução
> explícita da tarefa — cada uma está marcada **(Assumido)** e justificada em "Clarifications log". Nenhum
> arquivo foi editado por este agente (só leitura); outros agentes podem estar tocando `ShiftCallModal.tsx`,
> `Profile.tsx`, `types/index.ts` e `TeamConnectionService` em paralelo (F5 — Guarda de Vínculo — está "em
> construção agora" no mesmo componente). **O builder que pegar esta spec precisa reconferir o estado real
> desses 4 arquivos antes de editar**, especialmente a seção "Interação com F5" abaixo.

---

## Context

O Chamado de Turno (F1, `shift_calls`/`ShiftCallModal.tsx`) resolveu o disparo simultâneo — a empresa não
liga mais para um freela de cada vez. Mas o disparo continua **cego**: chama todo o elenco sem saber quem
trabalha de manhã, quem só à noite, quem tem outro emprego na terça. Isso gera dois efeitos negativos que a
entrevista não citou literalmente, mas que o gargalo torna óbvio: ruído para o freela (chamado que ele nunca
poderia aceitar → com o tempo, ele para de abrir) e uma taxa de aceite artificialmente baixa (a empresa acha
que "ninguém quer trabalhar" quando na verdade chamou as pessoas erradas). Também é o insumo natural do
ranking de descoberta automática (SOS, feature futura): sem disponibilidade declarada, "quem provavelmente
aceita" é chute.

O projeto já tem uma declaração de disponibilidade — `workers.availability` (text[], períodos livres:
Manhã/Tarde/Noite/Madrugada/Fim de Semana), coletada uma vez no passo 3 do `WorkerOnboarding` e **nunca mais
editável** (confirmado por leitura: `Profile.tsx` não inclui `availability` no `formData`/modo de edição —
é write-once). Isso é, por si, o problema nº2 do enunciado (disponibilidade desatualizada é pior que
ausente) já materializado no código: hoje ela só pode ficar desatualizada, nunca corrigida.

Esta feature **não substitui** esse campo legado — ele fica como está (fora de escopo, ver "Out-of-scope").
Ela **adiciona** uma segunda declaração, estruturada por dia da semana × período, editável a qualquer
momento, que é o dado que de fato responde "quem pode vir nesta terça de manhã" — o legado (períodos soltos,
sem dia) não responde a essa pergunta.

---

## Requirements

### Modelo de dados

**R1 — Nova coluna `workers.availability_days jsonb NULL` (migration nova, `supabase/migrations/`).**
Coexiste com `workers.availability` (legado, intocado). Estrutura: objeto cujas chaves são o dia da semana
como string `'0'`–`'6'` (**0 = domingo, 6 = sábado** — mesma convenção já usada por `job_series.weekdays`,
migration `20260817000400`, para não criar uma segunda convenção de semana concorrente no schema) e cujos
valores são arrays de períodos, subconjunto de `['manha', 'tarde', 'noite']`. Chave ausente = "não declarado
para este dia" (neutro — nunca "indisponível"). Coluna inteira `NULL` = freela nunca declarou nada.
Constraint leve: `CHECK (availability_days IS NULL OR jsonb_typeof(availability_days) = 'object')` — mesmo
nível de validação estrutural que o schema já aplica a outros campos livres (não há CHECK enumerando valores
de período; a validação de enum fica no client, como já ocorre com `roles`/`tags`). Sem índice: a leitura é
sempre "worker inteiro dentro de um roster já carregado" (ver R5), nunca um `WHERE availability_days @>` —
não há necessidade de GIN aqui nesta fatia.

**R2 — RLS: nenhuma policy nova.** A policy de SELECT de `workers` já é `USING
(public.can_view_worker_profile(id))` (migration `20260816120000`) — cobre a linha inteira, coluna nova
inclusa, sem trabalho extra (responde a pergunta de privacidade: só o próprio freela, empresas com
`team_connections` pending/accepted, ou empresas com vínculo operacional via `applications` — mesma regra do
telefone/PIX). A policy de UPDATE já é `USING (id = auth.uid()) WITH CHECK (id = auth.uid())` (migration
`20260309000000`) e o `GRANT SELECT, INSERT, UPDATE ON public.workers TO authenticated` já é de tabela
inteira (não por coluna) — a landmine "`GRANT UPDATE (coluna)` é aditivo, exige REVOKE antes" **não se
aplica aqui**: não estamos adicionando um GRANT por coluna, a coluna nova herda o GRANT de tabela já
existente. Migration = só `ALTER TABLE` + comentário; aciona o gate automático do pipeline
(`supabase/migrations/**` → architect + security-reviewer) mesmo sendo uma coluna simples, por tocar tabela
com RLS sensível.

**R3 — `types/index.ts`.** Novo tipo `AvailabilityPeriod = 'manha' | 'tarde' | 'noite'` e
`AvailabilityDays = Partial<Record<'0'|'1'|'2'|'3'|'4'|'5'|'6', AvailabilityPeriod[]>>`.
`WorkerProfile` ganha `availability_days?: AvailabilityDays | null;`. **Builder: reconfirme o estado atual do
arquivo antes de editar — F3/F4/F5 podem ter mudado sob os pés.** Nota de dívida pré-existente (não corrigir
aqui): `WorkerProfile.availability` já está tipado como `string`, mas o dado real gravado por
`WorkerOnboarding` é `string[]` — `Profile.tsx` já contorna isso com um tipo local `string | string[] |
null`. Não confundir o campo legado com o novo `availability_days`.

### Lógica pura (testável, Vitest)

**R4 — `lib/dateUtils.ts` ganha `getWeekdayIndex(dateOnly: string): number`.**
Construída sobre `parseDateOnly` já existente (`new Date(y, m-1, d).getDay()`), NUNCA `new Date(isoString)`
cru — mesmo cuidado de fuso já documentado no cabeçalho do arquivo. Retorna 0 (domingo) a 6 (sábado), mesma
convenção do R1/`job_series.weekdays`.

**R5 — novo arquivo `lib/availability.ts`** com 2 funções puras + teste co-located
(`lib/availability.test.ts`):
- `periodForTime(time: string | null | undefined): AvailabilityPeriod | null` — bucket a partir de
  `job.work_start_time` (texto `"HH:MM"`): `05:00–11:59` → `'manha'`; `12:00–17:59` → `'tarde'`;
  `18:00–04:59` (inclui madrugada, dobrada dentro de "noite" nesta fatia) → `'noite'`. `null`/vazio/valor
  não-parseável → `null` (sem período conhecido).
- `isWorkerAvailableFor(days: AvailabilityDays | null | undefined, weekday: number, period:
  AvailabilityPeriod | null): boolean` — `false` se `days` for `null`/vazio OU `period` for `null`; caso
  contrário, `true` sse `days[String(weekday)]?.includes(period)`.

### `ShiftCallModal.tsx` — onde a empresa usa o sinal

**R6 — Ordena, não filtra.** Ninguém desaparece da lista por não ter disponibilidade compatível — a empresa
continua podendo chamar quem quiser, inclusive alguém "indisponível" (a declaração é sinal, não trava; mesmo
princípio já adotado pela F5 para o aviso de frequência: nunca bloqueia). `available` (useMemo já existente,
linha ~84 hoje) ganha um sort estável: membros cujo `worker.id` está no conjunto de "match" (ver R7) vêm
primeiro; a ordem relativa de todos os demais (com ou sem declaração, mas sem match para ESTE turno) fica
INALTERADA — nenhuma penalização por não ter preenchido nem por ter preenchido outro dia/período (responde
diretamente ao "não pode ser penalizado" do enunciado: quem nunca declarou e quem declarou mas não para este
horário ficam no MESMO patamar, sem diferenciação visual entre os dois).

**R7 — Cálculo do match, 1x por abertura do modal.** `weekday = getWeekdayIndex(job.start_date)` e
`period = periodForTime(job.work_start_time)`, ambos `useMemo` dependentes só de `job` (estável enquanto o
modal está aberto). Se `job.work_start_time` for `null`/ausente (`period === null`), NENHUM membro recebe
destaque/reordenação — não há como computar match sem horário conhecido (é o caso "turno sem horário
definido", já tratado como fallback em `lib/jobScheduling.ts`). Conjunto de match:
`members.filter(m => isWorkerAvailableFor(m.worker.availability_days, weekday, period))`. **Zero query
nova** — dado já vem no roster carregado (ver R8), diferente da F5 que precisou de uma query agregada extra;
esta fatia é mais barata.

**R8 — `TeamConnectionService.listTeamMembers()` ganha `availability_days` no `select` do join
`worker:workers(...)`** (hoje já lista `id, full_name, avatar_url, primary_role, roles, rating_average,
reviews_count, completed_jobs_count, city, phone, pix_key` — só adicionar a coluna à lista existente, sem
mudar a forma da query).

**R9 — Selo visual "Disponível".** Para membros no conjunto de match (R7), um selo curto ao lado do texto de
`primary_role` (linha secundária do card, NÃO ao lado do nome — ver R10 sobre F5) — pill neo-brutalista
verde (`bg-primary-light`/`text-primary`, mesma paleta já usada no próprio `ShiftCallModal` para o estado
selecionado; Article 13 permite verde aqui porque o dado É do worker, mesmo renderizado em tela de empresa —
precedente já existe no arquivo). Texto: `"Disponível"` (curto; o período/dia já está implícito pelo
contexto do turno sendo chamado — não repetir "manhã de terça" no selo, isso é ruído). `aria-label`
explicando o sinal para leitor de tela: `"Freela declarou disponibilidade para este turno"`. Toque mínimo
44px preservado (selo é decorativo, não é alvo de toque — não compete com a área clicável do `<label>` do
card).

**R10 — Interação com F5 (Guarda de Vínculo, `guarda-vinculo/spec.md`), mesmo componente.**
F5 desenha um selo amarelo (`AlertTriangle`, `"Já {N}x esta semana"`) **ao lado do nome** + banner no rodapé.
F7 desenha um selo verde (`"Disponível"`) **na linha do cargo** (abaixo do nome), e NÃO adiciona banner de
rodapé nem afeta o botão de disparo. As duas features são independentes em dado e em posição — não há
dependência de código entre elas, só uma regra de layout para não empilhar dois selos no mesmo lugar: **F7
fica na linha secundária (cargo); F5 fica na linha do nome.** Se o F5 já estiver implementado quando este
builder chegar, reconferir visualmente que os dois selos não colidem (ex.: nome + selo F5 numa linha, cargo
+ selo F7 na linha de baixo). Se o F5 ainda não existir, nenhuma ação adicional é necessária — F7 não
depende do F5 para funcionar.

**R11 — Sem filtro/toggle "só disponíveis" nesta fatia.** Fora de escopo (ver "Out-of-scope") — manter a
superfície mínima: só reordenação + selo.

### Declaração e edição (`Profile.tsx`)

**R12 — Onde o freela declara: `Profile.tsx`, em modo de edição, card NOVO** (ex.: "Disponibilidade por
dia"), distinto do card "Disponibilidade" já existente na grid de stats (que continua mostrando o campo
legado `availability`, intocado — ver "Out-of-scope"). Grid de 7 dias (rótulos abreviados PT-BR: Dom, Seg,
Ter, Qua, Qui, Sex, Sáb — índice 0=Dom, mesma convenção do R1/R4) × 3 chips de período (Manhã/Tarde/Noite)
por dia, toque ≥44px por chip (constitution: features anteriores foram reprovadas por isso — não repetir).
Estado local do formulário de edição (`formData.availability_days` ou state próprio, à escolha do builder,
seguindo o padrão já existente de `formData`/`isEditing` do arquivo). Salvar reusa `handleSave` (mesmo
padrão `.select('id')` + checagem de `data.length === 0` já usado neste arquivo para nunca afirmar sucesso
quando o RLS nega em silêncio — Article/patterns.md já citado no próprio `Profile.tsx`).

**R13 — Exibição fora do modo de edição.** Resumo legível dos dias com pelo menos 1 período marcado (ex.:
abreviações dos dias declarados) quando `availability_days` tiver algum dado; texto `"Não declarado"` quando
`null` ou objeto vazio — nunca deixar o card em branco silencioso.

**R14 — Lembrete de manter atualizado: CTA persistente, sem cadência de re-pergunta.**
Banner/CTA no Dashboard do worker (`pages/Dashboard.tsx`), visível **somente enquanto
`availability_days IS NULL`** (nunca depois de qualquer primeiro salvamento, mesmo parcial — um único dia
marcado já encerra o CTA permanentemente nesta fatia). Texto direto, sem culpa: algo como "Declare sua
disponibilidade para receber chamados mais certeiros" com link para `/profile`. **Não** há verificação de
"desatualizado há X semanas" nesta fatia (ver "Out-of-scope") — resolve o "nunca declarado" (o caso mais
comum e mais barato de resolver agora), não o "declarado e ficou velho" (mais caro, precisa de heurística,
fica para depois).

**R15 — Onboarding (`WorkerOnboarding.tsx`) fica INTOCADO.** O passo 3 continua coletando só o campo legado
`availability` (períodos livres, sem dia). Não adiciona a grade nova ao onboarding — motivo: manter o gate
de conclusão de onboarding leve (o enunciado do briefing já avisa que mais campo obrigatório = mais gente
não preenche e a feature morre com dado vazio); a grade nova é opt-in, pós-onboarding, editável a qualquer
momento.

---

## Acceptance criteria

- [ ] A1 (declarar e persistir): Dado um freela em `/profile` no modo de edição, quando marca "Manhã" e
      "Tarde" para "Terça" e salva, então `workers.availability_days` grava `{"2": ["manha", "tarde"]}`
      (índice 2 = terça, domingo=0) e o card fora do modo de edição passa a mostrar "Ter" entre os dias
      declarados (deixa de mostrar "Não declarado").
- [ ] A2 (match reordena, não filtra): Dado um turno com `start_date` numa terça e `work_start_time =
      "08:00"` (→ `período='manha'`, `weekday=2`) e um elenco de 5 membros onde só o freela X tem
      `availability_days = {"2": ["manha"]}`, quando a empresa abre o `ShiftCallModal` deste turno, então X
      aparece primeiro na lista com o selo "Disponível" ao lado do cargo, e os outros 4 (com ou sem
      `availability_days` preenchido para outros dias/períodos) continuam visíveis, selecionáveis e na MESMA
      ordem relativa entre si.
- [ ] A3 (sem penalização por não declarar): Dado o mesmo turno de A2, um freela Y sem `availability_days`
      (`null`) e um freela Z com `availability_days = {"2": ["noite"]}` (não bate com "manha" do turno),
      quando o modal renderiza, então nem Y nem Z recebem o selo "Disponível" e nenhum dos dois é reordenado
      para baixo ou visualmente marcado como negativo — aparecem exatamente como apareceriam sem esta
      feature.
- [ ] A4 (turno sem horário definido): Dado um turno com `work_start_time = null`, quando o
      `ShiftCallModal` abre, então nenhum membro recebe o selo "Disponível" e a ordem da lista é idêntica à
      de antes desta feature (nenhum sort de disponibilidade é aplicado).
- [ ] A5 (nunca bloqueia disparo): Dado qualquer combinação de disponibilidade declarada/ausente entre os
      selecionados, quando a empresa clica "Chamar N freelas"/"Enviar convite", então
      `ShiftCallService.createShiftCall` é chamado normalmente — a disponibilidade não desabilita o botão
      nem exige confirmação extra (mesmo princípio de não-bloqueio já usado pela F5).
- [ ] A6 (privacidade — mesma regra do telefone/PIX): Dado uma empresa SEM vínculo (`team_connections`
      pending/accepted OU `applications`) com um freela W, quando essa empresa tenta ler a linha de W em
      `workers` (qualquer coluna, incluindo `availability_days`), então a policy
      `workers_select_self_or_related` nega a linha inteira — nenhuma query nova é necessária para cobrir
      isso, é o comportamento já vigente de `can_view_worker_profile`.
- [ ] A7 (RLS de escrita — só o dono): Dado um freela A autenticado, quando ele tenta `UPDATE workers SET
      availability_days = ... WHERE id = <freela B>`, então a policy de UPDATE (`id = auth.uid()`) nega —
      0 linhas afetadas, sem exceção nova (mesma policy já vigente, sem mudança).
- [ ] A8 (`periodForTime` — função pura, Vitest): `periodForTime("08:00")` → `'manha'`;
      `periodForTime("14:30")` → `'tarde'`; `periodForTime("23:00")` → `'noite'`; `periodForTime("03:00")`
      → `'noite'`; `periodForTime(null)` → `null`; `periodForTime("")` → `null`.
- [ ] A9 (`getWeekdayIndex` — função pura, Vitest, fuso local): Dado `"2026-08-18"` (uma terça), quando
      `getWeekdayIndex` calcula, então retorna `2`, testável com casos de virada de fuso (mesmo padrão dos
      testes que já cobrem `parseDateOnly` perto da meia-noite BRT) sem depender de `new Date(isoString)`
      cru.
- [ ] A10 (CTA de Dashboard — aparece e some corretamente): Dado um freela com `availability_days = null`,
      quando ele abre o Dashboard, então o banner de CTA aparece; dado que ele salva qualquer declaração
      parcial (ex.: 1 dia, 1 período) em `/profile`, quando ele volta ao Dashboard, então o banner NÃO
      aparece mais.
- [ ] A11 (elenco não penalizado por não ter dado): Dado um elenco onde NENHUM membro preencheu
      `availability_days`, quando o `ShiftCallModal` abre para qualquer turno, então a lista renderiza
      exatamente como hoje (sem selos, sem reordenação, sem erro) — zero regressão para empresas cujo
      elenco inteiro ainda não adotou a feature.

---

## Out-of-scope

- Substituir, migrar ou tornar editável o campo legado `workers.availability` (períodos livres do
  onboarding) — coexiste intocado (R15/R12). Unificação dos dois modelos fica para uma fatia futura, se
  fizer sentido depois que o novo modelo tiver adoção.
- Adicionar a grade de disponibilidade ao `WorkerOnboarding` — fica pós-onboarding, opt-in (R15).
- Filtro/toggle "mostrar só disponíveis" no `ShiftCallModal` — só reordenação + selo (R6/R11).
- Qualquer bloqueio de disparo por falta de disponibilidade compatível — a declaração é sinal, nunca trava
  (R6/A5), mesmo princípio já estabelecido pela F5.
- Heurística de "declaração desatualizada" (ex.: reabrir o CTA depois de N semanas sem revisão, avisar a
  empresa que o dado do freela está velho) — resolve só o caso "nunca declarou" nesta fatia (R14).
- Selo/reordenação de disponibilidade em qualquer outra tela além do `ShiftCallModal` (ex.: `CompanyTeam`,
  relatório, BI, `WorkerPublicProfile`) — só o ponto de disparo, mesmo escopo de integração que a F5 adotou
  para o próprio sinal dela.
- Ranking/score de "quem provavelmente aceita" (SOS, feature futura citada no contexto) — esta fatia entrega
  só o dado bruto + reordenação binária (match/não-match), não um score.
- Notificação/lembrete assíncrono (push, e-mail, WhatsApp) pedindo para declarar ou atualizar disponibilidade
  — só o CTA síncrono no Dashboard (R14).
- Granularidade abaixo de período (ex.: horário exato HH:MM por dia) ou acima de período (ex.: "madrugada"
  como 4º bucket separado) — 3 períodos fixos (manhã/tarde/noite), madrugada dobrada em "noite" (R5).
- Multi-unidade/loja — disponibilidade é do freela, não tem escopo por loja (não há tabela `stores`/`units`
  hoje, mesma observação já feita pela F5 sobre seu próprio contador).

---

## Clarifications log

- Q: Grade de dias × turnos, faixas de horário livre, ou toggle simples "última hora"? → A (Assumido): grade
  dia da semana (0–6, dom–sáb) × período fixo (manhã/tarde/noite), a fidelidade mínima que responde
  literalmente ao gargalo citado no contexto ("quem trabalha de manhã, quem só à noite, quem tem outro
  emprego na terça" — período sozinho não cobre "terça", dia sozinho não cobre "de manhã"). Horário livre
  (HH:MM exato) foi descartado por custo de preenchimento (mais fino = menos gente preenche, conforme o
  próprio enunciado avisa) sem ganho prático para o caso de uso (a empresa decide por turno, que já é
  bucketizado em período pelo `work_start_time` existente).
- Q: Substituir, estender ou coexistir com `workers.availability`? → A (Assumido): coexistir. Substituir
  quebraria o passo 3 do onboarding (write-once hoje) e perderia o dado já coletado de todo o elenco
  existente; estender o mesmo array pra virar um objeto por dia mudaria o contrato de leitura de
  `Profile.tsx` sem necessidade. Coexistir é reversível e não deleta dado.
- Q: Onde o freela declara, como é lembrado? → A (Assumido): `Profile.tsx`, editável a qualquer momento
  (resolve a raiz do problema nº2 do enunciado: hoje `availability` legado é write-once, o que é PIOR que
  "desatualizado" — é estruturalmente impossível de corrigir). Lembrete: CTA persistente e simples no
  Dashboard enquanto `availability_days IS NULL`, sem heurística de "ficou velho" (fica para depois, R14).
- Q: Filtro ou ordenação no `ShiftCallModal`? → A (Assumido): ordenação (R6) — filtrar esconderia gente que
  a empresa ainda pode querer chamar (ex.: freela de confiança que esqueceu de declarar hoje), e o
  enunciado é explícito: "a declaração é sinal, não trava". Mesmo princípio de não-bloqueio que a F5 já
  adotou para o aviso de frequência (avisa, nunca impede).
- Q: O que acontece com quem não preencheu? → A (Assumido): tratamento idêntico a quem preencheu mas não
  bate com o turno atual — ambos ficam no mesmo patamar visual/de ordem, nunca penalizados (R6/A3/A11). Foi
  uma decisão deliberada evitar que preencher parcialmente "pareça pior" do que nunca ter preenchido (isso
  desincentivaria o preenchimento incremental).
- Q: Fuso e semana — onde mora a conversão dia-da-semana? → A (Assumido): `lib/dateUtils.ts` (mesmo arquivo
  que já concentra `parseDateOnly`/`todayLocalDate`/o histórico de bug de off-by-one), nova função
  `getWeekdayIndex` construída sobre `parseDateOnly` (nunca `new Date(isoString)` cru). Convenção 0=domingo,
  6=sábado — reaproveitada de `job_series.weekdays` (F3) para não criar uma segunda convenção de semana no
  mesmo schema.
- Q: Como convive com a guarda de vínculo (F5), que também usa o `ShiftCallModal`? → A (Assumido): mesmo
  componente, sinais visualmente separados (selo verde na linha do cargo para F7, selo amarelo na linha do
  nome para F5, sem banner de rodapé para F7) — ver R10. Nenhuma dependência de código entre as duas
  features; a interação é só uma regra de layout para não empilhar dois selos no mesmo lugar.
- Q: Privacidade — quem vê a disponibilidade de um freela? → A (Assumido): a mesma regra que já protege
  telefone/PIX — `can_view_worker_profile` (self, elenco pending/accepted, ou vínculo operacional via
  `applications`). Nenhuma policy nova: RLS é por linha inteira no Postgres, a coluna nova herda a proteção
  já existente da tabela `workers` (R2/A6).
