# F10 — Indicação de freela entre empresas — spec

> Nome de produto proposto: **"Indicação"** (não "troca", não "empréstimo", não "transferência").
> Vocabulário é requisito, não estética: a UI e todo texto (toasts, notificações, nomes de RPC/tabela)
> devem usar "indicar" / "indicação" / "indicado por". Nunca "emprestar", "ceder", "transferir" ou
> "repassar" um freela — essas palavras afirmam que a pessoa é um ativo que se move entre empresas
> por vontade delas, o que contradiz o modelo de consentimento que sustenta `team_connections`
> (Slice 1) e a guarda de veto indelével da migração `20260816000000`.

## Suposições

> Nenhuma delas foi confirmada pelo humano. Cada uma tem um "se errada" — o builder deve marcar no
> código/PR qualquer suposição que precisar revisitar.

1. **O "pedido" inicial (empresa A pede um freela a B) continua fora do app, como já acontece hoje
   (WhatsApp/telefone).** Esta spec só cobre o momento em que **B decide indicar** — que é o único
   passo com risco real de consentimento/dado pessoal. *Se errado:* precisaria de mensageria
   empresa↔empresa nova (hoje só existe worker↔empresa, `Messages`/`CompanyMessages`) — escopo XL,
   fora desta fatia (ver Out-of-scope).
2. **B identifica a empresa A por um identificador público** (Worki ID / CNPJ / telefone cadastrado),
   do mesmo jeito que hoje se identifica um worker por telefone para convite de equipe. *Se errado:*
   precisa de um mecanismo de busca/handshake diferente (ex.: A precisa ter contatado B antes por
   algum canal do app) — muda R2.
3. **Default de "posso ser indicado"**: **ligado** para todo freela, com opt-out explícito no perfil
   ("não quero ser indicado a outras empresas por quem já trabalho comigo"). Justificativa: a prática
   já ocorre hoje sem NENHUM consentimento (WhatsApp direto); esta feature adiciona consentimento
   explícito no momento decisivo (aceitar a conexão), o que já é estritamente mais protetor que o
   status quo. *Se errado (humano preferir opt-in):* inverte R3/R4 — troca 1 boolean de default, não
   muda a arquitetura.
4. **"B manda o perfil pelo app" = um cartão com projeção limitada de campos** (nome, foto, nota
   média, nº de avaliações, papel/especialidades) — NUNCA CPF, telefone, PIX, data de nascimento.
   Ancorado em `can_view_worker_profile`: A não tem vínculo com o freela, logo não pode ler a linha
   de `workers` — o cartão tem de vir de uma projeção nova, não de abrir a policy. *Se errado:* a
   intenção do humano era abrir mais dado (ex.: telefone) — isso reabriria a brecha que a migração
   `20260816120000` fechou; deveria virar ADR explícito, não decisão implícita do builder.
5. **Aceitar a indicação cria `team_connections(status='accepted')` diretamente** (não 'pending') —
   porque o consentimento explícito do freela (clicar "aceitar") já é o ato que hoje faz uma conexão
   virar 'accepted'; não há sentido em criar um 'pending' que precisaria de uma segunda aceitação.
   *Se errado:* trocar para 'pending' é mudança de uma linha na RPC, sem impacto estrutural.
6. **Uma indicação por vez por par (empresa-destino, freela)** enquanto estiver `awaiting_worker` —
   idempotência simples via índice único parcial, sem limite de indicações por período (anti-spam
   fica em Questões abertas).
7. **Nenhuma indicação sem elenco aceito**: B só pode indicar quem já está em `team_connections`
   `status='accepted'` com ela (é o "seu" elenco). Não faz sentido indicar alguém que nem aceitou
   trabalhar com B.

## Context

Divino Fogão (entrevista 17/08/2026) descreveu um comportamento **que já existe e não é digital**:
gerentes de unidades diferentes trocam freelas de confiança entre si por WhatsApp — "troca de
figurinha". A tese do produto não é inventar esse comportamento, é capturá-lo dentro do Worki, onde
ele pode ser auditado, e principalmente onde o **freela participa da decisão** em vez de ser passado
adiante como contato de agenda.

O risco de modelar mal isso é grande: o Worki inteiro se apoia no princípio de que o freela **não é
ativo da empresa** — `team_connections` só vira `accepted` por ação do freela, e o bloqueio dele
(`status='blocked'`) é **indelével para a empresa por design** (migração `20260816000000`, ADR
`ADR-20260816-veto-freela-imutavel-delete.md`). Uma feature de "empresa A pede, empresa B manda o
perfil" pode, se malfeita, virar transferência de pessoa entre controladores de dado sem base legal
do titular — exatamente o inverso do que sustenta o produto (Article 12 da constitution: toda rota
de acesso a dado de pessoa passa por consentimento e sessão válida; anti-vision do `product.md`:
o Worki não trata gente como recurso).

Esta spec resolve o nó com uma regra central: **B nunca entrega o freela a A. B apresenta o freela a
A, e só o "sim" do próprio freela cria a conexão.** Antes desse "sim", A vê uma vitrine mínima (nome,
foto, nota) — nunca o dado sensível que `can_view_worker_profile` já protege. O veto do freela contra
A (se existir) precisa ser respeitado mesmo quando a indicação vem de um caminho lateral (B), senão a
feature reabre exatamente a porta que a migração `20260816000000` fechou pela frente.

## Requirements

### Modelo de dados e autorização

- [ ] **R1**: Nova tabela `worker_referrals` (nome de coluna/tabela em português de domínio, sem usar
  "troca"/"transfer"): `(id uuid PK, worker_id uuid NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  referring_company_id uuid NOT NULL REFERENCES companies(id), requesting_company_id uuid NOT NULL
  REFERENCES companies(id), status text NOT NULL DEFAULT 'awaiting_worker' CHECK (status IN
  ('awaiting_worker','accepted','declined','cancelled','blocked_by_veto')), message text, created_at
  timestamptz NOT NULL DEFAULT now(), responded_at timestamptz, created_by uuid)`. CHECK
  `referring_company_id <> requesting_company_id`. Índice único parcial
  `(worker_id, requesting_company_id) WHERE status = 'awaiting_worker'` (uma indicação pendente por
  par, R6).
- [ ] **R2**: INSERT em `worker_referrals` só é permitido a quem é dono (`is_company_owner`) de
  `referring_company_id` **E** tem `team_connections(company_id=referring_company_id,
  worker_id=worker_id, status='accepted')` — B só indica quem está no próprio elenco aceito (R7).
  Validado via RPC `create_worker_referral(p_worker_id, p_requesting_company_id, p_message)`
  (SECURITY DEFINER, `search_path=''`), não via INSERT direto do client — a checagem de veto (R5/A3)
  precisa rodar atomicamente antes de gravar a linha.
- [ ] **R3**: A RPC `create_worker_referral` verifica, ANTES de criar a linha, se existe
  `team_connections(company_id=p_requesting_company_id, worker_id=p_worker_id, status='blocked')`
  com `blocked_by = worker_id` (veto do freela contra A). Se existir, a RPC **recusa a criação** com
  outcome `blocked_by_veto` — nem chega a notificar o freela, nem expõe o cartão a A. Resposta
  genérica para B (não confirma nem nega o motivo específico para não vazar histórico do freela com A).
- [ ] **R4**: A visualização do freela por A **antes do aceite** é uma projeção controlada, nunca a
  linha de `workers`. Nova função `get_worker_referral_card(p_referral_id uuid) RETURNS jsonb`
  (SECURITY DEFINER, `search_path=''`) devolve **somente**: `full_name` (ou nome público), `avatar_url`,
  `rating_average`, `reviews_count`, `primary_role`/especialidades. Autorização dentro da função:
  chamador precisa ser `is_company_owner(requesting_company_id)` do referral E o referral precisa
  existir com `status='awaiting_worker'`. **Nunca** inclui `cpf`, `phone`, `pix_key`, `birth_date`.
  A policy de SELECT de `workers` (`can_view_worker_profile`) **não muda** — a vitrine é uma função
  separada, não uma exceção na policy.
- [ ] **R5**: Freela vê a indicação pendente (própria tela — "quem te indicou"): nome/logo de B
  (empresa que indicou) e nome/logo de A (empresa que quer conectar), sem obrigação de aceitar.
  Aceite roda em `accept_worker_referral(p_referral_id)` (SECURITY DEFINER): valida
  `auth.uid() = worker_id` do referral, `status = 'awaiting_worker'`, then **INSERT
  `team_connections(company_id=requesting_company_id, worker_id, status='accepted',
  accepted_at=now())`** (ou UPDATE se já existir linha 'pending' antiga do mesmo par — reaproveita
  UNIQUE `(company_id, worker_id)`) e `UPDATE worker_referrals SET status='accepted',
  responded_at=now()`. Tudo em uma transação (RPC única).
- [ ] **R6**: Recusa é **neutra** (precedente `decline_shift_call`, F1): `decline_worker_referral
  (p_referral_id)` seta `status='declined'`. Notificação para B é neutra ("A indicação não avançou
  desta vez") — **não revela** se foi recusa explícita ou preferência geral do freela por não
  trabalhar com A. A não é notificado do motivo em nenhuma hipótese (A nem sabia da tentativa até
  aceite, ver R8).
- [ ] **R7**: Opt-out do freela — nova coluna `workers.accepts_referrals boolean NOT NULL DEFAULT true`
  (ver Suposição 3). `create_worker_referral` recusa com outcome `worker_opted_out` se `false`,
  mesma resposta neutra de R3 (não distinguir motivos para B).
- [ ] **R8**: A (empresa solicitante) **só é notificada quando o freela ACEITA** — nunca ao ser criada
  a indicação nem em caso de recusa detalhada. Antes do aceite, A vê apenas o cartão (R4) na tela de
  "Indicações recebidas" com status `awaiting_worker`. Isso evita que A monte um perfil de rejeição de
  um freela que nunca chegou a interagir com ela.
- [ ] **R9**: Freela SEMPRE é notificado quando indicado (trigger SECURITY DEFINER, mesmo padrão de
  `trg_notify_worker_on_attendance_request`/`notify_worker_on_shift_payment` — notificação à
  contraparte é garantia do produto, não cortesia de UI). Texto: "[Empresa B] indicou você para
  [Empresa A]. Quer se conectar?"
- [ ] **R10**: Depois do aceite (R5), a empresa A pode adicionar o freela a uma `team_lists` sua
  (F2, já existente) exatamente como qualquer outro membro de elenco aceito — nenhuma tabela/RPC nova
  para isso, é o fluxo padrão pós-`team_connections.accepted`.
- [ ] **R11**: `worker_referrals` tem RLS: SELECT para (a) o freela (`worker_id = auth.uid()`), (b)
  `is_company_owner(referring_company_id)`, (c) `is_company_owner(requesting_company_id)`. Sem policy
  de UPDATE/DELETE — toda transição passa pelas RPCs (mesmo padrão de `shift_calls`/
  `shift_call_targets`, F1). Nenhuma coluna sensível de worker vive nesta tabela — é seguro que A
  leia a própria linha (status/timestamps) direto pela tabela, sem passar pela RPC de cartão depois
  do aceite.
- [ ] **R12**: B pode cancelar uma indicação ainda `awaiting_worker` (`cancel_worker_referral`,
  SECURITY DEFINER, exige `is_company_owner(referring_company_id)` e status atual `awaiting_worker`
  → `cancelled`). Não notifica A (que nunca soube). Notifica o freela de forma neutra (indicação
  retirada).
- [ ] **R13**: Se já existe `team_connections(company_id=requesting_company_id, worker_id,
  status='accepted')` no momento da criação, a RPC recusa com outcome `already_connected` (não faz
  sentido indicar quem já está conectado a A).

### Papel & rota

- [ ] **R14**: Tela "Indicar para outra empresa" acessível a partir do card de membro do elenco em
  `pages/company/CompanyTeam` (ou equivalente atual de elenco) — papel empresa, sob
  `<ProtectedRoute requiredRole="company">`.
- [ ] **R15**: Tela "Indicações recebidas" (empresa, ver cartões `awaiting_worker`/`accepted`) nova
  rota em `pages/company/` — protegida, papel empresa.
- [ ] **R16**: Tela/seção "Quem te indicou" no lado do freela (aceitar/recusar) — `pages/` (worker),
  protegida, papel worker.
- [ ] **R17**: Opt-out de indicação (R7) fica em `pages/Profile` (worker) ou `WorkerOnboarding`,
  papel worker.

## Acceptance criteria

- [ ] **A1**: Dado que a empresa B tem o freela X em `team_connections.status='accepted'`, quando B
  abre o card de X no elenco e escolhe "Indicar para outra empresa", informa o identificador de A e
  confirma, então uma linha `worker_referrals(status='awaiting_worker')` é criada e o freela X recebe
  notificação "B indicou você para A. Quer se conectar?" — **e nenhuma notificação chega a A**.
- [ ] **A2**: Dado que X tem `team_connections(company_id=A, status='blocked', blocked_by=X)`, quando
  B tenta indicar X para A, então `create_worker_referral` retorna outcome `blocked_by_veto`, nenhuma
  linha é criada em `worker_referrals`, X não é notificado, e B vê mensagem genérica
  ("não foi possível concluir a indicação") sem detalhe do motivo.
- [ ] **A3**: Dado um `worker_referrals(status='awaiting_worker')` para (X, A), quando a empresa A
  abre "Indicações recebidas" antes do aceite, então ela vê apenas `full_name`, `avatar_url`,
  `rating_average`, `reviews_count`, `primary_role` de X (via `get_worker_referral_card`) — uma
  chamada direta `supabase.from('workers').select('*').eq('id', X)` continua retornando 0 linhas para
  A (policy `can_view_worker_profile` inalterada).
- [ ] **A4**: Dado que X abre "Quem te indicou" e clica "Aceitar", então `team_connections(company_id=A,
  worker_id=X, status='accepted')` passa a existir, `worker_referrals.status` vira `'accepted'`, A
  recebe notificação de aceite pela primeira vez, e a partir desse momento A consegue
  `supabase.from('workers').select('*').eq('id', X)` normalmente (vínculo de elenco válido).
- [ ] **A5**: Dado que X clica "Recusar", então `worker_referrals.status` vira `'declined'`, B recebe
  notificação neutra ("a indicação não avançou desta vez", sem culpar ninguém), e A nunca chega a
  saber que a tentativa existiu.
- [ ] **A6**: Dado que `workers.accepts_referrals = false` para X, quando B tenta indicar X, então a
  RPC recusa com outcome `worker_opted_out` (mesma mensagem genérica de A2 para B), e X não recebe
  notificação de indicação nenhuma.
- [ ] **A7**: Dado um `worker_referrals(status='awaiting_worker')` já existente para (X, A), quando B
  tenta criar uma segunda indicação de X para A, então a RPC recusa por violar o índice único parcial
  (outcome `already_pending`), sem duplicar linha.
- [ ] **A8**: Dado que X já tem `team_connections(company_id=A, status='accepted')`, quando B tenta
  indicar X para A, então a RPC recusa com outcome `already_connected`.
- [ ] **A9**: Dado um `worker_referrals(status='awaiting_worker')` criado por B, quando B clica
  "Cancelar indicação" antes do aceite, então o status vira `'cancelled'`, X recebe notificação neutra
  de retirada, e A (que nunca viu nada) permanece sem qualquer registro visível.

## Out-of-scope

- Mensageria empresa↔empresa dentro do app (o "pedido" inicial de A a B continua fora do app, ex.
  WhatsApp — Suposição 1).
- Qualquer algoritmo de recomendação/match "inteligente" de qual freela indicar (a fala do sócio
  menciona "torna inteligente" como visão de médio prazo — fora desta fatia, que é o encanamento de
  consentimento).
- Cobrança/taxa por indicação.
- Hierarquia multi-unidade/gerente (F3, arquitetura já referencia como costura futura separada —
  `is_job_owner`/`is_company_owner`).
- Alterar a policy de SELECT de `workers` (`can_view_worker_profile`) — a vitrine pré-aceite é sempre
  via RPC de projeção limitada (R4), nunca abertura de coluna.
- Rate limiting fino / anti-spam de indicações em massa (fica em Questões abertas).
- Indicação vinda de fora do elenco aceito de B (B só indica quem já é dela — R2/R7).

## Clarifications log

- (Nenhuma pergunta feita ao humano nesta rodada — spec construída por suposições explícitas acima,
  a pedido do humano, para manter o progresso contínuo.)

## Questões abertas

- **Default de opt-in/opt-out de indicação** (Suposição 3): confirmar se `accepts_referrals` nasce
  `true` (mais parecido com o status quo informal) ou `false` (mais conservador/LGPD). Muda 1 valor
  de DEFAULT + a mensagem de onboarding, não a arquitetura.
- **Como B identifica a empresa A** (Suposição 2): Worki ID, CNPJ, telefone, ou só empresas com quem
  B já tem histórico (ex.: mesma cidade/rede)? Afeta a UI de busca em R14, não o modelo de dados.
- **Vocabulário final**: "Indicação" foi a escolha desta spec. Confirmar com o humano antes do
  Gemini/frontend-builder escrever qualquer copy — strings de UI são caras de trocar depois
  (i18n, notificações já enviadas, nomes de RPC).
- **Limite de indicações por B por período** (anti-tráfico de pessoas / anti-spam): esta spec só
  resolve idempotência (uma pendente por par). Se o piloto revelar abuso (ex.: B indicando o elenco
  inteiro para todo mundo), precisa de um teto — proposta: revisitar depois de dados reais do piloto,
  não bloquear o lançamento por isso.
- **A pode reagir de alguma forma à indicação antes do aceite** (ex. "cancelar meu interesse")? Esta
  spec não deu a A nenhuma ação sobre uma indicação pendente — só visualização. Se o humano quiser que
  A possa desistir antes do freela responder, precisa de mais um outcome/RPC (`withdraw_interest`).
