# ADR-20261123 — Encarregado só opera depois de confirmado; PII do freela segue o turno trabalhado

## Status
ACEITO (parecer do architect sobre os achados 2, 3, 10 e 11 do evaluator nas migrations E0–E3,
23/11/2026). Complementa ADR-20261123-elenco-unico-da-company (decisão 4) e corrige G8 do
`.harness/spec/equipe-encarregados/gate-architect.md`.

## Contexto
O evaluator encontrou quatro problemas nas migrations `20261123000100`–`000400`:

- **Achado 2.** `session_can_operate_job` (E2:125-127) aceita encarregado com
  `session_company_member_role = 'encarregado'` sem olhar `confirmed_at`. Ele alimenta `is_job_owner`
  e o ramo 2 de `can_view_worker_profile` (E3:450-451). O abuso: alguém com um link de convite vazado
  aceita o convite, cria um turno com menos de 4h de antecedência e chama `create_sos_call` (que só checa
  `is_job_owner`). Freelas de fora do Elenco aceitam, cada aceite vira uma linha em `applications`, e o
  invasor lê CPF, PIX e telefone deles sem que o Gestor tenha confirmado quem ele é. Isso contradiz A12. A
  spec se contradiz: R22 dá acesso aos próprios turnos, A12 diz "0 dados", e a linha 110 diz "ativo e
  confirmado".
- **Achado 3.** Mesmo confirmado, o encarregado consegue PII do Elenco inteiro: basta convidar cada
  freela para um turno dele e cancelar. O ramo 2 não filtra `applications.status`. Isso esvazia a decisão 4
  do ADR elenco-unico. Restrição do dono: o encarregado registra o pagamento dos próprios turnos, então
  precisa do PIX de quem de fato trabalhou neles.
- **Achado 10.** R8 inclui o operador de organização em "Gestor", e R21 manda avisar "todos os Gestores
  ativos". O builder deixou os operadores de organização fora dos avisos.
- **Achado 11.** A premissa de G8 era falsa. A guarda de LGPD de `20260821000000` compara nomes de
  coluna por igualdade exata e roda uma única vez, num bloco `DO`. Com isso, `from_user_id`/`to_user_id`
  não caem no vocabulário, e tabelas criadas depois não são reavaliadas.

## Decisão
1. **Confirmação é pré-requisito de TODA operação do encarregado (achado 2).** No ramo de encarregado de
   `session_can_operate_job`, `session_company_member_role(...) = 'encarregado'` passa a exigir também
   `public.session_company_member_confirmed(p_company_id)`. Um encarregado não confirmado opera zero
   turnos, cria zero turnos, dispara zero SOS e lê zero dados de freela. Vale A12; R22 passa a ler
   "encarregado ativo **e confirmado**". O sintoma não é corrigido só no ramo de PII e no SOS: o seam é
   um só, e um ramo parcial abriria o próximo buraco por outro consumidor de `is_job_owner`.
   - `internal_company_active_operator` continua respondendo "a pessoa está ativa" **sem** exigir
     confirmação. Ela serve à validação de `responsible_id` e à cobertura, onde "ativo" é a pergunta
     certa. Ganha porém um par explícito, `internal_company_confirmed_operator(company, user)` (INTERNA,
     mesmo REVOKE), que é o que passa a valer em três lugares:
     (a) o trigger que valida `jobs.responsible_id`: não se atribui turno a encarregado não confirmado;
     (b) o `from_user_id` da cobertura em `session_can_operate_job`;
     (c) a escolha de destinatários de aviso.
     Dono, manager e operador de organização entram como confirmados por definição. Para não haver dois
     cálculos, `internal_company_confirmed_operator` = `internal_company_active_operator` AND (não é
     encarregado OR `confirmed_at IS NOT NULL`).
   - Quem cobre (`to_user_id`) já é a própria sessão e passa pela mesma exigência do item acima.
2. **O ramo 2 de `can_view_worker_profile` fica estreito e diferente para o encarregado (achado 3).**
   - Gestor: o ramo 2 fica como está hoje (`is_company_owner`, qualquer `applications`), sem regressão.
   - Encarregado confirmado: lê o freela apenas se há `applications` com
     `status IN ('hired','in_progress','completed')` em um turno que `session_can_operate_job` aceita, e
     nunca por `invited`, `declined` ou `cancelled`. Um cancelamento depois do `hired` não "devolve" a
     leitura histórica de um turno concluído, mas um cancelamento de quem só foi convidado nunca concede
     nada.
   - **Projeção.** `can_view_worker_profile` é um predicado de linha e não corta colunas, então a linha
     de `workers` lida pelo encarregado continuaria trazendo CPF e data de nascimento. Decisão: o
     encarregado **não** usa o ramo 2 de `can_view_worker_profile`. Ele lê por uma RPC DEFINER de
     projeção fechada, `get_shift_worker_payment_card(p_job_id)`, que devolve nome, avatar, telefone e
     `pix_key`, apenas para freelas em hired/in_progress/completed daquele turno. CPF e `birth_date`
     ficam Gestor-only. O ramo 2 da função volta a ser `is_company_owner(j.company_id)` (o corpo
     anterior a E3). Telefone fica na projeção porque o encarregado precisa avisar o freela pelo
     WhatsApp (fluxo "Presença e Pagamento").
   - SOS: `create_sos_call` passa a exigir `is_job_owner` (já exige) e, por herança do item 1,
     confirmação. Não ganha nada além disso: o freela de SOS que aceitou entra em `hired` e cai na
     projeção fechada como qualquer outro.
3. **Avisos de Gestor: vale R21, com escopo (achado 10).** "Todos os Gestores ativos" inclui o operador
   de organização (R8 manda). Para conter o fan-out, o destinatário é o operador de organização com
   `om.role IN ('owner','operator')` e `status='active'` da organização dona **daquela** company. Não
   entram os membros de todas as unidades da organização, e a mesma pessoa é deduplicada por
   `DISTINCT user_id` com dono e manager. Se o fan-out real incomodar, uma preferência de aviso por
   pessoa é extensão futura, não exclusão silenciosa.
4. **LGPD: cobertura explícita, não por vocabulário (achado 11; corrige G8).** As tabelas e colunas
   novas de E1 entram **nominalmente** no corpo de `anonymize_account` (`CREATE OR REPLACE`, partindo do
   corpo do catálogo de produção, não do arquivo de 20260821):
   - `company_members` da pessoa: `display_name := NULL`, `accepted_email := NULL`,
     `status := 'revoked'`;
   - `responsibility_coverages` em que a pessoa é `from_user_id` ou `to_user_id`: `revoked_at := now()`
     (sem DELETE: é auditoria, então sem CASCADE);
   - `jobs.responsible_id` = a pessoa: `NULL` (o seam cai no Gestor, conforme
     ADR-20261123-responsavel-efetivo-derivado-no-seam);
   - `team_connections.invited_by` = a pessoa: `NULL`.
   Junto, uma asserção de gate na própria migration: um bloco `DO` que falha
   (`RAISE EXCEPTION`) se o corpo de `anonymize_account` não contiver cada uma dessas tabelas. Também é
   preciso conferir se `lgpd_guard_auth_user_delete` trata `company_members` com `role='encarregado'`
   como "perfil vivo". A guarda por vocabulário de 20260821 **não** é estendida nem confiada para
   tabelas novas.

5. **Nota (E4): o convite novo por link só cria encarregado.** `invite_company_member` /
   `accept_company_member_invite` aceitam apenas `role='encarregado'`. Gestor (manager) continua só pelo
   convite por e-mail do F13 (`invite_company_manager` / `accept_company_invite_by_token`). Isso fecha
   o risco de "Gestor por link sem confirmação": um link vazado no máximo gera um encarregado, que
   opera zero até ser confirmado (item 1). A prévia pública desse link está em
   ADR-20261123-previa-publica-do-convite.

## Consequências
### Positivas
- Um link de convite vazado não compra nada antes da confirmação do Gestor: A12 vale por construção, no
  seam.
- Convidar e cancelar deixa de ser oráculo de PII. CPF e data de nascimento nunca chegam ao
  encarregado. O PIX chega só a quem paga, sobre quem trabalhou.
- A anonimização das tabelas novas é verificável por asserção, não presumida por convenção de nome.
### Negativas / Trade-offs
- O encarregado aceito e ainda não confirmado vê uma tela vazia ("aguardando confirmação do Gestor").
  Isso exige copy e um aviso ao Gestor para confirmar.
- Mais uma RPC de projeção para manter. O frontend do encarregado não pode usar o embed
  `worker:workers(...)` nas telas de turno e precisa usar a RPC (o embed volta `null` pela RLS).
- O operador de organização recebe avisos de cada unidade da organização.
- Toda tabela futura com coluna de pessoa precisa entrar à mão em `anonymize_account`. A asserção
  pega só as tabelas listadas, então o checklist do architect passa a cobrar isso.

## Alternativas rejeitadas
- **Confirmação só no ramo de PII e no SOS**: o não confirmado ainda criaria e operaria turnos, chamaria
  freelas e geraria notificações em nome da empresa. Manter um seam com exceções parciais repete a lição
  de 24/08.
- **Ramo 2 com filtro de status, mas lendo `workers` inteiro**: um predicado de linha não esconde
  colunas, e CPF e data de nascimento iriam junto.
- **Excluir o operador de organização dos avisos**: contradiz R8/R21 em silêncio. Fan-out se resolve com
  escopo e dedupe, não com omissão.
- **Renomear colunas para "cair no vocabulário" (G8 original)**: a guarda compara por igualdade exata e
  roda uma vez, então não cobre tabela nova. A premissa era falsa.

## Referências
- Spec: .harness/spec/equipe-encarregados/spec.md (R8, R21, R22, A12, linha 110)
- Gate: .harness/spec/equipe-encarregados/gate-architect.md (G8, corrigido por este ADR)
- Migrations: 20261123000200 (E1, `internal_company_active_operator`), 20261123000300 (E2:125-147),
  20261123000400 (E3:426-465); 20260821000000 (guarda LGPD, :239-245 e :555)
- ADR-20261123-elenco-unico-da-company (decisão 4) · ADR-20261123-responsavel-efetivo-derivado-no-seam
