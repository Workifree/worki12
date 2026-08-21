# Certificações e capacitações no perfil do freela (F8) — spec

## Context

Entrevista de 17/08/2026 com sócio-operador de 10 unidades do Divino Fogão e de uma rede fitness revelou
**dois usos distintos** da palavra "certificação", com donos, graus de confiança e ciclos de vida diferentes:

1. **Treinamento interno (restaurantes — caminho crítico do piloto agora):** a rede só usa freelas que
   "passaram pelos treinamentos do Divino Fogão". Não há emissor externo nem validade — é a própria empresa
   dizendo "eu treinei esta pessoa". Quem atesta é sempre a empresa; o freela nunca pode se auto-atribuir isso.
2. **Certificação externa (academias — semente da vertical que paga mais):** profissional de educação
   física precisa de diploma/CREF para atuar. É um documento formal, emitido por terceiro, com validade, e
   é o próprio freela quem cadastra (é dono do próprio diploma). O entrevistado citou explicitamente que um
   "repositório de certificações" pode justificar cobrar mais caro — mas essa vertical ainda não está em
   operação; o piloto atual é 100% restaurante.

**Decisão de modelagem — dois objetos, não um com campo `type`.** Um objeto único forçaria colunas
nulas cruzadas nos dois sentidos (emissor/número de registro não fazem sentido no treinamento interno;
`company_id` dono não faz sentido na certificação externa) e, mais importante, misturaria duas políticas de
INSERT fundamentalmente diferentes (só-empresa vs. só-freela) numa única tabela — o que não simplifica nada,
só esconde a diferença real: o treinamento interno é um **registro operacional da empresa sobre o freela**
(mais parecido com uma avaliação/`reviews` do que com um documento pessoal), enquanto a certificação externa
é um **documento pessoal e portável do freela**, exibível a qualquer empresa com vínculo.

Esta spec entrega os dois objetos porque compartilham infraestrutura (seção no perfil, RLS por vínculo,
storage), mas prioriza fundo o caso 1 (interno) — é o que o piloto em restaurantes precisa agora. O caso 2
(externo) sai funcional e correto, mas sem promoção/polimento — é a semente que abre a vertical de academias
quando o Worki decidir investir nela.

## Requirements

- [ ] R1: Duas tabelas novas — `worker_trainings` (interno, atestado pela empresa) e `worker_certifications`
      (externo, cadastrado pelo freela) — conforme os campos abaixo. Nenhuma delas tem FK para `wallets`/
      `escrow_transactions` (Article 8 intacto).

  **`worker_trainings`** (interno):
  `id, company_id (FK companies), worker_id (FK workers), title text not null, completed_at date not null,
  note text null, created_by uuid not null default auth.uid(), created_at timestamptz default now(),
  revoked_at timestamptz null, revoked_reason text null`.

  **`worker_certifications`** (externo):
  `id, worker_id (FK workers), title text not null, issuer text null, registration_number text null,
  issued_at date null, expires_at date null, document_path text null, verified_by_company_id uuid null
  (FK companies), verified_at timestamptz null, verified_note text null, notified_30d_at timestamptz null,
  notified_expired_at timestamptz null, created_at timestamptz default now(), updated_at timestamptz`.

- [ ] R2: INSERT em `worker_trainings` só por empresa com vínculo real com o freela — reaproveita
      `public.can_view_worker_profile(worker_id)` (mesma função da migration `20260816120000`) na policy
      `WITH CHECK (company_id = auth.uid() AND public.can_view_worker_profile(worker_id))`. **Não existe
      policy de INSERT para o freela nesta tabela** — ele não consegue se auto-atribuir treinamento algum,
      nem indiretamente.

- [ ] R3: INSERT em `worker_certifications` só pelo próprio freela — `WITH CHECK (worker_id = auth.uid())`.
      Empresa não tem policy de INSERT nesta tabela.

- [ ] R4: UPDATE em `worker_certifications` é particionado por ator via trigger `enforce_certification_update_scope`
      (mesmo padrão de `enforce_shift_payment_immutability`): se `auth.uid() = OLD.worker_id`, só os campos
      de conteúdo (`title, issuer, registration_number, issued_at, expires_at, document_path`) podem mudar —
      `verified_*` ficam travados no valor anterior; se `auth.uid()` passa em `can_view_worker_profile(OLD.worker_id)`
      e é uma empresa, só `verified_by_company_id, verified_at, verified_note` podem mudar (e
      `verified_by_company_id` tem que ser o próprio `auth.uid()`) — conteúdo trava. Qualquer outro ator: rejeitado.

- [ ] R5: UPDATE em `worker_trainings` só pela própria `company_id = auth.uid()` (dona do registro). Trigger
      `enforce_training_immutability` trava todas as colunas exceto `revoked_at`/`revoked_reason` (empresa
      pode desfazer um treinamento registrado errado, nunca reescrever o conteúdo). Sem policy de DELETE —
      é registro de auditoria, revoga-se, não se apaga.

- [ ] R6: `pages/Profile.tsx` (freela) ganha seção "Minhas Certificações": listar, adicionar, editar,
      excluir linhas de `worker_certifications` (mesmo dono), com upload opcional de documento para o bucket
      privado `certification-docs`. Mesmo padrão visual/validação de upload de `handleUpload` (tipo/tamanho
      de arquivo) já existente na página.

- [ ] R7: `pages/company/WorkerPublicProfile.tsx` (empresa) ganha duas seções novas:
      - **"Certificações"**: lista `worker_certifications` do freela (todas, indepen­dente de quem verificou),
        com botão "Marcar como conferida" quando `verified_by_company_id IS NULL`. Copy obrigatória ao lado
        do botão/selo: *"Você confirma ter visto o documento original — o Worki não verifica diplomas nem
        consulta conselhos profissionais."* (mesma restrição jurídica do termo de prestação).
      - **"Treinamentos"**: lista **só** os `worker_trainings` cujo `company_id` é a empresa logada, com
        botão "+ Registrar treinamento" (título + data de conclusão + observação opcional).

- [ ] R8: Certificação vencida (`expires_at < hoje`) **nunca é ocultada** — continua listada normalmente
      (freela e empresa com vínculo), com badge vermelho "Vencida em DD/MM/AAAA" sobre o card. Emissor,
      número de registro e histórico de verificação continuam visíveis.

- [ ] R9: Função agendada (cron, mesmo padrão de `request_attendance_confirmations_due`) roda diariamente e
      insere notificação (`notifications`) **só para o freela** — nunca para empresas — quando faltam 30 dias
      para `expires_at` (marca `notified_30d_at`) e quando o vencimento chega (marca `notified_expired_at`),
      idempotente por essas duas colunas de controle (nunca duplica o mesmo marco). Link da notificação:
      `/profile`.

- [ ] R10: Bucket de storage `certification-docs` (novo, **privado**). Leitura só via
      `supabase.storage.from('certification-docs').createSignedUrl(...)` no client autenticado — nunca
      `getPublicUrl`. Policy de storage usa `public.can_view_worker_profile(worker_id)` (extraído do primeiro
      segmento do path `<worker_id>/<cert_id>.<ext>`) para decidir leitura; escrita só pelo próprio
      `worker_id = auth.uid()`.

- [ ] R11: `jobs.certification_requirement text null` — campo opcional de texto livre em
      `pages/company/CompanyCreateJob.tsx` (ex.: "CREF válido"). Quando preenchido, `ShiftCallModal`
      (`frontend/src/components/team/ShiftCallModal.tsx`) mostra **uma única linha de aviso no topo do
      modal** com esse texto — nunca um badge por freela na lista, nunca desabilita seleção ou o botão de
      disparo (mesmo princípio de "avisa, nunca bloqueia" da guarda de vínculo).

- [ ] R12: Visibilidade de `worker_certifications` para empresa segue **exatamente** a regra de
      `can_view_worker_profile` (vínculo `pending`/`accepted` em `team_connections` OU histórico operacional
      via `applications`; `blocked` corta o vínculo mas preserva histórico operacional já existente).
      `worker_trainings` **nunca** é visível para outra empresa além da que o registrou — mesmo que essa
      outra empresa também tenha vínculo com o mesmo freela (sem modelo de "rede"/franquia compartilhada
      hoje — ver Out-of-scope).

- [ ] R13: `supabase/functions/delete-account` passa a remover/anonimizar `worker_certifications` (linha +
      arquivo em `certification-docs`) e `worker_trainings` (`worker_id`) do freela excluído, mesmo padrão
      de "dados pessoais anonimizados" já documentado na Zona de Perigo do `Profile.tsx`.

- [ ] R14: Nenhum requisito desta feature grava em `wallets`, `wallet_transactions` ou `escrow_transactions`
      (Article 8 intacto) — confirmação explícita, não apenas ausência de menção.

## Acceptance criteria

- [ ] A1: Dado que uma empresa tem `team_connections.status IN ('pending','accepted')` com um freela (ou
      histórico em `applications`), quando ela abre `WorkerPublicProfile.tsx` desse freela e preenche
      "+ Registrar treinamento" (título + data) e confirma, então um INSERT em `worker_trainings` é feito
      com `company_id = auth.uid()`, e o novo treinamento aparece imediatamente na seção "Treinamentos".

- [ ] A2: Dado que uma empresa não tem nenhum vínculo com um freela, quando tenta inserir em
      `worker_trainings` (via chamada direta à API, contornando a UI), então a policy de INSERT nega (0
      linhas) — `can_view_worker_profile(worker_id)` retorna `false`.

- [ ] A3: Dado um freela autenticado, quando tenta inserir uma linha em `worker_trainings` com qualquer
      `company_id` (tentando se auto-atribuir um treinamento), então a RLS nega — não existe policy de
      INSERT que aceite `auth.uid()` como worker nesta tabela.

- [ ] A4: Dado o freela na seção "Minhas Certificações" de `Profile.tsx`, quando preenche título/emissor/
      validade e opcionalmente sobe um arquivo, então um INSERT em `worker_certifications` com
      `worker_id = auth.uid()` é feito, o arquivo (se houver) vai para
      `certification-docs/<worker_id>/<cert_id>.<ext>`, e a certificação aparece com o selo "Cadastrado por
      você — ainda não conferido".

- [ ] A5: Dado que uma empresa com vínculo abre o perfil de um freela com uma certificação não conferida,
      quando clica "Marcar como conferida" e confirma, então `verified_by_company_id`/`verified_at` são
      gravados e a UI mostra "Conferida por [Nome da empresa] em DD/MM/AAAA — a empresa confirma ter visto
      o documento original. O Worki não verifica diplomas."

- [ ] A6: Dado o mesmo cenário de A5, quando a empresa (na mesma requisição de UPDATE ou numa chamada
      direta) tenta alterar `title`/`issuer`/`expires_at` da certificação, então o trigger
      `enforce_certification_update_scope` rejeita com exceção — o UPDATE inteiro falha.

- [ ] A7: Dado que uma certificação já foi conferida por uma empresa, quando o próprio freela tenta editar
      `verified_by_company_id`/`verified_at` (tentando se autoverificar), então o trigger rejeita — só os
      campos de conteúdo continuam mutáveis pelo dono.

- [ ] A8: Dado `worker_certifications.expires_at` no passado, quando o freela ou uma empresa vinculada
      visualiza o perfil, então a certificação continua listada com badge vermelho "Vencida em DD/MM/AAAA",
      sem ocultar nenhum outro campo.

- [ ] A9: Dado uma certificação a 30 dias do vencimento, quando o cron diário roda, então uma notificação é
      inserida em `notifications` para `worker_id` ("Sua certificação '<title>' vence em 30 dias", link
      `/profile`) e `notified_30d_at` é gravado; nenhuma notificação é criada para nenhuma empresa.

- [ ] A10: Dado que `notified_30d_at` já está preenchido, quando o cron roda de novo antes do vencimento,
      então nenhuma notificação duplicada é criada (idempotência por coluna de controle).

- [ ] A11: Dado que a empresa preenche "Requisito de certificação" ao criar um turno em
      `CompanyCreateJob.tsx`, quando salva, `jobs.certification_requirement` é gravado; quando a mesma
      empresa abre `ShiftCallModal` para esse turno, então aparece uma única linha de aviso no topo do
      modal com o texto — sem badge por freela e sem desabilitar seleção/disparo do chamado.

- [ ] A12: Dado um usuário anônimo (sem sessão), quando tenta acessar a URL pública de um objeto do bucket
      `certification-docs`, então recebe 403 — o bucket é privado e não há policy de leitura para `anon`.

- [ ] A13: Dado uma empresa sem vínculo com um freela, quando tenta gerar/acessar a signed URL de um
      documento de certificação desse freela, então a policy de storage nega
      (`can_view_worker_profile(worker_id)` = `false`).

- [ ] A14: Dado um freela que exclui a própria conta via `delete-account`, quando a função roda, então
      todas as `worker_certifications` desse freela são removidas (linha + arquivo no bucket) e os
      `worker_trainings` onde ele é `worker_id` são anonimizados/removidos conforme o mesmo padrão do resto
      do perfil — nenhuma linha de `wallets`/`escrow_transactions` é tocada.

- [ ] A15: Dado que a empresa A registrou um `worker_trainings` para o freela X, quando a empresa B (mesmo
      com vínculo próprio com X) abre o perfil de X, então a seção "Treinamentos" de B não mostra o
      treinamento registrado pela empresa A — só os que a própria B registrou.

## Out-of-scope

- Filtro/busca no Elenco por "quem tem certificação X válida" — extensão futura.
- Bloqueio de convite ou de chamado (`ShiftCallModal`) por falta de certificação/treinamento — o produto
  sempre avisa, nunca bloqueia (mesmo princípio da guarda de vínculo existente).
- Compartilhamento de treinamento entre unidades/franqueados da mesma rede ("visão de network" — múltiplas
  `companies` enxergando o mesmo treinamento por pertencerem à mesma marca). Exigiria um modelo de
  organização/rede que não existe hoje; requer ADR se essa necessidade virar prioridade.
- Verificação real de diploma/CREF junto a conselho de classe ou qualquer autoridade externa — o Worki
  nunca atesta autenticidade, só registra o que foi declarado/conferido visualmente.
- Adicionar certificações no wizard de `WorkerOnboarding.tsx` — fica só em `Profile.tsx` nesta versão.
- Visão de certificações/treinamentos no painel `pages/Admin.tsx` — fora de escopo.
- Qualquer alteração em `wallets`, `wallet_transactions`, `escrow_transactions` ou nas RPCs de escrow.
- Estrutura de "requisito de turno" rica (múltiplas certificações, validação estruturada por tipo) — R11
  entrega só um campo de texto livre advisory, não um sistema de requisitos.

## Clarifications log

- Q: Um objeto com campo `type` ou dois objetos? → A: **(Assumido)** Dois objetos —
  `worker_trainings` (interno, empresa é dona) e `worker_certifications` (externo, freela é dono). Ver
  justificativa em Context.
- Q: Quem pode inserir cada tipo? → A: **(Assumido)** Treinamento interno: só empresa com vínculo
  (`can_view_worker_profile`), nunca o freela. Certificação externa: só o próprio freela.
- Q: O que acontece com certificação vencida? → A: **(Assumido)** Nunca some — fica marcada com badge
  "Vencida", visível a quem já podia ver antes.
- Q: Quem é avisado do vencimento e quando? → A: **(Assumido)** Só o freela, via notificação em `/profile`,
  30 dias antes e no dia do vencimento (cron diário, idempotente).
- Q: Como distinguir "conferido pela empresa" de "validado pelo Worki"? → A: **(Assumido)** UI sempre atribui
  a verificação a uma empresa nomeada + data, com copy explícita de que o Worki não valida documentos —
  nunca um selo genérico de "verificado".
- Q: Bucket público ou privado para o documento? → A: **(Assumido)** Privado (`certification-docs`), leitura
  só via signed URL, policy reaproveitando `can_view_worker_profile`.
- Q: Onde a empresa usa isso — perfil, filtro de elenco, requisito de turno? → A: **(Assumido)** Perfil
  (ambas as seções) sempre; requisito de turno como aviso de texto livre no topo do `ShiftCallModal`
  (nunca bloqueia); filtro de elenco fica fora de escopo nesta versão.
- Q: Um freelancer treinado pela empresa A aparece para a empresa B (mesma rede/franquia)? → A: **(Assumido)**
  Não — `worker_trainings` só é visível para quem registrou. Visão de rede exige ADR futuro.
- Q: LGPD — o que acontece na exclusão de conta? → A: **(Assumido)** `delete-account` remove/anonimiza as
  duas tabelas + arquivo do bucket, mesmo padrão do resto do perfil.
