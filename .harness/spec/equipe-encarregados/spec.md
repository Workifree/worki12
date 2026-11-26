# Equipe e encarregados (escopo por pessoa dentro da empresa) — spec

> **Nível de risco: ALTO.** Mexe de novo no seam de autorização de empresa (`is_company_owner` /
> `is_job_owner`), que a F13 unificou e que a lição de 24/08/2026 mostrou ter quatro camadas
> reescrevendo a mesma pergunta "quem é a empresa?" fora do seam. Candidata a gate
> `harness-architect` (migrations + RLS) e `harness-security-reviewer` (LGPD, convite por link).
> O dono já decidiu o modelo (decisões abaixo); esta spec **não as relitiga**. Onde preenche
> lacuna está marcado **(Assumido)** e listado no Clarifications log.
>
> **Princípio de propriedade (correção do dono, 23/11/2026):** turnos, chamados e Elenco pertencem à
> **company**, nunca à pessoa. Sair uma pessoa **só corta o acesso dela**; nada é bloqueado nem
> migrado à força, e nenhum freela sai junto com ela.

## Context

Cliente âncora Momma Doces: **uma** company (um CNPJ) operada por 2+ pessoas — Sabrina (eventos),
um encarregado de lojas — e um gestor geral que vê tudo. A mesma base precisa servir de boteco de
dono único (uma pessoa, zero cerimônia) a uma rede. Hoje a F13 (em produção) modela
`company = unidade` e `company_members.role` é travado por CHECK em `'manager'`, que opera a unidade
inteira. Falta **escopo por pessoa dentro da mesma company**: Sabrina não deve ver (nem mexer em) os
turnos do encarregado de lojas, e vice-versa, mas ambos usam o mesmo Elenco e o gestor enxerga tudo.

Estado verificado no código (23/11/2026):

- `AcceptManagerInvite.tsx` (rota pública `/convite-gerente/:token`) exige que o convidado já tenha
  conta de empresa (`/login?type=hire`, cadastro com senha) e só então chama `accept_manager_invite`.
  Token de 7 dias (`invite_company_manager`, migration `20260818100300`), gerado por
  `generate_invite_token()` (2 UUIDs, opaco).
- `invite_company_manager` exige **e-mail** e só aceita chamador `is_organization_operator` — o
  gerente não convida ninguém. `accept_manager_invite` devolve `worker_cannot_be_manager` se o
  `auth.uid()` já tem linha em `workers`, e apaga a casca de `companies` que `handle_new_user` cria
  para todo signup `hire` (seis `NOT EXISTS`).
- O link de convite de elenco já foi corrigido para ser segredo (`20260824000400`,
  `company_invite_links`, token aleatório em tabela separada porque `companies` tem
  `SELECT USING (true)`). **Todo link de convite novo desta feature segue o mesmo princípio:** token
  aleatório opaco, nunca derivado de id público, legível só por quem opera a empresa, rotacionável.
- Existem `pages/company/Organization.tsx`, `CompanyTeam.tsx` (Elenco), `CompanyProfile.tsx`,
  `CompanyDashboard.tsx`; **não encontrei** página "Hoje" em `pages/company/` (ver R25).

**Dois achados que condicionam o desenho** (a confirmar pelo architect no catálogo de produção):

1. **Risco de escalada silenciosa.** `session_operates_company_membership` (DEFINER, usada por
   `is_company_owner`) concede acesso pleno a **qualquer** linha ativa de `company_members`. Hoje só
   existe `'manager'` porque o CHECK trava. No dia em que o CHECK aceitar `'encarregado'`, **todo
   encarregado viraria dono da empresa** em ~15 policies sem tocar nelas. Por isso a ordem das
   migrations (abaixo) é: primeiro estreitar a função para `role = 'manager'`, só depois alargar o
   CHECK. Papel novo nasce **sem nenhum acesso** e ganha por policy explícita (fail-safe).
2. **`jobs` tem SELECT `USING (true)`** (declarado em `architecture.md`/ADR-20260817: workers
   navegam o feed). Logo, "turno alheio aparece só como ocupado" **não é aplicável por RLS na tabela
   `jobs`** sem apertar o SELECT dela, o que afeta o feed do freela e links públicos de vaga. O que a
   RLS consegue garantir de verdade: `applications`, `shift_payments`, `shift_calls`,
   `shift_call_targets`, `shift_attendance_confirmations`, `service_terms` (pessoas, pagamentos,
   chamados) e a projeção "ocupado". Dados da linha em `jobs` (título, budget) de turno alheio
   continuam legíveis como já são hoje (**pré-existente, não alargado por esta feature**). Ver R9 e
   Open items; é decisão do architect se aperta `jobs` agora ou em ADR próprio.

## Decisões fixadas pelo dono (não relitigadas)

1. **Sem login compartilhado.** Cada pessoa tem identidade própria (rastro, desligamento individual).
2. **Três papéis, nomes humanos:** **Gestor** (vê tudo, convida, configura, transfere, relatórios),
   **Encarregado** (opera os próprios turnos), **Consulta** (leitura — **fase posterior**). O
   `manager` atual **migra para Gestor** sem quebrar produção.
3. **Escopo por PESSOA, não por área.** Todo turno/chamado tem `responsável` (quem criou, por
   padrão). **Tag** (ex.: Evento, Loja; criável pela empresa) é só dimensão de filtro/relatório, campo
   de primeira classe desde o dia 1 para virar regra de visibilidade depois.
4. **Visibilidade em camadas, com chave do Gestor:** Encarregado vê por inteiro os próprios turnos;
   turno alheio aparece só como "freela ocupado nesse horário"; valores pagos só os do próprio;
   Elenco da empresa inteira compartilhado.
5. **Convite:** Gestor informa nome+papel, botão "Enviar por WhatsApp" (`wa.me`), sem exigir
   e-mail; convidado vê "Empresa X te convidou como Encarregado", confirma com código por e-mail
   **sem senha** (Supabase email OTP), cai direto em "Hoje" sem onboarding de CNPJ; validade 14 dias,
   reenviável; Gestor recebe "Fulano entrou, é ele?" com confirmar/revogar. Link é segredo. Tratar
   `worker_cannot_be_manager`.
6. **As 7 quebras** (soluções em R14-R21; a quebra 2 está **resolvida por construção, sem bloqueio**).
7. **Valor para o patrão:** relatórios por responsável e tag — classificados v1 / fase posterior em
   "Relatórios".
8. **Divulgação progressiva:** dono único nunca vê Equipe/tags/"Passar para" até convidar a primeira
   pessoa; Configurações → Equipe é o lugar óbvio, um botão primário, sem matriz de checkboxes;
   botões grandes, mobile-first, neo-brutalista.
9. **Remover pessoa só corta acesso (correção do dono, 23/11).** Imediato (`status='removed'`),
   sem exigir transferência e sem migrar nada à força. Turnos abertos que ela criou continuam
   valendo e passam a ter o **Gestor como responsável** (mesma regra do turno legado sem
   responsável); o histórico mantém o nome de quem criou (rastro), que deixa de dar acesso.
10. **Elenco é um só, da company.** Freelas que o encarregado traz (convite ao Elenco, link,
    telefone) entram **direto** em `team_connections.company_id` — nunca no "elenco da pessoa". A
    saída dela não leva nenhum freela consigo. "Cada um seguir" vale só na interface (filtros/visão),
    não no dado.

## Modelo (proposto — gate do architect)

Papel armazenado em `company_members.role`: `'manager'` (rótulo de UI **Gestor**, sem migração de
dados — **Assumido**), `'encarregado'` (novo). `'consulta'` entra só na fase posterior (não deixar
valor dormente no CHECK).

Novas estruturas (todas aditivas; nada existente é removido):

| Objeto | Forma | Observação |
|---|---|---|
| `jobs.responsible_id uuid NULL` | uuid de **pessoa** (`auth.users`), sem FK para `company_members` | O dono único não tem linha em `company_members`. **Responsável efetivo** = `responsible_id` se for operador ativo; senão (NULL, pessoa removida/revogada) = **Gestor** (R19). Nada é reescrito na remoção. Trigger valida operador ativo **só em escrita**. |
| `jobs.tag_id uuid NULL → company_tags(id) ON DELETE RESTRICT` | dimensão de filtro | Nunca apagada (R20). |
| `company_tags` | `(id, company_id, name, archived_at, created_by, created_at)`, UNIQUE `(company_id, lower(name))` | Sem policy de DELETE. Escrita só Gestor. |
| `company_members` + colunas | `display_name`, `accepted_tos_at`, `confirmed_at`, `confirmed_by`, `accepted_email`, `removed_at` | `invited_email` deixa de ser exigido no convite. `display_name` permanece após remoção (rastro). |
| `team_connections.invited_by uuid NULL` | rastro de quem trouxe o freela (**Assumido**) | **Só auditoria. Nunca em predicado de autorização** (USING, WITH CHECK, funções de seam). Preenchido e protegido por trigger (R10b). |
| `responsibility_coverages` | `(id, company_id, from_user, to_user, starts_on, ends_on, created_by, revoked_at)` | "Cobrir X de A a B": **janela por data, sem cron** (R18). |
| Funções-seam novas | `session_company_member_role(company_id)` (DEFINER, sobre `auth.uid()`), `is_company_member_confirmed(company_id)`, `notification_recipients_for_job(job_id)` | Mínimas, sem parâmetro "por qual usuário perguntar". **`is_company_member_confirmed`** = Gestor/dono/operador de organização (sempre) **ou** Encarregado `active` com `confirmed_at IS NOT NULL`. Não existe função "membro ativo" usada para autorizar leitura de dado de freela (ver R7a). |

**Semântica do par existente (decisão central, a confirmar):**
`is_company_owner(c)` continua significando "**Gestor** desta empresa" (dono, `manager` ativo,
operador de organização). `is_job_owner(j)` passa a significar "**pode operar ESTE turno**" =
`is_company_owner(jobs.company_id)` **OU** `jobs.responsible_id = auth.uid()` (encarregado ativo
e confirmado) **OU** cobertura ativa do responsável sobre a data do turno. Como depende de
**membership ativa**, remover a pessoa corta o acesso no próximo request sem tocar em nenhuma linha.
Assim `shift_calls`, `shift_call_targets`, `cancel_shift_call`, `create_sos_call` etc. herdam o
escopo por pessoa sem reescrita (a aposta do ADR-20260817). O corpo continua `BEGIN ATOMIC`
(dependência registrada). Alternativa a avaliar: função nova `can_operate_job` e deixar
`is_job_owner` Gestor-only; custo: re-apontar todas as policies de turno.

## Requirements

### Papéis, schema e seam

- [ ] R1: Antes de qualquer papel novo existir, `session_operates_company_membership` passa a exigir
      `role = 'manager'` explicitamente. Só então o CHECK de `company_members.role` é alargado para
      incluir `'encarregado'`. Papel sem policy explícita não enxerga nada.
- [ ] R2: Criar `jobs.responsible_id`, `jobs.tag_id`, `company_tags`, `responsibility_coverages`,
      `team_connections.invited_by` e as colunas novas de `company_members` (migration aditiva, RLS
      habilitada com policies desde o nascimento, nenhuma policy existente tocada).
- [ ] R3: Trigger BEFORE INSERT em `jobs`: `responsible_id := COALESCE(NEW.responsible_id,
      auth.uid())` quando `auth.uid()` é operador da company; o cliente **não** é a fonte da verdade.
      Trigger de validação: `responsible_id` em INSERT/UPDATE precisa ser operador ativo da company
      (dono, Gestor, Encarregado confirmado ou operador de organização), senão erro. Nunca
      `company_id = auth.uid()` na mão.
- [ ] R4: `is_company_owner` e `is_job_owner` são alteradas **na mesma migration** (contrato do
      ADR-20260817), conforme "Semântica do par". Papel `encarregado` nunca satisfaz
      `is_company_owner`.
- [ ] R5: Migrar para o seam as policies/triggers que ainda decidem por conta própria. Lista mínima
      em "Raio de alcance". `applications` e `shift_payments` passam a ancorar em `is_job_owner(job_id)`.
- [ ] R6: Encarregado pode: criar turno (responsável = ele), disparar chamado/convite a freela do
      Elenco para os **próprios** turnos, ver candidatos/aplicações dos próprios turnos, confirmar
      presença, dispensar/cancelar freela do próprio turno, **cancelar o próprio turno inteiro pela
      RPC `cancel_job` (R27)**, registrar/efetivar pagamento externo dos próprios turnos
      (**Assumido**; **estornar** (`voided`) só Gestor), avaliar freela de turno próprio, **trazer
      freelas para o Elenco da company** (R10b), "Passar para...", criar "Cobrir".
      **Não pode:** remover/bloquear freela do Elenco (só Gestor, **Assumido**), criar/arquivar tag,
      gerenciar membros, rotacionar o link de convite, configurar `link_risk_alert_*` (pode **ler** a
      configuração, R7b), criar/gerir séries (v1.1), relatórios, chat da empresa, ver turnos/valores
      alheios.
- [ ] R7: Elenco compartilhado em **leitura** para Encarregado **confirmado** (R22): lê
      `team_connections` e `team_lists` da company (os chips do `ShiftCallModal`). PII do freela (CPF,
      telefone, PIX, nascimento): Encarregado só lê o que `can_view_worker_profile` já concederia pelo
      **vínculo operacional dos próprios turnos** (applications em turno dele, ex.: PIX para pagar);
      cartões de Elenco via `list_team_connection_cards()` (projeção fechada, sem PII) servem o
      resto. Estender `can_view_worker_profile` e `list_team_connection_cards` ao novo escopo.
- [ ] R7a: **Contagem da guarda de vínculo exige membro CONFIRMADO, não só ativo.**
      `count_worker_shifts_by_week` autoriza por `is_company_member_confirmed(company)` (substitui a
      citação `is_company_member` do gate G4, que deve ser reescrita pelo architect). Justificativa:
      quantos turnos um freela nomeado faz por semana na company é dado de carga de trabalho **de
      freela**, da mesma classe que o Elenco (R7); o encarregado não confirmado já não lê Elenco, então
      "membro ativo" abriria uma leitura que R22 fecha. Para o não confirmado a RPC **não devolve 0**:
      devolve `{outcome:'not_confirmed'}` (um zero silencioso seria falso "sem risco", pior que sem
      aviso). A UI degrada para "sem aviso" + log (regra F5: nunca quebra a feature), caso que na
      prática não ocorre porque o não confirmado não consegue selecionar freelas. Para o confirmado,
      escopo inalterado: **a company inteira**, só contagem, sem detalhe de turno (o risco de vínculo
      trabalhista é da empresa; Assumido). Dono/Gestor/operador de organização são sempre
      "confirmados".
- [ ] R7b: **Config de risco de vínculo com empresa explícita.** `my_link_risk_config(p_company_id
      uuid DEFAULT NULL)`:
      - **Com `p_company_id`:** exige `is_company_member_confirmed(p_company_id)` (leitura:
        `link_risk_alert_enabled`, `link_risk_alert_threshold`; o encarregado precisa lê-la para o
        aviso). A escrita dessas colunas continua só Gestor (R6).
      - **Sem parâmetro:** se a sessão opera **exatamente uma** company (100% das contas de hoje),
        usa essa; se opera **mais de uma**, devolve `{outcome:'company_required'}` e **nenhum
        dado**. Proibido `LIMIT 1` por `c.id` ou qualquer escolha implícita (pode divergir da
        "empresa corrente" da tela e mostrar o limite da unidade errada).
      - Todo chamador de frontend passa a empresa corrente (`get_my_companies` / seletor R13 da F13).
      - Como a mudança de assinatura cria overload (PostgREST ambíguo), a migration faz `DROP` da
        assinatura antiga e `CREATE` da nova com `DEFAULT NULL`, na mesma transação.
      - Auditar no mesmo passo qualquer outra RPC/resolvedor que escolha empresa por `LIMIT 1`.

### Visibilidade em camadas e conflito

- [ ] R8: Gestor (inclui dono e operador de organização) vê tudo da company. Encarregado vê por
      inteiro apenas turnos em que é responsável (ou cobre, R18), e seus chamados, candidatos,
      presenças, termos e pagamentos.
- [ ] R9: "Turno alheio" para Encarregado = **somente** a projeção de ocupado (R14). Os dados que a
      RLS protege de verdade são os de `applications`, `shift_payments`, `shift_calls`,
      `shift_call_targets`, `shift_attendance_confirmations`, `service_terms`. A leitura da linha em
      `jobs` fica como hoje (`USING (true)`, ver Context); **a UI do Encarregado nunca consulta nem
      renderiza turnos alheios.** Se o architect decidir apertar `jobs`, vira migration própria com
      teste de regressão do feed do freela (fora desta spec se não aprovado).
- [ ] R10: Valores pagos: Encarregado lê `shift_payments` só dos próprios turnos; nenhuma tela dele
      soma ou lista valores alheios; telas/relatórios com total da company são Gestor-only.
- [ ] R10b: **Elenco único, da company.** Quando o Encarregado convida um freela ao Elenco (link da
      company, telefone/Worki ID, indicação), o vínculo é gravado em `team_connections` com
      `company_id` = a **company** (resolvido pelo seam / `get_my_companies`), nunca o id da pessoa. O
      consentimento do freela segue igual (`pending` → o freela diz sim; veto indelével do freela
      intocado). Encarregado só **insere** vínculos `pending`; remover ou bloquear é Gestor. Se o
      Encarregado sai, **todos** os freelas que ele trouxe permanecem no Elenco; nada é movido,
      copiado ou apagado. A visão "meus freelas" do Encarregado é filtro de interface (por
      `invited_by`), não separação de dado. O link de convite do Elenco (`company_invite_links`) é
      legível por Encarregado confirmado (é o link da company; **Assumido**, a validar na revisão de
      segurança); rotacionar é só Gestor.
- [ ] R10c: **`invited_by` fora de qualquer predicado de autorização (decisão: trigger, não
      policy).** `invited_by` **não** aparece no `WITH CHECK` de `tc_insert_company` nem em USING de
      policy nem em função de seam. A policy ancora só em `company_id` pelo seam (membership
      confirmada, `status='pending'`, `source` permitido). O valor vem de trigger BEFORE INSERT em
      `team_connections` que **sobrescreve** `NEW.invited_by := auth.uid()` (o cliente não escolhe;
      NULL para ator sem sessão, ex.: service_role) e de trigger BEFORE UPDATE que torna a coluna
      **imutável**. Isso entrega integridade do rastro sem acoplar a autorização a um campo de
      auditoria. O gate D8 ("`invited_by` não pode estar em predicado de autorização") fica **mantido
      e é cumprido** (o item que o contrariava é a cláusula na policy, que sai); o texto de D8 só
      precisa acrescentar "preenchido e travado por trigger". Aplicado também ao rastro equivalente em
      outras tabelas novas (`company_tags.created_by`, `company_members.confirmed_by`).

### Convite e entrada

- [ ] R11: **Convite novo.** RPC `invite_company_member(p_company_id, p_display_name, p_role)`
      (DEFINER, `search_path=''`) devolve `{outcome, member_id, invite_token}` com token via
      `generate_invite_token()`, `expires_at = now() + interval '14 days'`, sem e-mail. Quem pode
      convidar: **Encarregado** (e Consulta no futuro) — qualquer Gestor; **Gestor** — só dono /
      operador de organização (Assumido: Gestor não cria Gestor, evita escalada lateral). Encarregado
      nunca convida pessoas da equipe. Idempotente por `(company_id, display_name, role)` pendente
      (devolve o token vigente). Link `/convite-equipe/:token` (Assumido; `/convite-gerente/:token`
      continua válido para convites já emitidos).
- [ ] R12: **Enviar por WhatsApp.** Botão primário monta `https://wa.me/?text=<mensagem>` (sem
      telefone no v1 — o Gestor escolhe o contato no WhatsApp; Assumido) com: "Oi, {nome}! {Empresa}
      te convidou para o Worki como {Papel}. Entre por aqui: {link}. O link é só seu, não repasse."
      Também "Copiar link". O link da equipe é exibido só ao Gestor; nunca em tela de Encarregado.
- [ ] R13: **Aceite sem senha.** Página `/convite-equipe/:token` (pública, fora do `ProtectedRoute`,
      preserva token em `sessionStorage` como `AcceptManagerInvite`): mostra "{Empresa} te convidou
      como {Papel}" (RPC pública de leitura mínima: nome da empresa + papel + status, **nenhum** outro
      dado), pede e-mail, envia OTP (`signInWithOtp` com `user_metadata.user_type='hire'`),
      confirma código (`verifyOtp`), aceita os Termos de Uso/Privacidade inline (gravado em
      `company_members.accepted_tos_at` — Article 12 mantido por pessoa; Assumido), chama
      `accept_company_member_invite(token)` e navega para "Hoje". Sem onboarding de CNPJ: o gate do
      `ProtectedRoute` resolve onboarding/TOS pela membership (via `get_my_companies`), nunca pela
      casca vazia de `companies`.
- [ ] R14b: `accept_company_member_invite` generaliza `accept_manager_invite` (mesmas guardas:
      `FOR UPDATE`, idempotente para o mesmo `user_id`, `token_already_used` para outro,
      `expired`, `revoked`, `not_found` genérico, queima o token no uso, remove a casca de
      `companies` sob as seis guardas). Grava e-mail verificado (`accepted_email`).
      **`worker_cannot_be_manager`:** o e-mail do OTP pode já pertencer a conta de freela
      (e-mail é único no Auth). Copy: "Este e-mail já é de uma conta de freela. Use outro e-mail para
      entrar na equipe." Sem criar conta de empresa nem mover papel (Article 1).
- [ ] R15: **Reenvio e validade.** `resend_member_invite(member_id)` (só quem pode convidar aquele
      papel) **rotaciona o token** (o link antigo morre) e renova `expires_at` para +14 dias. Convite
      vencido aparece com selo "Venceu" e botão "Reenviar".
- [ ] R22: **Confirmação do Gestor.** Aceite deixa a pessoa `active` com `confirmed_at IS NULL`
      (acesso imediato a "Hoje" e aos próprios turnos — vazio no começo). O Gestor recebe
      notificação "{Nome} entrou ({e-mail}). É ele?" com **Confirmar** (`confirmed_at/by`) ou
      **Revogar** (`status='removed'`). Enquanto não confirmada, a pessoa **não** lê Elenco nem dados de
      freela (R7, R7a, R7b) — mitiga link vazado (bearer secret). Gestor também vê "Aguardando
      confirmação" na tela Equipe.

### As 7 quebras (soluções obrigatórias)

- [ ] R14: **(1) Conflito de freela entre responsáveis.** RPC `get_busy_workers(p_company_id,
      p_start, p_end, p_worker_ids uuid[], p_exclude_job_id uuid)` (DEFINER, `search_path=''`)
      devolve só `worker_id` dos que estão ocupados **na company inteira** no intervalo (application
      `hired|in_progress`, ou alvo pendente de chamado aberto, ou convite pendente), de qualquer
      responsável. Retorno **não** contém job, título, responsável nem motivo. Exige
      `is_company_member_confirmed`. Só aceita `worker_ids` com `team_connections` aceita naquela
      company (sem oráculo sobre freela alheio ao Elenco). A UI (`ShiftCallModal`, convite direto)
      **avisa** "Fulano já está ocupado nesse horário", sem bloquear (decisão: só avisa). Para o
      chamador, ocupado por turno **dele** pode mostrar o detalhe (é dele).
- [ ] R17: **(2) Quem criou sai — resolvido por construção, sem bloqueio.**
      `remove_company_member(p_company_id, p_user_id)` (DEFINER; Gestor, ou operador de organização
      para Gestor) apenas marca `company_members.status='removed'` (+ `removed_at`, `invite_token`
      nulo) e **nunca** é recusada por haver turnos abertos. O acesso cessa no próximo request
      (a membership deixa de ser ativa; sessão sem poder operar a company). **Nada é migrado ou
      reescrito:** turnos, chamados, candidaturas, pagamentos e Elenco ficam intactos (pertencem à
      company); turnos abertos que a pessoa criou continuam valendo e passam a ter o Gestor como
      responsável efetivo (R19); coberturas dela ou para ela ficam inertes (o seam exige membership
      ativa). O nome de quem criou permanece no histórico (rastro), sem dar acesso. A confirmação na
      UI é só **informativa**: "{Nome} perde o acesso agora. N turnos abertos dele ficarão com você."
      (N vem da própria RPC em modo `p_dry_run`, mesma regra de `update_job_series_future`). "Passar
      para..." e "Cobrir" continuam disponíveis como **conveniência opcional**, nunca pré-condição.
      `revoke_company_manager` permanece para convites pendentes.
- [ ] R18: **(3) "Passar para..." e "Cobrir X de A a B" (ferramentas opcionais).**
      `reassign_job_responsible(p_job_ids uuid[], p_to uuid)`: Gestor passa qualquer turno;
      Encarregado passa só os próprios, para qualquer operador ativo e confirmado da company;
      transação única, devolve `{outcome, moved, skipped}`; notifica origem e destino. "Cobrir":
      `create_responsibility_coverage(p_company_id, p_from, p_to, p_starts_on, p_ends_on)`
      (Gestor para qualquer `from`; Encarregado só com `from = ele`; janela máx. 60 dias
      (Assumido), datas em `America/Sao_Paulo`). **Fim automático = a janela**: a permissão de
      `is_job_owner` olha a data do turno contra `[starts_on, ends_on]` e `revoked_at IS NULL`;
      nenhum cron, nada a reverter. O responsável registrado **não muda** (histórico e relatórios
      seguem apontando X); quem cobre opera. Encerrar antes: `end_responsibility_coverage`.
- [ ] R19: **(6) Responsável efetivo = Gestor** quando `responsible_id` é NULL (turno legado) **ou**
      aponta para pessoa que não é mais operador ativo (removida/revogada). Sem backfill e sem
      escrita em `jobs`: a regra vive no seam e na UI (card mostra "Gestor", com "criado por
      {nome}" quando há rastro). Filtros tratam esses casos como Gestor; Encarregado nunca os vê.
      "Passar para..." funciona sobre eles.
- [ ] R20: **(7) Nunca apagar tag nem pessoa com histórico.** `company_tags.archived_at` (sem DELETE,
      FK `RESTRICT`); tag arquivada some do seletor de novos turnos e continua em filtros/relatórios
      históricos. Pessoa = `company_members.status='removed'` (nunca DELETE; mantém `display_name`
      para rótulo "ex-{nome}"); `anonymize_account` do próprio usuário anula `display_name` e
      `accepted_email`, preservando `responsible_id` (uuid sem PII).
- [ ] R21: **(4) Cancelamento notifica responsável E Gestor.** Reescrever
      `trg_notify_counterpart_on_application_cancel` (e demais notificações "à empresa") para usar
      `notification_recipients_for_job(job_id)` = responsável efetivo (operador ativo) + todos os
      Gestores ativos + dono, **deduplicado** (responsável removido: só os Gestores). Ator
      desconhecido (`auth.uid() IS NULL`) segue notificando ambos os lados com texto neutro. Link
      `/company/jobs/<id>/candidates` mantido. Notificação à contraparte continua por **trigger
      DEFINER** (garantia do produto, não cortesia da UI). **(5) Pessoa em várias frentes** = só
      filtro por tag; nenhum papel por tag, nenhuma regra nova.
- [ ] R27: **Cancelar o turno inteiro (soft delete) — permitido ao Encarregado nos PRÓPRIOS turnos,
      só por RPC.** Motivo: cancelar o que ele próprio opera é parte de "opera os próprios turnos"
      (decisão 2/4); exigir o Gestor para cada cancelamento seria o atrito que a feature existe para
      tirar. Mas o `UPDATE jobs SET status='deleted'` cru não pode ser o caminho, porque deixaria
      candidatos contratados sem aviso. Regras:
      - RPC `cancel_job(p_job_id, p_reason text)` (DEFINER, `search_path=''`): autoriza por
        `is_job_owner(p_job_id)` (Gestor qualquer turno; Encarregado só os próprios/cobertos).
        Em **uma transação**: `applications` em `invited|hired` → `cancelled` (isso dispara o
        trigger existente, que **notifica o freela** "Turno cancelado pela empresa" e, via R21,
        responsável + Gestores); chamados abertos do turno (`shift_calls`) → `cancelled` pela mesma
        lógica de `cancel_shift_call`; por fim `jobs.status='deleted'` (soft, nunca DELETE).
        Devolve `{outcome, cancelled_applications, cancelled_calls}`.
      - **Recusa** (`outcome` explícito, nada alterado) se houver `shift_payments` ativo
        (`scheduled|recorded`) ou candidatura `in_progress|completed` (presença já iniciada):
        mesma guarda de `dismissFromShift`. Estornar o pagamento antes é do Gestor (R6).
      - Trigger BEFORE UPDATE em `jobs`: transição para `status='deleted'` por sessão **não Gestor**
        só passa se o turno estiver **vazio** (zero `applications` vivas e zero `shift_calls`
        abertos); regra por dados, sem flag/GUC. Assim o UPDATE cru do encarregado só funciona
        quando não há ninguém a notificar. Gestor segue podendo cancelar por RPC ou UPDATE vazio.
      - **Elenco intocado:** cancelar turno não altera `team_connections`, `team_lists` nem o
        histórico do freela (cancelamento pela empresa não é penalidade nem bloqueio; o freela segue
        no Elenco e elegível a novos chamados).
      - Turno de série: o Encarregado cancela só a ocorrência individual própria; parar/editar a
        série continua Gestor-only (v1).
      - Quem cancela e o motivo ficam no rastro (`notifications` + `jobs.responsible_id` inalterado).

### Divulgação progressiva e telas

- [ ] R23: Mostrar Equipe/tags/"Passar para"/"Cobrir"/seletor de responsável **somente** quando a
      company tem ≥1 `company_members` não removido (flag derivada em `get_my_companies`, ex.
      `team_enabled`), ou quando a sessão é Encarregado. Dono único: o único traço é a entrada
      "Equipe" em Configurações com um botão primário "Convidar alguém da equipe". Nada de matriz de
      checkboxes: escolher papel é um seletor de dois cartões grandes (Gestor, Encarregado) com uma
      frase de descrição.
- [ ] R24: Tela **Equipe** (Gestor; rota `/company/configuracoes/equipe`, Assumido): lista pessoas
      (nome, papel, status: Convite enviado / Venceu / Aguardando confirmação / Ativo), ações
      Confirmar, Reenviar, Remover (confirmação informativa, R17), e gestão de tags
      (criar/arquivar). Nome **"Equipe" = pessoas que operam**; **"Elenco" = freelas** (não misturar
      rótulos).
- [ ] R25: Tela **Hoje** (v1): turnos de hoje do usuário (responsável + coberturas), com status de
      presença e atalhos. Gestor vê todos, com filtro por pessoa e por tag; Encarregado só os seus.
      Todo card de turno mostra o **responsável** (avatar/nome; "Gestor" quando efetivo, R19).
      Aterrissagem padrão do Encarregado. (Assumido: rota `/company/hoje`; reaproveitar componentes
      de `CompanyDashboard`/`CompanyJobs`.) Mobile-first, botões grandes, neo-brutalista (Article 13).
- [ ] R26: Criação de turno ganha campo **Responsável** (default: eu; só Gestor troca) e **Tag**
      (opcional, só aparece com `team_enabled`). Listas de turnos ganham filtros por responsável e
      tag. Dono único não vê nenhum dos dois campos.

## Relatórios (valor para o patrão)

| Relatório | Classificação | Nota |
|---|---|---|
| Responsável visível em todo turno + filtro por pessoa/tag | **v1** | dado de primeira classe desde o dia 1 |
| Relatório semanal por responsável e por tag (gasto, faltas, tempo até preencher) | **Fase posterior** (v1.2) | gasto = só `shift_payments.status='recorded'` (promessa não infla); tempo até preencher = `first_claim_at - created_at`; consumir `get_my_companies()` e `analytics-operacao` |
| Taxa de falta por freela | **Fase posterior** | Gestor-only (LGPD: dado de desempenho do freela não circula entre responsáveis) |
| Custo por evento (por tag) | **Fase posterior** | depende de tag em uso e de relatório semanal |

Todos Gestor-only. **v1 mínimo (fixado pelo dono):** tela Hoje por pessoa + responsável visível +
Passar para/Cobrir + conflito + convite novo.

## Sequência de migrations (proposta ao gate; pequenas e reversíveis)

Timestamps ilustrativos. Aplicar por MCP dirigido e verificar no catálogo (nunca `supabase db push`).

| # | Migration | Conteúdo | Reversão |
|---|---|---|---|
| E0 | `20261124000100_equipe_hardening_membership.sql` | R1 (parte 1): `session_operates_company_membership` exige `role='manager'`; cria `session_company_member_role`. No-op hoje (CHECK só permite `manager`). | `CREATE OR REPLACE` da versão anterior |
| E1 | `20261124000200_equipe_schema_aditivo.sql` | R2: colunas, `company_tags`, `responsibility_coverages`, RLS própria. Zero policy existente tocada. | `DROP TABLE/COLUMN` (nada referencia ainda) |
| E2 | `20261124000300_equipe_seam_job_operator.sql` | R3/R4: trigger de responsável + validação; `is_company_owner`/`is_job_owner` no par; `is_company_member_confirmed`; `notification_recipients_for_job`. **No-op observável** enquanto não existir encarregado: legado tem `responsible_id` NULL ou = dono (já Gestor). | `CREATE OR REPLACE` do par anterior (guardar no DOWN) |
| E3 | `20261124000400_equipe_policies_e_triggers.sql` | R5/R7/R7a/R10b/R10c: policies de `applications`, `shift_payments`, `team_connections` (leitura + INSERT `pending` por membro confirmado, ancorado só em `company_id`; **sem `invited_by` na policy**), triggers de `invited_by` (preenche/imutável) e de transição `deleted` em `jobs` (R27), `team_lists` (leitura), `company_invite_links` (leitura), `shift_attendance_confirmations`, `service_terms`, `reviews`; triggers `validate_application_update`, `enforce_shift_payment_immutability`; `can_view_worker_profile`; `count_worker_shifts_by_week` por `is_company_member_confirmed`; notificação R21. | restaurar versões anteriores (guardadas no DOWN) |
| Portão | Queries read-only em produção com `ROLLBACK`: comparar ANTES/DEPOIS de `is_company_owner`/`is_job_owner` para as contas reais (resultado idêntico: nenhum encarregado existe); auditoria `pg_policies` (A1-A4, A21). | — |
| E4 | `20261124000500_equipe_rpcs_convite.sql` | R11, R13/R14b, R15, R17 (`remove_company_member`, sem bloqueio), R22 (confirmar) + **alarga o CHECK para `'encarregado'`** (último passo). **Ponto de não retorno:** primeiro aceite real. | `DROP FUNCTION` + restaurar CHECK (só seguro com zero encarregados) |
| E5 | `20261124000600_equipe_rpcs_operacao.sql` | R14 (`get_busy_workers`), R18 (`reassign_job_responsible`, coverage), tags, R27 (`cancel_job`), R7b (`my_link_risk_config(p_company_id uuid DEFAULT NULL)`: `DROP` da assinatura antiga + `CREATE` da nova na mesma transação) | `DROP FUNCTION`; recriar `my_link_risk_config()` antiga; dados de tag/cobertura ficam inertes |
| Frontend | R12, R13, R23-R26, resolvedores (inclui passar a empresa corrente a `my_link_risk_config`) | sem SQL | revert de commit |
| E6 (posterior) | relatórios e papel Consulta | fora do v1 | — |

O mesmo raciocínio da F13 vale: E0-E3 são aditivas/no-op até E4 criar a primeira linha de
`encarregado`, então podem ir a produção e ser verificadas sem pressa antes de "ligar" a feature.
(Exceção declarada: o trigger de `deleted` em `jobs` e a troca de predicado de
`count_worker_shifts_by_week` em E3 mudam comportamento só para sessões não Gestor / não confirmadas,
que não existem antes de E4.)

## Raio de alcance a auditar

**Policies/tabelas:** `jobs` (INSERT/UPDATE/DELETE por empresa; SELECT `USING (true)`; transição
`deleted`), `applications`, `shift_payments`, `shift_calls`, `shift_call_targets`, `team_connections`
(INSERT/SELECT por membro; DELETE/UPDATE/bloqueio continuam Gestor; guarda de veto indelével
intacta; `invited_by` fora de predicados), `team_lists`, `team_list_members`, `job_series`,
`shift_attendance_confirmations`, `service_terms`, `worker_trainings`/`worker_certifications`
(conferência por empresa), `worker_referrals`, `reviews`, `notifications` (policy de INSERT exige
vínculo), `company_invite_links` (leitura estendida a Encarregado confirmado, rotação Gestor-only),
`company_members` (**Encarregado lê só a própria linha; nunca lê `invite_token` de ninguém** — se
a policy de coluna não bastar, mover token para tabela separada como `company_invite_links`),
conversas/mensagens (chat usa o id da empresa como participante; **Encarregado fora do chat no v1**).

**Funções/triggers (a re-ler no catálogo, não nas migrations):** `is_company_owner`, `is_job_owner`,
`session_operates_company_membership`, `can_view_worker_profile`, `list_team_connection_cards`,
`validate_application_update`, `enforce_shift_payment_immutability`,
`trg_notify_counterpart_on_application_cancel`, `notify_worker_on_shift_payment`,
`claim_shift_slot`/`decline_shift_call` (aviso "chamado esvaziou" vai a quem?), `cancel_shift_call`,
`create_sos_call`/`sos_call_eligibility`, `create_job_series`/`update_job_series_future`/
`stop_job_series` (Gestor-only no v1), `request_attendance_confirmation(s)`,
`count_worker_shifts_by_week` (R7a), `my_link_risk_config` (R7b; **e qualquer outra função que
escolha empresa por `LIMIT 1`**), `get_worker_company_badges`, `get_my_companies`,
`accept_company_invite_by_token` e demais RPCs de convite ao Elenco (garantir `company_id` da
company, nunca o uid da pessoa), `create_worker_referral`, `accept_manager_invite`/
`invite_company_manager`/`revoke_company_manager`, `anonymize_account`,
`lgpd_guard_auth_user_delete`. **Premissa a verificar:** hoje as notificações "para a empresa" usam o
`company_id` como destinatário (= uid do dono); gerentes/encarregados **não recebem** nada. Mapear
todos os pontos que inserem em `notifications` com `company_id`.

**Documentos de gate a atualizar pelo architect:** G4 (`is_company_member` → `is_company_member_confirmed`)
e D8 (acrescentar "`invited_by` preenchido e travado por trigger"). Não os li nesta sessão.

**Frontend (método: buscar `getAuthenticatedCompanyId`, `owner_id`, `.eq('company_id', user.id)`,
`auth.uid()`, `my_link_risk_config`; o nome repetido já fez o grep mentir):** `ProtectedRoute.tsx`
(onboarding/TOS por pessoa), `teamConnectionService.getAuthenticatedCompanyId` (+ os resolvedores
locais homônimos; todo convite ao Elenco precisa resolver a **company**, nunca `user.id`),
`organizationService`, `operationAnalyticsService.resolveCompanyScope`, `CompanyProfile.tsx`,
`Organization.tsx`, `CompanyLayout`/`Sidebar`/`BottomNav` (itens de navegação por papel),
`CompanyDashboard`, `CompanyJobs`, `CompanyJobDetails` (botão "Cancelar turno" → `cancel_job`),
`CompanyJobCandidates`, `CompanyCreateJob`, `CompanyTeam` (Elenco), `ShiftCallModal`,
`InviteSeriesModal`, modal "Registrar Pagamento", `ReceiptView`, `RateModal`, `CompanyOrdersReport`,
`CompanyOperationAnalytics`, notificações, `App.tsx` (rotas novas `/convite-equipe/:token`,
`/company/hoje`, `/company/configuracoes/equipe`).

## Acceptance criteria

Verificação SQL: `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = ...; ...;
ROLLBACK;` contra dados reais/de QA (como feito em 24/08). UI: Vitest co-located + Playwright E2E.

- [ ] A1: Dado o estado de produção após E0-E3 e **nenhum** encarregado criado, quando uma conta
      legada (dono único) executa `is_company_owner(<sua company>)` e `is_job_owner(<seu turno>)`,
      então ambas retornam `true`, e uma conta de freela retorna `false` — idêntico ao pré-migration.
- [ ] A2: Dado um `company_members` `role='encarregado'`, `status='active'`, `confirmed_at` preenchido,
      quando ele chama `is_company_owner(<company>)`, então retorna `false` (papel novo não herda
      acesso pleno); quando chama `is_job_owner(<turno onde é responsável>)`, retorna `true`; quando
      chama `is_job_owner(<turno de outro responsável>)`, retorna `false`.
- [ ] A3: Dado o Encarregado E e um turno T de outro responsável com applications e `shift_payments`,
      quando E faz `SELECT` em `applications`, `shift_payments`, `shift_calls`,
      `shift_call_targets` filtrando por T, então 0 linhas; e `INSERT/UPDATE` nessas tabelas para T é
      negado pela RLS.
- [ ] A4: Dado E com um turno próprio P e um `shift_payments` de P, quando E lista pagamentos, então vê
      só os de P (e de turnos que cobre), e a soma exibida na UI dele não inclui nenhum valor alheio.
- [ ] A5: Dado que o freela F está `hired` num turno de outro responsável das 18h às 22h, quando E
      abre o chamado do próprio turno das 19h às 23h e F está entre os selecionáveis, então
      `get_busy_workers` devolve F e a UI mostra aviso "ocupado nesse horário" **sem** título, valor
      nem responsável do outro turno; E ainda consegue disparar o chamado (só avisa); e o payload da
      RPC não contém nenhum campo além de `worker_id`.
- [ ] A6: Dado um `worker_id` fora do Elenco aceito da company, quando passado a `get_busy_workers`,
      então não é devolvido nem como ocupado nem como livre (sem oráculo).
- [ ] A7: Dado o Gestor em Configurações → Equipe, quando informa nome "Ana" + papel Encarregado e
      toca "Enviar por WhatsApp", então é criada linha `invited` com `expires_at ≈ now()+14 dias`,
      `invited_email` nulo, e abre `wa.me/?text=` contendo nome da empresa, papel e link
      `/convite-equipe/<token>` com token ≥ 32 caracteres aleatórios (não derivado de id).
- [ ] A8: Dado um convidado sem conta que abre o link, quando vê "Empresa X te convidou como
      Encarregado", informa o e-mail, recebe o código, confirma e aceita os Termos, então
      `accept_company_member_invite` ativa a membership (`status='active'`, `confirmed_at IS NULL`,
      token anulado), a sessão tem `user_type='hire'`, a casca de `companies` é removida, e a
      navegação cai em `/company/hoje` **sem** passar por `/company/onboarding`.
- [ ] A9: Dado o mesmo link aberto por uma segunda pessoa depois do aceite, então
      `token_already_used` e nenhuma segunda membership. Dado link vencido, `expired`. Dado link
      revogado, `revoked`. Dado token inexistente, resposta genérica (`not_found`).
- [ ] A10: Dado o e-mail do OTP pertencente a conta com linha em `workers`, quando aceita, então
      `worker_cannot_be_manager`, a UI mostra "Este e-mail já é de uma conta de freela. Use outro
      e-mail", e nada é criado.
- [ ] A11: Dado convite vencido, quando o Gestor toca "Reenviar", então o token antigo deixa de
      funcionar (`not_found`/`revoked`), o novo funciona e `expires_at` é renovado para +14 dias.
- [ ] A12: Dado Encarregado recém-aceito não confirmado, quando tenta ler `team_connections` ou dados
      de freela, então 0 linhas; o Gestor recebe notificação "Ana entrou, é ela?"; ao **Confirmar**, a
      leitura de Elenco passa a funcionar; ao **Revogar**, qualquer acesso cessa no próximo request.
- [ ] A13: **Remover não bloqueia.** Dado Encarregado E com 3 turnos abertos, 1 chamado aberto e 4
      freelas que ele trouxe ao Elenco, quando o Gestor confirma "Remover" (aviso informativo "3
      turnos abertos dele ficarão com você"), então `remove_company_member` retorna sucesso na
      primeira chamada, **sem** pedir destino; E fica `removed`; no próximo request E recebe 0 linhas
      em `jobs` operáveis/`applications`/`team_connections` e é negado em qualquer escrita; os 3
      turnos, o chamado e os pagamentos continuam existindo e o Gestor os opera como responsável
      efetivo (nenhuma linha de `jobs` foi reescrita); `display_name` de E segue no histórico.
- [ ] A13b: **Elenco permanece intacto.** Dado o mesmo cenário, então `team_connections` da company
      tem exatamente as mesmas linhas antes e depois da remoção (incluindo os 4 freelas que E trouxe,
      todos com `company_id` = company e `invited_by` = E), e nenhuma linha tem `company_id` igual ao
      uid de E.
- [ ] A13c: Dado E convidando freela ao Elenco (link/telefone), então o vínculo nasce `pending` com
      `company_id` da company (nunca o uid de E); E não consegue remover nem bloquear vínculo
      existente (negado pela RLS); veto `blocked` de freela segue indelével.
- [ ] A13d: **`invited_by` por trigger.** Dado E inserindo `team_connections` com `invited_by` forjado
      (uid de outra pessoa ou NULL) no payload, então a linha grava `invited_by = auth.uid()` de E;
      um UPDATE posterior de `invited_by` é rejeitado; e `pg_get_expr` das policies de
      `team_connections` (e de qualquer função de seam) não contém `invited_by`.
- [ ] A14: Dado E com 5 turnos, quando seleciona 2 e toca "Passar para Ana" (ferramenta opcional),
      então `moved=2`, os 2 somem da visão de E (viram "ocupado" para ele) e aparecem para Ana; origem
      e destino são notificados; E tentando passar turno que **não** é dele recebe `skipped`.
- [ ] A15: Dado "Cobrir Sabrina de 01/12 a 07/12" para Ana, quando Ana abre Hoje em 03/12, então vê os
      turnos de Sabrina daquele dia e pode operá-los; em 08/12 **não** vê nem opera (fim automático,
      sem job agendado); `jobs.responsible_id` continua sendo Sabrina; Sabrina e Ana foram
      notificadas na criação.
- [ ] A16: Dado turno com `responsible_id IS NULL` ou apontando para pessoa removida, quando o Gestor
      abre Hoje, então o card mostra "Gestor" (com "criado por {nome}" no segundo caso) e o filtro
      por Gestor o inclui; Encarregado não o vê em nenhuma lista.
- [ ] A17: Dado tag "Evento" com turnos históricos, quando o Gestor a arquiva, então ela some do
      seletor de novos turnos, permanece nos filtros/relatórios dos turnos antigos, e não existe
      caminho de DELETE (`DELETE` retorna erro de FK/sem policy).
- [ ] A18: Dado freela que cancela turno de E (status `hired`→`cancelled`), então notificações são
      criadas para E **e** para cada Gestor ativo e para o dono, sem duplicar quando E é Gestor; se E
      já foi removido, só os Gestores são notificados; cancelamento por service_role notifica ambos
      com texto neutro.
- [ ] A19: Dado dono único sem nenhum membro, então nenhuma tela mostra Equipe/tag/"Passar para"/
      "Cobrir"/campo Responsável, exceto a entrada "Equipe" em Configurações com um botão primário;
      após o primeiro convite, os elementos aparecem. A tela Equipe não contém matriz de checkboxes.
- [ ] A20: Dado `jobs` com SELECT `USING (true)` inalterado, quando se executa a auditoria
      `pg_policies`, então ela confirma explicitamente (e a spec/ADR registra) que o escopo por
      pessoa de turno alheio vale para `applications`/`shift_payments`/`shift_calls`/`shift_call_targets`
      e **não** para a linha de `jobs`; qualquer apertamento de `jobs` só entra com teste do feed do
      freela.
- [ ] A21: Auditoria de policies (`pg_policies` + `pg_get_expr`) após E3: nenhuma policy ou função das
      listadas em "Raio de alcance" usa `company_id = auth.uid()`/`owner_id = auth.uid()` para decidir
      acesso de empresa; todas passam pelo seam. Tabela ANTES/DEPOIS anexada ao PR.
- [ ] A22: Nenhuma tabela/RPC de saldo (`wallets`, `escrow_transactions`, `wallet_transactions`,
      RPCs de escrow) alterada (Article 8); em `shift_payments` mudam só predicados de policy e a
      ciência do trigger de imutabilidade sobre o novo ator, sem tocar colunas financeiras.
- [ ] A23: `cd frontend && npm run build` e `npm run lint` verdes (Article 3); testes Vitest para
      resolvedor de escopo, gate de `ProtectedRoute` por membership e fluxo de aceite; E2E (2 Chromes)
      cobrindo convite→OTP→Hoje, conflito→aviso e remoção de encarregado com turnos abertos e Elenco
      intacto.
- [ ] A24: **Guarda de vínculo por confirmação.** Dado Encarregado `active` com `confirmed_at IS NULL`,
      quando chama `count_worker_shifts_by_week(...)`, então recebe `{outcome:'not_confirmed'}` (não
      zero, não linhas); após o Gestor confirmar, a mesma chamada devolve a contagem da company
      inteira (incluindo turnos de outros responsáveis, só números por semana, sem job/título);
      Gestor/dono recebem a contagem sempre.
- [ ] A25: **`my_link_risk_config` sem escolha implícita.** Dado sessão que opera as companies U e V,
      quando chama `my_link_risk_config()` sem parâmetro, então `{outcome:'company_required'}` e
      nenhum limite; com `p_company_id=U` devolve o limite de U e com V o de V; dada sessão de uma
      só company, a chamada sem parâmetro devolve o limite dela; dado `p_company_id` de company que a
      sessão não opera (ou Encarregado não confirmado), nega sem vazar. No frontend, o aviso do
      `ShiftCallModal` usa o limite da **empresa corrente** selecionada (teste com duas companies
      de limites diferentes).
- [ ] A26: **Cancelar turno populado.** Dado Encarregado E com turno P (1 candidatura `hired`, 1
      `invited`, 1 chamado aberto, sem pagamento), quando E toca "Cancelar turno" e confirma, então
      `cancel_job` devolve `{cancelled_applications:2, cancelled_calls:1}`, `jobs.status='deleted'`,
      o freela `hired` e o `invited` recebem notificação "Turno cancelado pela empresa", o Gestor
      recebe notificação (rastro) e `team_connections` fica idêntico antes/depois. Dado o mesmo turno
      com `shift_payments` `recorded` ou candidatura `in_progress`, então a RPC recusa com `outcome`
      explícito e nada muda. Dado E tentando `UPDATE jobs SET status='deleted'` direto em turno com
      candidatura viva, então o trigger rejeita; em turno vazio, passa. Dado E tentando cancelar turno
      de outro responsável, `forbidden`.
- [ ] A27: Dado o Gestor cancelando turno de qualquer responsável por `cancel_job`, então vale o mesmo
      comportamento de notificação e a mesma recusa por pagamento ativo; estornar o pagamento
      continua só Gestor (R6).

## Out-of-scope

- Papel **Consulta** (fase posterior; sem valor dormente no CHECK).
- **Tag como regra de visibilidade** (campo existe; regra vem depois). Papel por tag. Pessoa em
  várias frentes além de filtro.
- Matriz de permissões/checkboxes; permissões customizáveis; hierarquia entre Encarregados.
- **Bloqueio ou migração forçada na remoção de pessoa** (decisão do dono): nenhuma transferência
  obrigatória, nenhum elenco por pessoa, nenhum "levar os freelas junto".
- Relatórios semanal por responsável/tag, taxa de falta por freela, custo por evento (fase
  posterior; ver tabela).
- Encarregado removendo/bloqueando freela do Elenco, rotacionando o link, **editando**
  `link_risk_alert_*`, séries recorrentes (v1.1) e parar série, chat da empresa, estorno de
  pagamento.
- Cancelar turno em lote ou por tag/pessoa; reabrir turno cancelado.
- Apertar o SELECT de `jobs` (decisão do architect; só com teste do feed).
- Convite por SMS/e-mail transacional (o Worki não tem e-mail transacional; só OTP do Supabase Auth)
  e envio automático via API do WhatsApp (só `wa.me` manual).
- Segunda unidade/multi-company por pessoa além do que a F13 já entrega; SSO; 2FA.
- Saldo, escrow, Asaas (Article 8; pagamento segue modo A).
- Conta de freela virar membro (Article 1; `worker_cannot_be_manager` mantido).

## Open items (defaults Assumidos valem se não houver resposta)

1. Encarregado pode **registrar** pagamento dos próprios turnos? (Assumido: sim; estorno só Gestor.)
2. Encarregado **remove/bloqueia** freela do Elenco? (Assumido: não, só Gestor; **trazer** freelas
   pode, por decisão do dono.)
3. Gestor convida Gestor? (Assumido: não; só dono/operador de organização.)
4. Tags: só Gestor cria? (Assumido: sim, para evitar proliferação.)
5. Aperto do SELECT de `jobs` agora ou ADR próprio? (Assumido: fora do v1; ver R9/A20.)
6. Encarregado confirmado lê o link de convite do Elenco da company? (Assumido: sim; revisão de
   segurança valida, já que o link é capacidade e a rotação segue Gestor-only.)
7. Encarregado cancela o próprio turno inteiro? (Assumido: sim, só por `cancel_job` com notificação
   aos freelas; ver R27. Se o dono preferir só Gestor, basta o trigger recusar `deleted` a não
   Gestor e esconder o botão.)

## Clarifications log

- Q: Há rodada de perguntas ao humano? → A: Não. O dono fixou as decisões; lacunas foram
  preenchidas como **(Assumido)** abaixo.
- Q: Remover pessoa exige transferir turnos antes? → A (correção do dono, 23/11): **Não.** Remover só
  corta acesso, imediato; turnos abertos ficam com o Gestor como responsável efetivo (regra do
  legado), nada é migrado à força; a quebra 2 fica resolvida por construção. "Passar para"/"Cobrir"
  são conveniência opcional. Aviso é só informativo. Substitui o desenho anterior desta spec
  (`has_open_shifts` + `p_transfer_to`).
- Q: De quem é o Elenco que o encarregado constrói? → A (decisão do dono): da **company**
  (`team_connections.company_id`), nunca da pessoa; sair não leva freelas; "cada um seguir" é só
  interface. Consequência (Assumido): Encarregado passa a poder **trazer** freelas (insert
  `pending`), mantendo remover/bloquear como Gestor; `invited_by` guarda rastro sem dar acesso.
- Q: Termos usados para as pessoas que o encarregado traz? → A (dono): sempre "freelas".
- Q: (evaluator a) Guarda de vínculo conta para "membro ativo" ou "confirmado"? Não confirmado conta 0
  ou a company inteira? → A (Assumido): **confirmado** (`is_company_member_confirmed`, o que o builder
  usou; G4 estava defasado). Contagem por freela nomeado é dado de carga de trabalho do mesmo nível do
  Elenco, fechado ao não confirmado por R22. Não confirmado recebe `not_confirmed`, **nunca 0** (zero
  silencioso = falso negativo de risco). Confirmado conta a company inteira, sem detalhe.
- Q: (evaluator b) `my_link_risk_config` e `LIMIT 1` com várias companies? → A (Assumido): recebe
  `p_company_id` explícito (`DEFAULT NULL`); sem parâmetro só resolve se a sessão opera exatamente uma
  company, senão `company_required` sem dados; frontend sempre passa a empresa corrente. Leitura para
  membro confirmado; escrita segue Gestor-only. Overload resolvido por DROP+CREATE.
- Q: (evaluator c) `invited_by` no WITH CHECK de `tc_insert_company` vs gate D8? → A (Assumido): vale
  D8. `invited_by` sai da policy; trigger BEFORE INSERT força `auth.uid()` e BEFORE UPDATE o torna
  imutável. Integridade do rastro sem acoplar autorização a campo de auditoria. D8 só ganha a
  cláusula "preenchido e travado por trigger".
- Q: (evaluator d) Encarregado pode cancelar o turno inteiro (UPDATE status='deleted')? → A (Assumido):
  **sim, nos próprios turnos, só pela RPC `cancel_job`** que cancela candidaturas (notificando
  freelas, Gestores e responsável), fecha chamados e só então marca `deleted`; recusa com pagamento
  ativo ou presença iniciada; trigger impede o UPDATE cru de não Gestor em turno com gente viva.
  Elenco intocado. Alternativa registrada nos Open items (7).
- Q: Valor armazenado do papel Gestor? → A (Assumido): mantém `'manager'` e só muda o rótulo de UI;
  evita migração de dados e quebra de funções que testam `role='manager'`.
- Q: Quem convida quem? → A (Assumido): Gestor convida Encarregado (e Consulta); só dono/operador de
  organização convida Gestor. Encarregado nunca convida pessoas da equipe. Evita escalada lateral.
- Q: Acesso antes da confirmação do Gestor ("é ele?")? → A (Assumido): acesso imediato a Hoje/próprios
  turnos, mas **sem** leitura de Elenco/dado de freela até confirmar; mitiga link vazado. Decisão do
  dono foi "Gestor confirma/revoga"; o gate de leitura é adição do clarifier (a validar).
- Q: Termos de uso para quem entra sem onboarding? → A (Assumido): aceite individual inline no
  convite, gravado em `company_members.accepted_tos_at`; o gate do Article 12 passa a ser por pessoa
  quando o usuário é membro, não pela linha de `companies`.
- Q: Convite sem e-mail; como contatar? → A (Assumido): `wa.me/?text=` sem telefone (Gestor escolhe o
  contato); e-mail só é coletado/verificado no OTP.
- Q: Como "Cobrir" termina sozinho? → A (Assumido): janela por data avaliada no seam (sem cron, sem
  reversão), máx. 60 dias; responsável registrado não muda.
- Q: Legado sem responsável e responsável removido? → A: ambos = Gestor efetivo (decisão do dono #6
  e #9); implementação sem escrita em `jobs` é Assumida.
- Q: Responsável do chamado? → A (Assumido): derivado do turno (`jobs.responsible_id`); não duplicar
  coluna em `shift_calls` (evita divergência); `shift_calls.created_by` já registra quem disparou.
- Q: Quais relatórios são v1? → A: nenhum relatório agregado; v1 = Hoje por pessoa + responsável
  visível + Passar para/Cobrir + conflito + convite novo (definido pelo dono); resto classificado
  como fase posterior.
- Q: Rota/local de "Hoje" e Configurações→Equipe? → A (Assumido): `/company/hoje` e
  `/company/configuracoes/equipe`; não encontrei página "Hoje" em `pages/company/`.
- Q: Valores pagos "só os do próprio" vs `jobs` público? → A: Garantia real por RLS em
  `applications`/`shift_payments`/`shift_calls`/targets; linha de `jobs` segue legível como hoje.
  **Lacuna declarada**, não escondida (A20).
- Q: Notificação ao Gestor hoje chega? → A: **Não verificado.** Pela descrição em `architecture.md`,
  notificações "à empresa" vão ao uid do dono; gerentes não recebem. R21 corrige via
  `notification_recipients_for_job`; mapeamento completo a cargo do architect.
- Q: Estado do catálogo? → A: Esta spec não consultou o banco de produção; funções/policies listadas
  vêm de migrations/ADRs e **devem ser confirmadas no catálogo** (aviso do topo de `architecture.md`).
  Os documentos de gate G4/D8 citados pelo evaluator não foram lidos aqui.
- Q: ADR? → A: Esta spec não grava ADR (fora do papel do clarifier). O resumo de risco está no
  cabeçalho e o ADR deve ser escrito pelo architect refletindo R17, R10b/R10c, R19 e R27.
