# Guarda de Risco de Vínculo Trabalhista — spec

> Feature F5 do backlog pós-entrevista Divino Fogão (17/08/2026). Slug: `guarda-vinculo`.
> Tipo: feature (M). Todas as decisões de escopo abaixo foram fixadas pelo clarifier sem
> confirmação humana, por instrução explícita da tarefa — cada uma está marcada **(Assumido)** e
> justificada em "Clarifications log". Nenhum arquivo foi editado por este agente (só leitura);
> outros agentes estão tocando `job_series`/F3 e F4 em paralelo — o builder que pegar esta spec
> **precisa reconferir** `frontend/src/types/index.ts`, `ShiftCallModal.tsx` e o estado real das
> migrations `job_series`/F4 antes de editar, e reler a seção "Interação com F3" abaixo.

---

## Context

### A fala, literal

Sócio-operador de 10 unidades do Divino Fogão, 17/08/2026:

> "A gente tem um cuidado de nunca superar o mesmo freelancer trabalhando na loja mais de duas
> vezes por semana, para evitar a geração do vínculo trabalhista eventual. Menos do que isso não
> há geração de vínculo trabalhista."
>
> "Uma grande preocupação que todos os empresários que trabalham com freelancer têm é do risco
> trabalhista. [...] Isso é bem importante."

### Decisão de produto já tomada pelo owner

O limite é **configurável por empresa** (2, 4, o que fizer sentido pro negócio dela) e o sistema
**AVISA, não bloqueia** — nas palavras do owner: "a quantidade de vezes que ela quer que o sistema
avise ela do mesmo freela para risco de vínculo". Bloquear seria o Worki decidindo sobre risco
jurídico de terceiro, papel que a tese proíbe explicitamente (`.harness/thesis.md`, risco #4: "Worki
= conector/registro, nunca parte do contrato [...] nunca se vender como CLT/empregador"). Avisar é
devolver ao gerente uma informação que hoje ele só carrega de cabeça — e que ele mesmo pediu.

### Por que isto é F5, e não outra coisa

O F3 (Escala Recorrente, `escala-recorrente/spec.md`) já **sinalizou o gancho** desta feature no
R10, ao descrever "Convidar [freela] para a série inteira": *"Sinalização de interação com a guarda
futura de 2 turnos/semana (feature seguinte da fila, fora de escopo aqui) [...] MESMA semana corrida
(dom–sáb)"*. Este spec É essa feature seguinte, e herda a convenção de semana (dom–sáb) que o F3 já
adotou — trocar essa convenção agora quebraria a consistência que o próprio F3 já assumiu como
publicamente conhecida entre as specs.

O ponto de integração natural é o **`ShiftCallModal`** (F1) — é onde a empresa seleciona quem
chamar, ANTES do disparo, e é o único componente usado pelos 4 pontos de convite hoje
(`CompanyCreateJob`, `CompanyJobs`, `CompanyTeam`, `CompanyJobCandidates` — confirmado por leitura
direta: todos importam `ShiftCallModal` de `components/team/ShiftCallModal.tsx`). Um único ponto de
integração cobre chamado 1→N e convite individual (que hoje é um chamado de 1 alvo só —
`ShiftInviteService.inviteWorkerToShift` delega em `ShiftCallService.createShiftCall`).

---

## Requirements

**R1 — Configuração por empresa (nova migration).**
`companies` ganha 2 colunas nullable-safe (default aplicado, sem quebrar linhas existentes):
- `link_risk_alert_enabled boolean NOT NULL DEFAULT true`
- `link_risk_alert_threshold integer NOT NULL DEFAULT 2 CHECK (link_risk_alert_threshold >= 1)`

Nenhuma tabela financeira é tocada; nenhuma RPC de saldo é criada (Article 8 intacto). A migration
em si aciona o gate automático do pipeline (`supabase/migrations/**` → architect + security-reviewer),
mesmo sem RPC — trata-se de coluna nova em tabela existente com RLS já ativa.

**R2 — O que conta como "uma vez".**
Só `applications.status IN ('hired', 'in_progress', 'completed')` contam. `invited` (convite ainda
pendente, pode expirar ou perder a corrida do F1), `declined` e `cancelled` **não contam**. É o
MESMO conjunto de status já usado como "vaga ocupada" em `claim_shift_slot`
(`20260817000200_shift_call_rpcs.sql`) — reaproveita um conceito já estabelecido no schema, não
inventa um novo.

**R3 — Janela: semana corrida domingo–sábado, em data LOCAL.**
A semana de referência é a que contém `job.start_date` do turno-alvo (o turno para o qual a empresa
está chamando/convidando agora) — não "a semana de hoje". Cálculo em data LOCAL, nunca UTC puro
(mesmo padrão de `lib/dateUtils.ts` — `parseDateOnly`/`todayLocalDate`, que já documentam o bug
histórico de off-by-one perto da meia-noite em BRT). `lib/dateUtils.ts` ganha uma função nova pura
`getWeekBoundsSundayToSaturday(dateOnly: string): { weekStart: string; weekEnd: string }` (formato
`YYYY-MM-DD`), construída sobre `parseDateOnly`.

**R4 — Contagem prospectiva, não retrospectiva.**
No momento do disparo, a application do turno-alvo AINDA NÃO EXISTE (só nasce quando o freela
aceita — R4 de `chamado-de-turno/spec.md`). O número mostrado é `contagem_existente_na_semana + 1`
(o +1 representa o próprio chamado em curso) comparado ao limite. Regra: avisa quando
`contagem_existente + 1 > threshold` — ou seja, com `threshold=2`, o aviso aparece a partir da
**3ª vez** (2 vezes/semana continua silencioso, espelhando "menos do que isso não há geração" da
entrevista).

**R5 — Uma query agregada, não N.**
`ShiftCallModal` calcula a contagem para TODOS os membros visíveis do elenco numa única consulta
(join `applications` → `jobs`, filtrando `company_id`, `worker_id IN (...)`, status do R2, janela do
R3), agregada em `Map<worker_id, count>` no client — não uma query por membro. Não é uma RPC nova:
é uma leitura simples sob a RLS já existente de `applications`/`jobs` (Article 5 — `useState`/
`useEffect` direto), disparada no MESMO `useEffect` que já busca `listTeamMembers`/`listLists`
(`Promise.all`), como leitura adicional, não uma chamada extra separada. Se
`link_risk_alert_enabled=false` para a empresa, a query nem dispara.

**R6 — Onde o aviso aparece: `ShiftCallModal`, e só ali (nesta fatia).**
1. **Por membro:** um selo curto e não-bloqueante ao lado do nome (mesma linguagem visual do aviso
   amarelo já existente de "vagas incompletas" no rodapé — `AlertTriangle`, `text-yellow-700
   bg-yellow-50 border-yellow-300`), visível para membros SELECIONADOS cuja contagem prospectiva
   ultrapasse o limite. Texto do selo: `"Já {N}x esta semana"` onde N = contagem prospectiva.
2. **Banner de rodapé:** só aparece se pelo menos 1 membro selecionado estiver marcado, posicionado
   acima do botão de disparo (mesma área do aviso de vagas incompletas — os dois podem coexistir).
   Nunca desabilita o botão de disparo, nunca exige confirmação extra.

**R7 — Texto: fato, não parecer jurídico.**

> QUALIFICADOR DE ESCOPO acrescentado em 21/08/2026 (achado `C-RISK-SCOPE-HONESTY` do evaluator).
> A redacao original dizia apenas "Já {N}x esta semana". A contagem, porem, cobre **somente turnos
> desta empresa** — a RPC filtra por `is_job_owner`, e isso esta correto: contar entre empresas
> vazaria relacao comercial de terceiros, e risco de vinculo e por empregador, entao o numero
> por empresa e justamente a metrica decisoria certa.
>
> O defeito estava no rotulo, nao no numero: "3x esta semana" e lido pelo gerente como a semana do
> freela, quando e a semana dele COM AQUELA EMPRESA. Um numero parcial lido como total da falsa
> seguranca exatamente na decisao que o aviso existe para informar. Todas as quatro superficies
> (selo, banner, chip da serie, texto de configuracao) passam a declarar o escopo.
O texto NUNCA afirma que a frequência "gera vínculo" (afirmação jurídica que a tese proíbe) e NUNCA
posiciona o Worki como proteção trabalhista/CLT. Só informa o fato numérico e devolve a decisão à
empresa. Copy fixado:

- Selo por membro: `"Já {N}x esta semana com você"`
- Banner: `"Atenção: {lista de nomes} já teria(m) {N}ª vez confirmada em turnos da sua empresa nesta semana (dom–sáb) com
  este chamado. Sua empresa configurou o aviso a partir de {threshold}x/semana. A decisão de chamar
  é sua — consulte seu contador/jurídico se tiver dúvida sobre frequência e risco de vínculo."`

**R8 — Configuração vive em `CompanyProfile.tsx`.**
Mesma tela onde `default_briefing` já é editado (`companies.default_briefing`, migration
`20260710000100`) — segue o padrão local de `Company` interface + `editableFields` já existente
nessa página. Novo bloco (ex.: seção "Preferências"):
- Toggle `"Avisar sobre frequência do mesmo freela"` (default ligado).
- Campo numérico `"Avisar a partir de quantas vezes por semana"` (default 2, mínimo 1, inteiro —
  reflete `CHECK (>= 1)` do R1). Some/desabilita quando o toggle está desligado.

**R9 — Escopo do contador: por empresa inteira (não por loja).**
`link_risk_alert_threshold`/`_enabled` são colunas de `companies`, contando TODOS os turnos da
empresa com aquele freela na semana — não por unidade/loja. O produto não tem multi-unidade hoje
(nenhuma tabela `stores`/`units`); quando existir, o contador precisará migrar para
`company_id + unit_id`, na mesma costura que `is_job_owner` (F1) já deixou preparada para gerente/
unidade — não implementado aqui.

**R10 — Interação obrigatória com F3 (Escala Recorrente).**
`escala-recorrente/spec.md` R10 já descreve uma sinalização própria ("mais de 2 ocorrências na MESMA
semana corrida") para o atalho "Convidar [freela] para a série inteira". Se o F3 for mesclado ANTES
desta feature com esse "2" fixo no código, o builder desta feature **precisa refatorar aquele ponto**
para consumir a MESMA função de contagem/limite configurável desta spec (R2–R5), em vez de manter
duas implementações de contagem divergentes (uma fixa, uma configurável) — checar
`job_series`/`ShiftCallModal`/o call site do "convidar série inteira" antes de implementar, já que
outro agente pode estar mexendo nisso agora.

**R11 — `types/index.ts`.**
`Company` (tipo de domínio) ganha `link_risk_alert_enabled?: boolean` e
`link_risk_alert_threshold?: number`. **Builder: reconfirme o estado atual do arquivo antes de
editar — pode ter mudado sob os pés (F3/F4 em paralelo).**

**R12 — Zero impacto financeiro.**
Nenhuma RPC de saldo/escrow criada ou tocada; nenhuma tabela `wallets`/`escrow_transactions`/
`shift_payments` lida ou escrita por esta feature (Article 8 intacto).

**R13 — RLS.**
As duas colunas novas de `companies` seguem a policy de UPDATE já existente da tabela (ancorada em
`owner_id = auth.uid()`, mesmo padrão de `default_briefing`) — sem policy nova necessária. Leitura
da contagem (R5) segue a RLS já ativa de `applications`/`jobs` (nenhuma policy nova).

---

## Acceptance criteria

- [ ] A1 (aviso básico): Dado `link_risk_alert_threshold=2` para a empresa e o freela X com 2
      `applications` `status='hired'` cujo `job.start_date` cai na mesma semana dom–sáb do
      turno-alvo, quando a empresa abre o `ShiftCallModal` desse turno e seleciona X, então aparece
      o selo `"Já 3x esta semana"` ao lado do nome de X e o banner de aviso no rodapé — o botão de
      disparo continua habilitado.
- [ ] A2 (dentro do limite, sem aviso): Dado o mesmo limite=2 e o freela Y com 1 `application`
      `hired` na semana do turno-alvo, quando a empresa seleciona Y, então nenhum selo/banner
      aparece para Y (1 existente + 1 deste chamado = 2, não ultrapassa 2).
- [ ] A3 (status irrelevantes não contam): Dado o freela Z com 3 `applications` na mesma semana,
      sendo 2 `invited` e 1 `declined` (nenhuma `hired`/`in_progress`/`completed`), quando a empresa
      seleciona Z para o turno-alvo (limite=2), então nenhum aviso aparece (contagem real = 0).
- [ ] A4 (limite configurável): Dado que a empresa mudou `link_risk_alert_threshold` para 4 em
      `CompanyProfile`, quando um freela com 3 confirmados na semana é selecionado, então nenhum
      aviso aparece (3+1=4); selecionando-o para um 5º turno da mesma semana, o aviso aparece.
- [ ] A5 (desligado): Dado `link_risk_alert_enabled=false` para a empresa, quando o `ShiftCallModal`
      abre com um freela que estouraria qualquer limite, então nenhuma query de contagem é
      disparada e nenhum selo/banner aparece.
- [ ] A6 (semana dom–sáb, fuso local): Dado um turno-alvo com `start_date` numa quarta-feira, quando
      `getWeekBoundsSundayToSaturday` calcula a janela, então o resultado é `[domingo anterior,
      sábado seguinte]` em data LOCAL — testável isoladamente (Vitest) com casos entre 21h–23h59
      horário de Brasília, sem depender de `new Date(isoString)` cru.
- [ ] A7 (nunca bloqueia): Dado qualquer configuração de limite e qualquer contagem, quando a
      empresa clica "Chamar N freelas"/"Enviar convite" com membros marcados, então
      `ShiftCallService.createShiftCall` é chamado e o disparo prossegue normalmente — o aviso não
      desabilita o botão nem exige confirmação extra.
- [ ] A8 (RLS não regride): Dado que a empresa B tenta alterar `link_risk_alert_threshold` da
      empresa A via payload manipulado, quando a mutação roda sob a sessão de B, então a policy de
      UPDATE de `companies` (ancorada em `owner_id`) nega — 0 linhas afetadas, sem exceção nova.
- [ ] A9 (uma query, não N): Dado um elenco com 20 membros, quando o `ShiftCallModal` abre com
      `link_risk_alert_enabled=true`, então exatamente 1 query adicional agregada é disparada para
      calcular as contagens de risco de todos os 20 — não 20 chamadas individuais (verificável por
      contagem de chamadas de rede em teste/Playwright, ou por inspeção do código).
- [ ] A10 (copy sem parecer jurídico): O texto do banner (R7) NUNCA contém as frases "gera vínculo",
      "é ilegal" ou qualquer variação que declare uma conclusão jurídica — só o fato numérico e a
      frase de responsabilidade devolvida à empresa (checável por review de string/snapshot test).

---

## Out-of-scope

- Bloqueio duro do envio — decisão explícita do owner: o sistema **nunca** impede o disparo por
  causa deste limite.
- Multi-unidade/gerente (contador por loja) — contador é por empresa inteira nesta fatia (R9).
- Aviso replicado em `CompanyTeam` (card do freela no Elenco), em relatório mensal/BI dedicado, ou
  como notificação push separada — só o ponto de disparo (`ShiftCallModal`) nesta fatia. Se um
  ponto de convite direto existir bypassando `ShiftCallModal` (chamada direta a
  `ShiftInviteService.inviteWorkerToShift` fora do componente), não está coberto aqui — auditar
  separadamente se for encontrado durante a implementação.
- Qualquer texto/copy que declare conclusão jurídica ("isto gera vínculo", "isto é ilegal") ou que
  posicione o Worki como proteção trabalhista/CLT — proibido pela tese, reforçado em R7/A10.
- Contagem por presença real (`hasAttendedShift`) em vez de status de confirmação — usa
  `hired`/`in_progress`/`completed` (R2), não os 3 sinais de comparecimento.
- Editar a lógica de recorrência do F3 além do necessário para reaproveitar a contagem (R10) — não
  se reabre o escopo de `escala-recorrente/spec.md`.
- Notificação assíncrona (ex.: "resumo semanal de concentração por e-mail") — só o aviso síncrono no
  momento do disparo.

---

## Clarifications log

- Q: O que conta como "uma vez"? → A (Assumido): `applications.status IN ('hired', 'in_progress',
  'completed')`. Reaproveita o MESMO conjunto de status já usado para "vaga ocupada" em
  `claim_shift_slot` (`20260817000200_shift_call_rpcs.sql`) — não é uma definição nova, é a que o
  schema já trata como "confirmado". `invited` fica de fora de propósito: um chamado do F1 dispara
  para N alvos e só 1 ganha — contar `invited` infarmaria o aviso para todo mundo que só RECEBEU o
  chamado, não que efetivamente vai trabalhar.
- Q: Qual é a semana? → A (Assumido): domingo–sábado, data local. Não é arbitrário: o F3
  (`escala-recorrente/spec.md`, R10) já usou essa convenção ao sinalizar esta MESMA feature
  ("MESMA semana corrida (dom–sáb) da série") — mudar agora criaria duas convenções de semana
  concorrentes entre specs irmãs.
- Q: Onde o aviso aparece? → A (Assumido): só `ShiftCallModal` (F1), que é usado pelos 4 pontos de
  convite hoje (confirmado por leitura de `CompanyJobCandidates.tsx`, `CompanyJobs`, `CompanyTeam`,
  `CompanyCreateJob` — todos importam o mesmo componente). Um ponto de integração cobre chamado 1→N
  e convite individual (que já é internamente um chamado de 1 alvo). Elenco/relatório ficam de fora
  desta fatia por custo/benefício — o "gesto central" citado na origem é o disparo, não a listagem.
- Q: Qual o texto? → A (Assumido): fato numérico + config + devolução da decisão, nunca conclusão
  jurídica nem "CLT"/proteção trabalhista — ver R7/A10, direto da restrição da tese
  (`.harness/thesis.md` risco #4: "Posicionamento: nunca se vender como CLT/empregador").
- Q: Onde mora a configuração, qual o default, como se desliga? → A (Assumido): `companies.
  link_risk_alert_enabled` (default `true`) + `link_risk_alert_threshold` (default `2`, mesmo
  número da entrevista — é o valor mais conservador citado, empresas que preferem mais folga
  ajustam para 4+). Editável em `CompanyProfile.tsx`, mesma tela/padrão de `default_briefing`.
  Desligar = toggle `link_risk_alert_enabled=false`, sem apagar o threshold configurado (permite
  religar sem reconfigurar o número).
- Q: Escopo do contador — por empresa ou por loja? → A (Assumido): por empresa inteira (R9); o
  produto não tem multi-unidade hoje. Sinalizado para quando existir, sem implementar.
- Q: Custo de leitura — 20 membros no `ShiftCallModal` sem travar a tela às 8h30? → A (Assumido):
  uma única query agregada (join `applications`→`jobs`, filtro por `worker_id IN (...)` + semana),
  agregada em `Map` no client, disparada no `Promise.all` que já existe no `useEffect` de
  carregamento do modal — sem RPC nova (não é operação privilegiada nem financeira; leitura simples
  sob RLS já ativa cobre o caso, Article 5). Evita 20 round-trips e evita abrir superfície
  `SECURITY DEFINER` desnecessária.
