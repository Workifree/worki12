# ADR-20261123 — Remover pessoa da equipe só corta o acesso; nada é migrado, nada bloqueia

## Status
ACEITO (decisão do dono, 23/11/2026; gate do architect na mesma data). Cobre R17 da spec
`equipe-encarregados`. Complementa ADR-20260822-fronteira-lgpd-multi-unidade (D1: vínculo de
operação é soft-remove) e ADR-20261123-responsavel-efetivo-derivado-no-seam (R19).

## Contexto
A feature "Equipe e encarregados" dá a cada turno um `responsible_id` (pessoa). A primeira versão
da spec exigia transferir os turnos abertos antes de remover a pessoa (`has_open_shifts` +
`p_transfer_to`). O dono corrigiu: turnos, chamados e Elenco são da **company**; a saída de uma
pessoa não pode depender de uma faxina prévia (o caso real é "o encarregado foi demitido hoje", e
cortar o acesso é urgente — é segurança, não organização).

A F13 já fixou que `company_members` nunca sofre `DELETE` (`revoke_company_manager`,
`ON DELETE RESTRICT`, ADR-20260822 D1).

## Decisão
1. `remove_company_member(p_company_id, p_user_id, p_dry_run)` (DEFINER, `search_path=''`) só faz
   `status='removed'`, `removed_at=now()`, `invite_token=NULL`. **Nunca** é recusada por haver
   turno aberto, chamado aberto, pagamento agendado ou freela trazido por ela.
2. O corte de acesso é **consequência do seam**, não de escrita em dado: todo ramo de autorização
   de pessoa (`session_operates_company_membership`, o ramo de responsável/cobertura de
   `is_job_owner`, `session_company_member_role`) exige `status='active'`. No request seguinte a
   pessoa não opera nada. Sessão JWT viva não importa: o JWT diz quem ela é, não o que ela opera.
3. **Nenhuma linha de `jobs`, `shift_calls`, `applications`, `shift_payments`, `team_connections`
   ou `responsibility_coverages` é reescrita.** `responsible_id` continua apontando para ela
   (rastro); a regra de R19 trata o turno como do Gestor.
4. `p_dry_run=true` devolve `{open_jobs}` para a copy informativa ("N turnos abertos dele ficarão
   com você"). Mesmo predicado, sem escrita (padrão de `update_job_series_future`).
5. Quem remove: Gestor remove Encarregado; só dono/operador de organização remove Gestor
   (simetria com "Gestor não convida Gestor"). Ninguém remove a si mesmo por esta RPC se for o
   último Gestor (o dono nunca está em `company_members`, então sempre resta ao menos ele).
6. Re-convidar a mesma pessoa cria **nova** linha `invited`; a `removed` fica como histórico.
   Consequência de schema: o índice `uq_company_members_company_user (company_id, user_id)` precisa
   virar parcial `WHERE status <> 'removed'`, senão o aceite de um novo convite para a mesma pessoa
   viola o UNIQUE. (Condição do gate para E4.)

## Consequências
### Positivas
- Remoção é instantânea e de um gesto; não existe estado "não consigo remover porque ...".
- Nenhum dado de terceiro (freela) muda por causa de um evento interno da empresa.
- Reversível por operação, não por migration: re-convidar devolve o acesso sem perda de histórico.
### Negativas / Trade-offs
- Turnos do removido ficam sem "dono humano" até o Gestor agir; a UI precisa mostrar "Gestor".
- Notificações destinadas ao responsável passam a ir só aos Gestores (R21) — exige que
  `notification_recipients_for_job` aplique a mesma regra de membership ativa.
- O índice único parcial é mudança de schema em tabela de autorização: entra em E4, antes do
  primeiro aceite, nunca depois.

## Alternativas rejeitadas
- **Transferência obrigatória antes de remover**: transforma corte de acesso em tarefa
  administrativa e mantém a pessoa demitida operando enquanto alguém não faz a faxina.
- **Reescrever `responsible_id` para o Gestor na remoção**: destrói o rastro de quem criou, exige
  escolher "qual Gestor" e não é reversível; a derivação no seam resolve sem escrita.
- **`DELETE` em `company_members`**: contradiz F13 e ADR-20260822 D1.
- **Invalidar sessões no Auth**: não é necessário (o seam já nega) e o Worki não tem service_role
  no client para isso.

## Referências
- Spec: .harness/spec/equipe-encarregados/spec.md (R17, R19, A13, A13b)
- ADR-20260822-fronteira-lgpd-multi-unidade · ADR-20261123-responsavel-efetivo-derivado-no-seam
