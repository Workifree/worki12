# Listas salvas do elenco (F2) — spec

## Context

Entrevista com sócio-operador de 10 unidades do Divino Fogão (17/08/2026): a dor #1 é disponibilidade, não
controle de gasto. O F1 ("Chamado de Turno" — `shift_calls`/`shift_call_targets`, PR #211) já resolve o
disparo 1→N com primeiro-aceite. Mas na operação real, às 8h30 com a loja abrindo às 11h, o gerente não vai
marcar 8 pessoas uma a uma no `ShiftCallModal` — ele precisa de um atalho por função ("Cozinha", "Salão",
"Chapa") que seleciona o grupo inteiro de uma vez. É também a pré-seleção que o entrevistado descreveu
espontaneamente: "eles faziam uma pré-seleção da lista de freelas com os quais eles querem trabalhar... no
dia de chamar, disparariam um comando no aplicativo".

Esta feature (F2) é puramente organizacional sobre o elenco já existente (`team_connections`): não cria
papel novo, não move dinheiro (Article 8 intacto), não muda a máquina de estados do F1. É uma camada de
agrupamento que acelera o gesto de seleção dentro do `ShiftCallModal` e um CRUD simples dentro de
`CompanyTeam.tsx` (`/company/team`, já existente — não é rota nova).

Todos os detalhes abaixo que o pedido original deixou em aberto foram fixados nesta spec e marcados
**(Assumido)** — não há perguntas pendentes ao humano.

## Requirements

- [ ] **R1 (Assumido — schema):** Nova tabela `team_lists`: `(id uuid PK, company_id uuid NOT NULL,
      name text NOT NULL CHECK (length(trim(name)) > 0), created_by uuid NOT NULL, created_at timestamptz
      DEFAULT now(), updated_at timestamptz DEFAULT now())`. RLS via nova função
      `is_company_owner(p_company_id uuid)` — SECURITY INVOKER, ancoragem DUPLA idêntica a `is_job_owner`
      (`company_id = auth.uid()` OU `company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())`),
      reaproveitando o padrão documentado em `20260817000100_shift_calls.sql` e a costura sinalizada para
      multi-unidade (F3). SELECT/INSERT/UPDATE/DELETE todos restritos a `is_company_owner(company_id)`; sem
      UNIQUE de nome (duplicidade permitida — ver Out-of-scope).

- [ ] **R2 (Assumido — schema):** Nova tabela `team_list_members`: `(id uuid PK, list_id uuid NOT NULL
      REFERENCES team_lists(id) ON DELETE CASCADE, worker_id uuid NOT NULL REFERENCES workers(id) ON DELETE
      CASCADE, added_at timestamptz DEFAULT now())`, UNIQUE `(list_id, worker_id)`. RLS: SELECT/INSERT/DELETE
      restritos a `is_company_owner` do `company_id` da lista (subquery em `team_lists`, sem risco de
      recursão — `team_lists` não referencia `team_list_members` na própria policy). Trava de lista fechada
      no INSERT, espelhando `shift_call_targets_insert`: só aceita `worker_id` com `team_connections.status =
      'accepted'` para a mesma empresa. Um freela pode estar em N listas (nenhuma exclusividade). Lista pode
      ficar/ser criada vazia (zero membros).

- [ ] **R3:** `frontend/src/services/teamListService.ts` (padrão de `teamConnectionService.ts` — Article 5,
      `.select('id')` + checagem de RLS silenciosa em toda escrita): `listLists()`, `createList(name,
      workerIds)`, `renameList(id, name)`, `setMembers(id, workerIds)` (diff: INSERT dos novos, DELETE dos
      removidos), `deleteList(id)`.

- [ ] **R4:** `frontend/src/types/index.ts` ganha `TeamList`, `TeamListMember`, `TeamListWithMembers`
      (`TeamList & { memberIds: string[] }`) — tipagem à mão (Article 2), sem `any`.

- [ ] **R5:** Nova seção "Listas do Elenco" em `frontend/src/pages/company/CompanyTeam.tsx`, abaixo de
      "Elenco Ativo": botão "+ Nova Lista", um card por lista (nome + "N membros"), ações "Editar" e
      "Excluir" por card. Mobile-first (Article 13): cards empilham em coluna única em telas estreitas,
      mesmo grid responsivo já usado pelo "Elenco Ativo".

- [ ] **R6:** Novo componente `frontend/src/components/team/TeamListModal.tsx` (criar/editar, mesmo modal
      para os dois modos): campo nome + checklist com busca do elenco aceito (`teamMembers` do
      `useCompanyTeam`), reaproveitando o padrão visual de busca/seleção do `ShiftCallModal` (busca por
      nome/função, neo-brutalista — bordas pretas 2px, `font-black uppercase`). Salvar com zero membros
      marcados é válido.

- [ ] **R7:** Excluir lista abre diálogo de confirmação com o texto explícito "Excluir esta lista não remove
      ninguém do Elenco" antes do `DELETE team_lists` (cascade cuida de `team_list_members`).

- [ ] **R8:** `frontend/src/components/team/ShiftCallModal.tsx` busca as listas da empresa
      (`TeamListService.listLists()`) no mesmo efeito que já carrega `TeamConnectionService.listTeamMembers()`.
      Se `lists.length > 0`, renderiza uma linha de chips entre o grid Motivo/Expira e a barra de
      busca+"Todos" já existente. Zero listas ⇒ nenhuma mudança visual (comportamento atual intacto).

- [ ] **R9:** Clique num chip calcula a interseção entre os `worker_id` da lista e o conjunto `available` já
      computado no modal (que já exclui `excludeWorkerIds` — quem já está no turno/já foi chamado). Se
      TODOS os disponíveis da lista já estão em `selected`, o clique os REMOVE de `selected`; caso contrário,
      o clique os ADICIONA a `selected` (união — não limpa seleção manual nem de outros chips).

- [ ] **R10 (Assumido — UX):** O chip mostra a contagem de DISPONÍVEIS, não o total de membros da lista
      (ex.: lista "Cozinha" com 6 membros e 5 disponíveis ⇒ chip "Cozinha (5)"). Se a interseção for vazia,
      o chip renderiza desabilitado (`opacity` reduzida, sem `onClick`) com "(0)".

- [ ] **R11 (Assumido — comportamento de membro fora do elenco):** Um `worker_id` que está em
      `team_list_members` mas cuja `team_connections` não é mais `'accepted'` (saiu, foi removido, ou
      bloqueou a empresa) é silenciosamente ignorado no cálculo do chip — sem erro, sem toast, sem limpeza
      automática da linha órfã em `team_list_members` (fica inerte; reaparece se o vínculo voltar a
      `'accepted'`). O filtro acontece só no client, contra o `available` já existente no `ShiftCallModal` —
      nenhuma query nova, nenhum trigger de limpeza.

- [ ] **R12:** `is_company_owner(p_company_id uuid)` é função nova (não é refactor de `is_job_owner` — ver
      Out-of-scope), documentada com o mesmo padrão de comentário/verificação (V1..Vn) e bloco DOWN dos
      arquivos `202608*_shift_calls*.sql`.

- [ ] **R13:** Migration precisa passar pelo gate `harness-architect` antes do `harness-builder` (regra do
      playbook para qualquer migration nova, independente de tocar saldo).

- [ ] **R14:** `cd frontend && npm run build` e `npm run lint` verdes. Cobertura Vitest co-located mínima:
      `teamListService.test.ts` (create/rename/delete/diff de membros) e um teste do
      `ShiftCallModal` cobrindo a lógica de interseção do chip (toggle liga/desliga, união com seleção
      manual, exclusão de indisponíveis).

## Acceptance criteria

- [ ] **A1:** Dado que a empresa está em `/company/team` sem nenhuma lista, quando clica "+ Nova Lista",
      digita "Cozinha", marca 3 membros do elenco aceito e salva, então uma linha nasce em `team_lists`
      (`name='Cozinha'`, `company_id` da empresa) e 3 linhas em `team_list_members`, o card "Cozinha (3
      membros)" aparece na seção "Listas do Elenco", e um toast de sucesso é exibido.

- [ ] **A2:** Dado a lista "Cozinha" com 3 membros, quando a empresa clica "Editar", desmarca 1 e marca
      outro que não estava, e salva, então `team_list_members` reflete exatamente o novo conjunto (1 DELETE
      + 1 INSERT via `setMembers`), sem tocar `team_connections`.

- [ ] **A3:** Dado a lista "Cozinha", quando a empresa clica "Excluir" e confirma no diálogo (que exibe o
      aviso "não remove ninguém do Elenco"), então a linha em `team_lists` é removida (cascade limpa
      `team_list_members`), o card some da tela, e os freelas que eram membros continuam normalmente em
      "Elenco Ativo".

- [ ] **A4:** Dado que a empresa cria a lista "Bar" sem marcar ninguém, quando salva, então `team_lists`
      ganha a linha e `team_list_members` não ganha nenhuma; o card mostra "0 membros".

- [ ] **A5:** Dado um freela X presente nas listas "Salão" e "Cozinha", quando se consulta
      `team_list_members`, então existem 2 linhas para o mesmo `worker_id` (uma por `list_id`), sem violar o
      UNIQUE `(list_id, worker_id)`.

- [ ] **A6:** Dado um turno com `slots=6` e a lista "Cozinha" com 6 membros todos aceitos no elenco, quando a
      empresa abre o `ShiftCallModal`, então um chip "Cozinha (6)" aparece entre o grid Motivo/Expira e a
      busca, sem nenhum membro pré-selecionado.

- [ ] **A7:** Dado o chip "Cozinha (6)" acima, quando a empresa clica nele, então os 6 membros entram em
      `selected` (checkbox marcado em cada linha correspondente na lista visível), o botão de disparo muda
      para "Chamar 6 freelas", e o chip passa ao estado visual ativo.

- [ ] **A8:** Dado o chip "Cozinha" ativo (6 selecionados via chip), quando a empresa clica nele de novo,
      então os 6 são removidos de `selected`, sem alterar seleções feitas manualmente fora da lista.

- [ ] **A9:** Dado que 1 dos 6 membros da lista "Cozinha" tem hoje `team_connections.status='blocked'` (saiu
      do elenco desde que a lista foi criada), quando o `ShiftCallModal` calcula o chip, então ele mostra
      "Cozinha (5)" e o clique seleciona só os 5 disponíveis, sem erro na tela.

- [ ] **A10:** Dado que 1 dos 6 membros da lista "Cozinha" já está no turno atual (presente em
      `excludeWorkerIds`), quando o chip é calculado, então esse membro é excluído da contagem e da seleção
      (mesmo efeito de A9) — chip mostra "Cozinha (5)".

- [ ] **A11:** Dado uma lista "Chapa" com 0 membros disponíveis para o turno atual, quando o modal renderiza
      o chip, então ele aparece desabilitado (sem `onClick` ativo) com "(0)".

- [ ] **A12:** Dado que a empresa seleciona manualmente 2 freelas fora de qualquer lista e em seguida clica
      no chip "Cozinha (5)", quando a seleção é recalculada, então os 2 manuais permanecem em `selected` e
      os 5 da lista são somados (união, não substituição).

- [ ] **A13:** Dado que a empresa B tenta ler ou escrever `team_lists`/`team_list_members` pertencentes à
      empresa A (via `supabase.from(...)` direto, contornando a UI), quando a query roda sob a sessão de B,
      então a policy `is_company_owner` nega (0 linhas / INSERT rejeitado), sem exceção não tratada.

- [ ] **A14:** Dado que a empresa tenta incluir na lista um `worker_id` cuja `team_connections` não é
      `'accepted'` com ela, quando o INSERT em `team_list_members` é enviado (via UI ou direto), então a
      policy de INSERT rejeita a linha (statement falha inteiro — mesmo comportamento documentado em
      `shift_call_targets_insert`), e a UI mostra toast de erro sem persistir parcialmente.

## Out-of-scope

- Multi-unidade/gerente (F3) — `is_company_owner` é só a costura, não a feature.
- Cores/ícones customizados por lista, reordenação/drag-drop, importar/exportar listas.
- Impedir nomes de lista duplicados (sem UNIQUE de `name`) — cosmético, não bloqueante nesta entrega.
- Sincronização automática de listas quando um freela sai/entra do elenco além do já descrito em R11
  (nenhuma limpeza automática de linhas órfãs em `team_list_members`).
- Refatorar `is_job_owner` para reusar `is_company_owner` internamente — função nova e independente; unificação
  é possível follow-up, não faz parte desta entrega.
- Notificar o freela quando é adicionado/removido de uma lista (lista é artefato interno da empresa, sem
  visibilidade do freela).
- Limite de quantidade de listas por empresa ou de membros por lista.
- Qualquer mudança em `shift_calls`/`shift_call_targets`/RPCs do F1 — F2 só lê `available` já calculado.

## Clarifications log

- Origem: requisitos já decididos pelo owner (entrevista 17/08/2026 + pedido explícito de F2). Nenhuma
  pergunta foi feita ao humano nesta rodada — decisões de detalhe fixadas acima como "(Assumido)":
  - Q (implícita): schema — nova tabela ou reusar `team_connections` com tag? → A: duas tabelas novas
    (`team_lists`, `team_list_members`), por clareza de RLS e por não sobrecarregar a aresta consentida
    worker↔empresa com um conceito organizacional que só a empresa vê.
  - Q (implícita): membro que saiu do elenco/já está no turno — bloqueia o chip, erro, ou filtra em
    silêncio? → A: filtra em silêncio contra o `available` já existente no modal (R9/R11) — zero query nova,
    zero erro visível, consistente com o tratamento atual de `excludeWorkerIds`.
  - Q (implícita): duplicidade de nome de lista — bloquear? → A: permitir (cosmético, fora de escopo).
  - Q (implícita): `is_company_owner` — vale a pena espelhar `is_job_owner`? → A: sim, função nova
    independente (R1/R12), aproveitando a costura que a migration `20260817000100` já sinalizou para
    multi-unidade.
