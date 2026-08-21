# SOS: descoberta automática de freelas próximos em urgência (F11) — spec

> Feature F11 do backlog pós-entrevista Divino Fogão (17/08/2026). Slug: `sos-descoberta`. Tipo: feature (L —
> toca modelo fechado, exige gate de arquitetura). **Tentativa anterior morreu por erro de API sem gravar
> nada; esta é a reconstrução do zero.** Todas as decisões abaixo foram fixadas pelo clarifier sem confirmação
> humana, por instrução explícita da tarefa — cada suposição está marcada e justificada. **Nenhum código foi
> escrito; nenhuma migration foi criada.** Esta spec é insumo do gate `harness-architect` antes de qualquer
> implementação (ver "Decisão irreversível" abaixo).

---

## ⚠️ DECISÃO IRREVERSÍVEL — rotear ao architect antes de qualquer código

**Abrir o grafo fechado, mesmo que parcialmente e com salvaguardas, é uma mudança de modelo de produto, não
um detalhe de implementação.** O anti-vision (`product.md`) e a fala do próprio sócio-entrevistado ("ainda
mantemos fechado... dificilmente alguém do zero, de fora absoluto, como é a premissa de todos os
marketplaces por aí fadados ao fracasso") tornam isso o ponto mais sensível de toda a leva F1–F11. Esta spec
resolve a tensão com um desenho específico (Requirements abaixo), mas **a costura R1 (fronteira do alcance),
R7 (anti-abuso) e R4 (opt-in) precisam de aprovação humana explícita antes do builder tocar em schema** —
não é decisão que o clarifier ou o builder devem fixar sozinhos. Recomendação: `harness-architect` produz ADR
dedicado ("SOS — abertura controlada do grafo fechado") antes da Fase 3.

---

## Context

O Chamado de Turno (F1) resolveu o disparo simultâneo dentro do elenco: a empresa chama todo mundo de uma vez
e fica com o primeiro que aceitar. Mas o F1 tem um teto estrutural — **se ninguém no elenco aceitar, o turno
fica aberto**. É exatamente o cenário relatado pelo sócio de 10 unidades: "8:30 o freela cancela, [o turno]
abre às 10... o app dispara uma chamada para freelas próximos das empresas próximas, de qualidade suficiente."

O SOS é o **fallback do F1**, não um canal paralelo: dispara só quando o alcance normal (elenco) já esgotou e
o relógio está apertado. A dificuldade central não é técnica — é que "alcançar freelas fora do elenco" é,
por definição, a definição operacional de "abrir o grafo". O produto vendeu ao mercado (e o próprio
entrevistado reafirmou) que o Worki NÃO é um marketplace aberto tipo os que "fracassam por aí". Esta spec
resolve a tensão restringindo o alcance a um círculo de **confiança de segundo grau** (quem já trabalhou para
alguma empresa da rede, nunca "qualquer CPF cadastrado"), exigindo **consentimento prévio explícito** do
freela para ser descoberto, e protegendo a relação comercial de terceiros (a empresa que descobre nunca
enxerga de onde veio o histórico do freela descoberto).

---

## Requirements

### Modelo de alcance — a fronteira do "próximo"

**R1 — Proximidade é por CIDADE, não geolocalização contínua.** O Worki não tem lat/long de freela nem
tracking contínuo (adicionar isso é decisão grande de LGPD, fora de escopo — ver "Questões abertas").
Proximidade = `workers.city` (já coletado no onboarding) igual à cidade do endereço da empresa que abre o
SOS (`companies.city`, já existente desde `20260317140000_add_city_to_companies.sql`). Comparação
case-insensitive, sem geocodificação/distância em km nesta fatia. **Suposição de impacto se errada:** se o
piloto operar em cidades grandes (São Paulo capital), "mesma cidade" pode devolver centenas de candidatos
irrelevantes por distância de bairro — mitigação nesta fatia é o corte de qualidade (R2) + cota (R7), não
geolocalização fina.

**R2 — "Qualidade suficiente" é um corte objetivo sobre sinais existentes, não um score livre.** Um freela é
elegível ao alcance SOS de uma empresa se, **simultaneamente**:
1. `completed_jobs_count >= 3` (já materializado em `workers`, F Slice 4);
2. rating médio como worker (`workers.rating_average`, agregado de `reviews` com `direction='worker'`)
   `>= 4.0` OU `reviews_count = 0` (freela novo sem review não é penalizado — mesmo princípio de
   não-penalização já adotado por F7/R6, mas aqui o corte de `completed_jobs_count >= 3` já filtra quem tem
   zero histórico, então este ramo cobre o caso raro de reviews não terem sido dadas);
3. **NÃO** tem `team_connections.status='blocked'` com a empresa que abre o SOS (o freela pode ter bloqueado
   essa empresa especificamente antes — o SOS respeita esse veto, mesmo fora do elenco dela);
4. tem opt-in explícito de descoberta (R4).
Corte fixo nesta fatia, sem UI de ajuste por empresa — evita a "empresa afrouxa o filtro para caçar geral"
que destruiria o corte de qualidade.

**R3 — "Trabalhou por ali recente" NÃO revela EM QUAL empresa.** O sinal usado é agregado e anônimo quanto à
contraparte: `completed_jobs_count` (contagem, não lista de empresas) + `workers.city` (onde mora/atua, não
"trabalhou na Empresa B da esquina"). **Nenhuma query do SOS lê `applications`/`jobs` de terceiros para expor
histórico de empresa a empresa.** Isso é deliberado: hoje `can_view_worker_profile` já impede a Empresa A de
ler a linha de um freela sem vínculo — o SOS não pode contornar essa proteção criando um canal lateral que
"empresta" visão. A empresa que abre o SOS recebe apenas: nome, foto, cargo/especialidade, `city`,
`completed_jobs_count`, rating — o mesmo conjunto público que já aparece num perfil de descoberta, nunca
"trabalhou nas empresas X, Y, Z".

**R4 — Consentimento é opt-in explícito, ancorado no F7 (`workers.availability_days`).** Nova coluna
`workers.discoverable_for_sos boolean NOT NULL DEFAULT false`. Só quem setou `true` explicitamente (toggle em
`Profile.tsx`, mesmo card de disponibilidade do F7, ou card irmão adjacente) entra no pool de alcance do SOS.
**Gancho de UX:** o toggle só é oferecido/visível para quem já preencheu `availability_days` (F7) — quem
nunca declarou disponibilidade não tem contexto suficiente para o SOS decidir "período compatível", então
oferecer o toggle antes seria descoberta sem sinal de match, pior experiência. Texto do toggle é explícito
sobre o efeito ("Empresas fora do seu Elenco podem te chamar em caso de urgência, se você tiver boa
reputação"), não checkbox pré-marcado, não "ativado por padrão para todo mundo". **Isto é o desenho que evita
o marketplace aberto: só entra quem pediu para ser encontrado — ninguém é "descoberto" contra vontade.**

### Modelo de dados — reuso do F1

**R5 — SOS reusa `shift_calls`/`shift_call_targets`, NÃO cria tabela nova.** Um SOS é um `shift_calls` com
`origin = 'sos'` (nova coluna, `text NOT NULL DEFAULT 'team'`, valores `'team' | 'sos'`) em vez de tabela
paralela. Justificativa: a métrica `first_claim_at - created_at` e o histórico "quem foi chamado × quem
respondeu" (razão de existir de `shift_call_targets`, ver `architecture.md` F1) precisam continuar valendo
igual para alcance ampliado — duplicar a tabela duplicaria a lógica de `claim_shift_slot` e fragmentaria o
BI de tempo-de-preenchimento entre dois lugares. `shift_call_targets` ganha o mesmo formato de linha
(`call_id, worker_id, notified_at, responded_at, response`), só que o `worker_id` alvo não veio de
`team_connections`, veio do pool de descoberta (R1–R4). RPC `claim_shift_slot` é reaproveitada sem mudança —
ela já opera sobre `shift_call_targets`, agnóstica a como o alvo foi selecionado.

**R6 — Nova coluna `shift_calls.origin text NOT NULL DEFAULT 'team' CHECK (origin IN ('team','sos'))`.**
Migration isolada, sem tocar em `shift_call_targets`. Permite ao BI e à UI distinguir "chamado ao elenco" de
"chamado de emergência fora do elenco" sem inferência.

**R7 — RLS de `shift_call_targets` para alvo SOS precisa de checagem adicional (gate de arquitetura).** A
policy de INSERT vigente do F1 (não documentada acima explicitamente, mas descrita em `architecture.md`:
"lista fechada... só membros aceitos podem ser convidados") trava o INSERT a `team_connections.status =
'accepted'`. Um SOS legítimo precisa inserir um `worker_id` que **não** está em `team_connections` com essa
empresa. Isso é uma mudança de policy, não um bypass client-side — precisa de nova branch na policy (ou RPC
SECURITY DEFINER dedicada `create_sos_call(job_id, reason)` que já resolve o pool internamente e insere sob
DEFINER, nunca expondo ao client a lista de candidatos antes da checagem server-side). **Recomendação:** RPC
DEFINER (`create_sos_call`) que recebe só `job_id` + `reason`, calcula o pool (R1–R4) internamente, insere
os `shift_call_targets` e devolve só a contagem de alvos notificados — a empresa nunca vê a lista de quem foi
chamado até que alguém aceite (resolve R3 no nível de RPC, não só de policy de leitura depois).

### Gatilho — o que caracteriza "urgência" verificável

**R8 — Condição de elegibilidade ao SOS (as três precisam ser verdadeiras):**
1. Existe um `shift_calls` aberto (`status='open'`) para o `job_id`, criado com `origin='team'`, cujo prazo
   (`expires_at`) já passou OU cujos alvos responderam `declined` unanimemente (mesmo critério de "esgotou"
   já coberto por `decline_shift_call`/expiração do F1);
2. `jobs.start_date` está a **menos de 4 horas** do momento atual (limiar fixo nesta fatia — não configurável
   por empresa, para não virar cada empresa definindo "urgência" do jeito que lhe convém e usando o SOS como
   canal padrão);
3. o turno ainda tem `slots` não preenchidos (mesma contagem já usada por F1: `hired|in_progress|completed`
   < `slots`).
**Suposição de impacto se errada:** 4 horas foi escolhido para cobrir literalmente o cenário citado
("cancela às 8:30, turno abre às 10" = 1h30 de antecedência) com folga, sem abrir demais; se o piloto
mostrar que 4h é curto ou longo demais, é parâmetro de configuração futura, não redesenho.

**R9 — Disparo é BOTÃO EXPLÍCITO nesta fatia, não automático.** Mesmo precedente de dual-flow do F4 (cron +
botão manual), mas o SOS entra só como botão: a tela do turno (`CompanyJobCandidates` ou equivalente) mostra
um CTA "🆘 Chamar fora do Elenco" **somente quando R8 é verdadeiro**, a empresa clica, confirma (modal com o
texto do alcance: "Isso vai notificar freelas de confiança fora do seu Elenco. Continuar?"), e só então
`create_sos_call` é chamado. **Automação (cron) fica fora de escopo nesta fatia** — abrir o grafo
automaticamente, sem um humano decidir "sim, preciso disto agora", é o tipo de decisão que a Constitution
pede para não ser tomada silenciosamente (Article 12 — nada acontece sem ação de sessão autenticada
explícita nas rotas sensíveis; aqui por analogia de princípio, não texto literal).

### Anti-abuso — impedir que "urgente" vire o canal padrão

**R10 — Cota dura por empresa: no máximo 1 SOS aberto simultaneamente por empresa, e no máximo 3 SOS por
empresa a cada 7 dias corridos.** Enforced na própria RPC `create_sos_call` (COUNT sobre
`shift_calls WHERE company_id = ... AND origin = 'sos' AND created_at > now() - interval '7 days'`), não só
no client — client-side seria contornável. RPC retorna `outcome = 'quota_exceeded'` quando estourar, sem
criar a linha. **Isto é o requisito que impede o modelo fechado morrer por uso**: sem cota, toda empresa
declara "urgente" sempre e o SOS vira o F1 disfarçado, corroendo a proposta "gente próxima ou que já
trabalhou" citada pelo entrevistado.

**R11 — Cota dura por freela alcançado: no máximo 2 SOS recebidos (de empresas fora do elenco dele) por
semana.** Enforced no cálculo do pool dentro de `create_sos_call` (exclui do pool quem já recebeu 2
`shift_call_targets` com `origin='sos'` nos últimos 7 dias, independente de empresa). Protege o freela de
virar alvo de spam de urgência só porque tem bom rating e está numa cidade concorrida — o problema de "ruído
que faz o freela parar de abrir o app" já identificado pelo F7 se aplica com mais força aqui.

**R12 — Notificação ao freela é clara sobre a natureza excepcional.** Título distinto de convite normal:
"Chamado de urgência — [nome da empresa]" (não usa o texto genérico de convite de elenco), corpo explicita
"Você não está no Elenco desta empresa; recebeu este chamado porque tem boa reputação e está perto." Isso
cumpre o consentimento informado (R4) na prática — o freela sabe exatamente por que está recebendo aquilo,
reforçando que ele pode desativar (`discoverable_for_sos = false`) a qualquer momento em `Profile.tsx`.

**R13 — Aceite de SOS convida à conexão de elenco, não obriga.** Ao aceitar um SOS (`claim_shift_slot`
normal, sem mudança de RPC — R5), o `applications` criado segue as regras de push já existentes (sem reserva
de escrow, mesmo trigger do F1). Opcionalmente (nesta fatia, como notificação apenas, não como fluxo
obrigatório) a empresa pode convidar o freela ao Elenco depois — mas o SOS **não** cria `team_connections`
automaticamente. Isso preserva a semântica de F1 ("elenco é aceite explícito bilateral", `architecture.md`
Slice 1) e evita que o SOS vire porta dos fundos para popular o elenco sem handshake.

### Types & UI

**R14 — `types/index.ts`.** `ShiftCall` (se já tipado pelo F1) ganha `origin: 'team' | 'sos'`. `WorkerProfile`
ganha `discoverable_for_sos?: boolean`. Builder reconfirma estado real do arquivo antes de editar (mesma nota
de higiene já usada por F7/F5).

**R15 — Selo de origem na tela de candidatos/turno.** Quando um `application` vier de um `shift_call` com
`origin='sos'`, um selo discreto ("via SOS") distingue de quem veio do elenco normal — útil para a empresa
entender de onde veio a contratação, sem revelar mais dado do freela do que R3 permite.

---

## Acceptance criteria

- [ ] A1 (elegibilidade de urgência — botão aparece): Dado um turno com `start_date` a 2 horas do agora,
      `slots` não totalmente preenchidos, e um `shift_calls` de `origin='team'` já `expired`/todo-recusado,
      quando a empresa abre a tela do turno, então o CTA "Chamar fora do Elenco" aparece.
- [ ] A2 (botão NÃO aparece fora da janela): Dado o mesmo turno, mas com `start_date` a 8 horas do agora,
      quando a empresa abre a tela, então o CTA não aparece (R8 falha na condição de 4h).
- [ ] A3 (pool respeita opt-in): Dado um freela X com `discoverable_for_sos=true`, `completed_jobs_count=5`,
      `rating_average=4.5`, mesma cidade da empresa, e um freela Y idêntico exceto
      `discoverable_for_sos=false`, quando `create_sos_call` roda, então X é incluído no pool de alvos e Y
      não é, mesmo sendo elegível em todos os outros critérios.
- [ ] A4 (corte de qualidade): Dado um freela Z com `discoverable_for_sos=true`, mesma cidade, mas
      `completed_jobs_count=1` (abaixo do corte de 3), quando `create_sos_call` roda, então Z não é incluído
      no pool.
- [ ] A5 (veto de bloqueio respeitado fora do elenco): Dado um freela W com `discoverable_for_sos=true`,
      todos os cortes de qualidade satisfeitos, mas com `team_connections.status='blocked'` específico com a
      empresa que abre o SOS, quando `create_sos_call` roda, então W não é incluído no pool desta empresa
      (seria incluído no pool de outra empresa sem esse bloqueio).
- [ ] A6 (empresa nunca vê a lista antes do aceite): Dado um SOS criado com N alvos, quando a empresa consulta
      a tela do turno antes de qualquer aceite, então a resposta não inclui nomes/ids dos freelas alvo — só a
      contagem de notificados (R7, RPC `create_sos_call` retorna só `targets_count`).
- [ ] A7 (não vaza histórico de terceiro): Dado um freela alcançado via SOS que trabalhou recentemente para a
      Empresa B, quando a Empresa A (que abriu o SOS) recebe a notificação de aceite, então nenhuma
      informação sobre "trabalhou para Empresa B" aparece em nenhuma tela ou payload acessível à Empresa A.
- [ ] A8 (cota por empresa — SOS simultâneo): Dado uma empresa com um `shift_calls` `origin='sos'` já
      `status='open'`, quando ela tenta abrir um segundo SOS (outro turno), então `create_sos_call` retorna
      `outcome='quota_exceeded'` e nenhuma linha nova é criada.
- [ ] A9 (cota por empresa — 7 dias): Dado uma empresa que já abriu 3 SOS nos últimos 7 dias corridos (todos
      já fechados/expirados), quando ela tenta abrir um 4º, então `create_sos_call` retorna
      `outcome='quota_exceeded'`.
- [ ] A10 (cota por freela — 2 por semana): Dado um freela que já recebeu 2 `shift_call_targets` com
      `origin='sos'` de empresas distintas nos últimos 7 dias, quando uma terceira empresa dispara um SOS que
      o incluiria pelo pool, então ele é excluído do cálculo do pool para essa terceira chamada.
- [ ] A11 (aceite de SOS não cria vínculo de elenco automaticamente): Dado um freela que aceita um
      `shift_calls` `origin='sos'` via `claim_shift_slot`, quando a transição é concluída, então `applications`
      é criado normalmente (`status='hired'`) e NENHUMA linha é inserida em `team_connections` como efeito
      colateral.
- [ ] A12 (reuso de métrica): Dado um SOS aceito, quando o BI de tempo-de-preenchimento consulta
      `first_claim_at - created_at`, então o SOS aparece com o mesmo cálculo que um chamado `origin='team'`,
      sem tabela/coluna paralela.
- [ ] A13 (notificação diferenciada): Dado um freela alcançado via SOS, quando recebe a notificação, então o
      título é "Chamado de urgência — [empresa]" (não o texto genérico de convite de elenco) e o corpo
      explicita que ele não está no Elenco daquela empresa.
- [ ] A14 (opt-out efetivo e imediato): Dado um freela com `discoverable_for_sos=true` que desativa o toggle
      em `Profile.tsx`, quando qualquer empresa dispara um SOS depois dessa mudança, então ele não é incluído
      no pool (nenhum cache/atraso de propagação).
- [ ] A15 (toggle só oferecido após F7): Dado um freela sem nenhuma `availability_days` declarada (F7,
      `IS NULL`), quando ele abre `Profile.tsx`, então o toggle de descoberta SOS não é exibido (ou aparece
      desabilitado com explicação) — gancho R4 respeitado.

---

## Out-of-scope

- Geolocalização contínua/lat-long de freela — LGPD pesada, decisão grande própria, fora desta fatia (R1).
  Proximidade é só `city` textual.
- Score/ranking contínuo de "quem provavelmente aceita" — citado como feature futura pelo próprio F7; esta
  fatia entrega corte binário elegível/não-elegível (R2), não pontuação.
- Distância em km/raio geográfico — sem coordenadas, não há como calcular; mesma cidade é o proxy nesta fatia.
- Disparo automático via cron — só botão explícito (R9). Automação fica para uma fatia futura, se o piloto
  validar que o botão manual é insuficiente.
- Ajuste de corte de qualidade por empresa (slider de rating mínimo, etc.) — corte fixo e único (R2), para não
  virar vetor de erosão do modelo fechado.
- Ajuste de janela de urgência (as 4 horas) por empresa — fixo nesta fatia (R8).
- Criação automática de `team_connections` a partir do aceite de SOS — aceite gera só `applications`, elenco
  continua sendo handshake explícito e separado (R13).
- Exibir a lista de alvos do SOS à empresa antes do aceite — nunca, em nenhuma fatia futura sem novo ADR (R6/A6).
- SOS para fora da rede Worki (indicação de terceiros, cadastro no ato) — o pool é estritamente sobre workers
  já cadastrados com opt-in; não há convite a quem nunca usou o app.

---

## Suposições

- **`companies.city` existe e é preenchido** (migration `20260317140000`) — usado como termo de comparação de
  R1. Se a maioria das empresas não preencheu esse campo no onboarding, o SOS fica sem alvo utilizável até
  isso ser corrigido (impacto: feature parece "quebrada" por dado ausente, não por bug).
- **`workers.rating_average`/`reviews_count`/`completed_jobs_count` já são confiáveis** via
  `recompute_worker_aggregates` (Slice 4) — nenhuma recomputação nova necessária para R2.
- **Limiar de 4 horas (R8) e cotas (R10/R11) são chutes calibráveis**, não números validados com dado real de
  piloto — assumidos para dar um primeiro corte testável; ajustar depois de observar uso real é esperado e
  barato (constantes, não redesenho de schema).
- **F7 (`availability_days`) já está em produção quando F11 for construído** — R4 depende do gancho de UX
  "só oferece o toggle depois de declarar disponibilidade". Se F7 ainda não estiver mergeado, o toggle SOS
  pode ser oferecido sem essa condição como fallback temporário (degradação aceitável, não bloqueante).
- **Não há necessidade de índice novo em `workers.city`/`companies.city`** nesta fatia — volume do piloto
  (10 unidades) é pequeno o suficiente para seq scan; se o pool crescer, isso é ajuste de índice, não de
  modelo.

---

## Questões abertas (não travam a spec — decisão humana/architect)

- **A cota de R10 (1 simultâneo / 3 por semana) e R11 (2 por freela/semana) são os números certos?** São
  chutes de primeira fatia — o piloto (10 unidades Divino Fogão) deveria validar isso rápido; o
  architect pode preferir tornar configurável via tabela de config em vez de constante na RPC.
- **O corte de qualidade (R2: `completed_jobs_count >= 3` + rating `>= 4.0`) deveria ser diferente por tipo de
  vaga** (ex.: cozinha vs. limpeza têm risco/complexidade diferentes)? Não assumido nesta fatia — corte único
  cross-categoria.
- **Deveria existir uma trilha de auditoria/relatório de SOS separado do BI de F1** (ex.: "quantos turnos só
  foram preenchidos via SOS" como métrica de saúde do elenco, sinal de que a empresa está sub-recrutando)?
  Não especificado — pode ser extensão barata de R6 (`origin` já permite o filtro) numa fatia de BI futura.
- **Quando o freela aceita um SOS mas nunca vira parte do elenco (R13), deveria haver algum CTA pós-turno
  sugerindo à empresa "convide este freela para o Elenco"?** Ponto de produto, não técnico — decidir depois
  de ver comportamento real no piloto.
- **Vale a pena, numa fatia futura, abrir geolocalização pontual (não contínua) só no momento do SOS** (ex.:
  freela compartilha localização uma vez, ao responder ao chamado, para a empresa avaliar "quão perto ele
  está agora")? Fora de escopo aqui por ser LGPD mais pesada — decisão de produto explícita, precisa de ADR
  próprio se cogitada.
- **O texto/consentimento do toggle SOS deveria passar por revisão jurídica/LGPD antes do piloto**, dado que
  ainda que opt-in, é o primeiro mecanismo do produto que expõe dado de um freela a uma empresa SEM vínculo
  prévio nenhum (mesmo que mínimo: nome, foto, cidade, rating)? Recomendado, não bloqueante para a spec.

---

## Clarifications log

- Q: Proximidade de quê (turno, freela, empresa)? → A (Assumido): `workers.city` × `companies.city`, sem
  geolocalização contínua (não existe no schema hoje; adicionar é decisão grande de LGPD, fora de escopo) —
  R1.
- Q: O que é "qualidade suficiente"? → A (Assumido): corte objetivo fixo sobre sinais já materializados
  (`completed_jobs_count >= 3`, `rating_average >= 4.0` OU sem reviews) — R2. Não é score ajustável por
  empresa, para não virar vetor de erosão do modelo fechado.
- Q: Como evitar vazar para quem a empresa "trabalhou por ali recente" sem revelar a relação com terceiros? →
  A (Assumido): o sinal exposto é agregado (contagem + cidade), nunca lista de empresas anteriores; a RPC
  `create_sos_call` calcula o pool internamente e nunca devolve a lista de alvos à empresa antes do aceite —
  R3/R6/R7/A6/A7.
- Q: Consentimento do freela — opt-in, opt-out, ou sempre? → A (Assumido): opt-in explícito
  (`discoverable_for_sos`), ancorado no gesto de já ter declarado disponibilidade (F7) como pré-requisito de
  UX — R4/A14/A15.
- Q: O que caracteriza "urgência" verificável? → A (Assumido): três condições objetivas (chamado ao elenco
  esgotado + turno em <4h + vaga aberta) — R8. Disparo é botão explícito, não cron (R9); automação fica para
  fatia futura, mesmo padrão dual-flow do F4 mas SOS começa manual por ser a decisão mais sensível de todas.
- Q: SOS deve ser `shift_calls` ampliado ou tabela nova? → A (Assumido): reusa `shift_calls`/
  `shift_call_targets` com coluna `origin` — preserva a métrica `first_claim_at` e o histórico unificado que
  é a razão de existir dessas tabelas (R5/R6/A12), evita fragmentar a lógica de `claim_shift_slot`.
- Q: Como impedir que "urgente" vire o canal padrão? → A (Assumido): cota dura por empresa (1 simultâneo, 3
  por semana) e por freela (2 recebidos por semana), enforced na RPC, não no client (R10/R11/A8/A9/A10) —
  números são chutes de primeira fatia, marcados em "Questões abertas" para validação com o piloto.
