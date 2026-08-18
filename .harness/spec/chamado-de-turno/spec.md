# Spec — Chamado de Turno (disparo 1→N com primeiro-aceite)

> Feature F1 do backlog pós-entrevista Divino Fogão (17/08/2026). Slug: `chamado-de-turno`.
> Tipo: feature (L). Branch: `feat/chamado-de-turno`.

---

## Context

### O problema, na voz do cliente

Sócio-operador de 10 restaurantes (Divino Fogão Centro-Oeste), entrevistado em 17/08/2026:

> "A operação começa às 8 da manhã pra loja abrir às 11. Lá pelas 8h30 o gerente vê que houve uma quebra
> — os funcionários não vieram. Ele liga pra alguém de confiança, o cara chega por volta das 11."
>
> "Se o aplicativo pudesse **oferecer a vaga pra vários freelancers cadastrados simultaneamente**, sem
> segurar a vaga por uma ou duas horas enquanto o cara não aceita — **o primeiro que aceitar preenche a
> vaga**, mais ou menos como o Uber faz. Isso facilitaria muito o trabalho dos gerentes."

Ele nomeia essa como **a dor principal** ("alta disponibilidade"), acima de controle de gasto e de risco
trabalhista. É o gesto que decide o piloto.

### O que existe hoje (e por que não serve)

`ShiftInviteService.inviteWorkerToShift(jobId, workerId)` — **um convite, um freela, por vez**, com
expiração default de **48h**. Quatro superfícies chamam isso: `CompanyCreateJob`, `CompanyJobs`,
`CompanyTeam` (`InviteToShiftModal`) e `CompanyJobCandidates` (reabertura de vaga).

Três bloqueios concretos:

1. **Não existe vaga.** `jobs` não tem contagem de posições (`slots`/`workers_needed` não existem no
   schema). Sem isso não há o que "preencher" nem como fechar.
2. **Não existe corrida.** `respondToInvite` valida a transição **no client** (fetch + update). Dois
   aceites simultâneos hoje geram dois contratados para a mesma vaga.
3. **O perdedor é queimado.** `applications` tem `UNIQUE(job_id, worker_id)` e cancelar convite move para
   `'cancelled'`, que é **irreversível**. Num disparo para 8 pessoas, os 7 que não aceitaram ficariam
   permanentemente inelegíveis àquele turno — inclusive se o vencedor cancelar depois e a vaga reabrir.

### Decisão de modelagem (justifica o custo)

**Tabelas novas (`shift_calls` + `shift_call_targets`); só o vencedor gera `applications`.**

A alternativa (estender `applications` com `call_id` e um status de perdedor) foi descartada: o
`UNIQUE(job_id, worker_id)` queimaria os perdedores, e apagar as linhas dos perdedores para liberar o
UNIQUE destruiria justamente o histórico de "quem foi chamado, quem respondeu, em quanto tempo" — que é o
insumo dos analytics (F5) e do ranking da descoberta automática (F7).

Consequência boa: `applications` permanece o que a ADR-001 quis que fosse — o **contrato do turno**, não
o registro da tentativa.

### Landmines verificados neste levantamento

- `trg_auto_reserve_escrow_on_hire` é **AFTER UPDATE** (`20260311200000`, redefinido em `20260622000900`).
  O aceite aqui **insere** a application já com `status='hired'` → o trigger não dispara → **nenhum escrow,
  sem precisar de flag**. Article 8 intacto. (Confirmar no gate do architect.)
- `jobs.company_id` tem **ancoragem dupla** em produção (`= auth.uid()` OU `IN (SELECT id FROM companies
  WHERE owner_id = auth.uid())`) — ver `20260816210000`. Toda policy nova deve repetir as duas pernas.
- RLS de `jobs` foi ligada em 16/08/2026 com `SELECT USING (true)`; subqueries de policy sobre `jobs`
  mantêm a semântica atual.
- A policy `applications_insert_company_invite` (`20260622000100`) exige `status='invited'`. O insert do
  vencedor é `status='hired'` e virá de RPC **SECURITY DEFINER** — não passa por essa policy.
- `UPDATE`/`DELETE` sob RLS que não casa com o `USING` retorna 0 linhas **sem erro** (padrão
  `removeFromTeam`): todo write no service precisa de `.select('id')` e checagem de linhas afetadas.

---

## Requirements

**R1 — Turno tem vagas.**
`jobs.slots` (int, NOT NULL, DEFAULT 1, CHECK >= 1). Turnos existentes recebem 1 no backfill. A tela de
criação/edição do turno permite definir quantas pessoas o turno precisa.

**R2 — Um único gesto para 1 ou N.**
A empresa seleciona de 1 a N freelas do **elenco aceito** e dispara **um chamado** para um turno. Chamado
com 1 alvo é exatamente o convite individual de hoje — não existem dois fluxos, existe um só. A seleção
oferece "selecionar todos" e filtro por função.

**R3 — Expiração curta, escolhida no disparo.**
Opções: 30min · 1h · 2h · 6h · 24h · até o início do turno. **Default 2h** (hoje são 48h — é o
comportamento que o cliente criticou nominalmente). Chamado expirado não aceita mais resposta.

**R4 — Primeiro-aceite atômico.**
Com 1 vaga e dois aceites simultâneos, exatamente **um** vira `hired`; o outro recebe "vaga preenchida".
Garantido por RPC Postgres com lock de linha — **nunca** por checagem no client.

**R5 — Perdedor não é punido nem queimado.**
Alvo que não ganhou fica `closed` — não `declined`, não `cancelled`. Continua **elegível** a ser chamado
de novo para o mesmo turno se a vaga reabrir. Nenhum efeito em reputação, XP ou métrica do freela.

**R6 — Recusa continua neutra.**
Recusar explicitamente (`declined`) não gera punição — preserva R7 do Slice 1.

**R7 — Preenchimento parcial.**
Turno com N vagas: o chamado segue aberto até preencher N ou expirar. Cada aceite consome uma vaga. A
empresa vê "2 de 3 preenchidas".

**R8 — Visão do freela.**
O chamado aparece onde o convite já aparece (`Dashboard`, `MyJobs`, `InviteTakeover`), com dois sinais
honestos: **é disputado** ("outros freelas também receberam") e **contagem regressiva** até expirar.
Convites legados (`applications.status='invited'`, que existem em produção) continuam aparecendo e
funcionando pelo caminho antigo — sem migração de dados.

**R9 — Visão da empresa.**
Na tela do turno: quem foi chamado, quem respondeu o quê, quem ocupou a vaga, **quanto tempo levou** do
disparo ao primeiro aceite, e quantas vagas faltam. Ação de **cancelar o chamado**, que fecha todos os
alvos pendentes.

**R10 — Notificação pelos canais atuais.**
No disparo, cada alvo recebe notificação in-app + e-mail (`send-notification`), como hoje. Ao fechar, os
alvos pendentes recebem "vaga preenchida" in-app. **WhatsApp e push ficam fora desta feature** (decisão do
owner, 17/08/2026).

**R11 — Zero impacto financeiro.**
Nada de saldo, escrow, `wallet_transactions` ou `shift_payments`. O pagamento segue o modo A.

**R12 — RLS.**
Chamado: criado/lido/cancelado apenas pela empresa dona do turno (ancoragem dupla). Alvo: lido pelo próprio
freela e pela empresa dona. Reivindicar a vaga: só quem é alvo do chamado, via RPC.

---

## Acceptance

1. **Corrida:** duas sessões chamam `claim_shift_slot` no mesmo chamado de 1 vaga em paralelo → exatamente
   1 `applications` com `status='hired'`; a outra recebe `outcome='filled'`. Provado por SQL com duas
   transações concorrentes.
2. **Sem escrow:** após o aceite, `escrow_transactions` e `wallet_transactions` não ganham nenhuma linha
   nova para aquele job.
3. **Perdedor reutilizável:** fechado o chamado, um alvo `closed` pode ser incluído num novo chamado do
   **mesmo** turno e aceitar normalmente.
4. **Expiração:** chamado com janela de 30min não aceita resposta em 31min → `outcome='expired'`; a vaga
   volta a aparecer como não preenchida para a empresa.
5. **Parcial:** turno com 3 vagas e 5 alvos → após 3 aceites o chamado vira `filled` e os 2 restantes veem
   "vaga preenchida".
6. **Legado intacto:** um `applications.status='invited'` criado antes desta feature continua listado e
   respondível pelo freela.
7. **Isolamento:** freela que não é alvo chamando a RPC recebe `outcome='not_target'` e nenhuma escrita
   acontece; empresa A não lê chamado de empresa B.
8. **Elenco fechado:** não é possível incluir no chamado alguém sem `team_connections` `accepted`.
9. `cd frontend && npm run build` e `npm run lint` verdes; testes do `shiftInviteService` seguem passando.

---

## Não-objetivos (explícitos)

WhatsApp/push · geolocalização e descoberta automática (F7) · troca entre empresas (F6) · guarda de
vínculo (F2) · multi-unidade e gerentes (F3) · certificações (F4) · analytics (F5) · escala recorrente ·
listas salvas do elenco · tarifa padrão · teto de % da folha.
