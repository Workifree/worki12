# ADR-20261123 — Elenco é um só, da company; `invited_by` é rastro, nunca autorização

## Status
ACEITO (decisão do dono, 23/11/2026; gate do architect na mesma data). Cobre R10b e R7 da spec
`equipe-encarregados`.

## Contexto
O Encarregado passa a trazer freelas para o Elenco (link de convite, telefone/Worki ID). Havia dois
modelos possíveis: elenco por pessoa (cada encarregado com o seu) ou elenco da company com rastro
de quem trouxe. O dono decidiu: o Elenco é da company, a saída de uma pessoa não leva nenhum
freela, e "cada um seguir os seus" é só filtro de interface.

Duas armadilhas conhecidas tornam isso uma decisão de segurança e não só de produto:
1. Já houve resolvedores no frontend que gravavam `company_id = user.id` (lição de 24/08). Para um
   Encarregado, `user.id` não é empresa nenhuma: o vínculo nasceria órfão ou, pior, apontando para
   uma "empresa" que é uma pessoa.
2. `team_connections.status='accepted'` concede leitura de PII do freela via
   `can_view_worker_profile` (ramo 1). Elenco compartilhado não pode significar PII compartilhada.

## Decisão
1. Todo vínculo criado por Encarregado grava `team_connections.company_id` = a company resolvida
   pelo seam (`get_my_companies` / `is_company_member`), nunca `auth.uid()`. A policy de INSERT
   exige `public.is_company_member_confirmed(company_id) AND status='pending' AND invited_by =
   auth.uid()`. Ramo antigo (`is_company_owner(company_id) AND status='pending'`) continua para o
   Gestor; `invited_by` é preenchido por trigger `COALESCE(NEW.invited_by, auth.uid())` para os dois.
2. `invited_by uuid NULL` é **só auditoria**: nenhuma policy, função ou RPC usa `invited_by` para
   conceder acesso. Asserção de gate: `pg_policies`/`pg_proc` não contêm `invited_by` em predicado
   de autorização (exceto o `= auth.uid()` do WITH CHECK do INSERT, que só impede falsificar o rastro).
3. Encarregado **não** faz UPDATE nem DELETE em `team_connections` (bloquear/remover é Gestor);
   as policies `tc_update_company`/`tc_delete_company` continuam em `is_company_owner`. A guarda do
   veto indelével do freela (20260816000000) fica intacta.
4. Leitura do Elenco por Encarregado **confirmado** (`confirmed_at IS NOT NULL`): `team_connections`,
   `team_lists`, `team_list_members` e `list_team_connection_cards()` (projeção fechada sem PII).
   O ramo 1 de `can_view_worker_profile` (elenco aceito → PII) **continua Gestor-only**; o
   Encarregado só lê PII pelo ramo 2 (vínculo operacional em turno que ele opera,
   `is_job_owner(job_id)`).
5. `company_invite_links`: leitura do token por Encarregado confirmado (o link é da company);
   `get_company_invite_token(p_company_id, p_rotate => true)` segue exigindo `is_company_owner`.
   Risco aceito: o Encarregado removido conhece um token que continua válido; a mitigação é a copy
   da tela de remoção oferecer "Gerar novo link" ao Gestor (não automático — rotacionar quebra
   links já enviados a freelas legítimos).
6. Remoção da pessoa (ADR-20261123-remover-pessoa-so-corta-acesso) não toca `team_connections`.

## Consequências
### Positivas
- A saída de uma pessoa nunca reduz o Elenco; A13b vira propriedade estrutural.
- PII continua seguindo o turno, não o Elenco: o Encarregado não varre CPF/PIX de quem nunca
  trabalhou num turno dele.
### Negativas / Trade-offs
- Um Encarregado pode poluir o Elenco com convites `pending` (só Gestor limpa). Aceito; teto
  anti-abuso fica para fase posterior se aparecer.
- Token do link de Elenco conhecido por ex-encarregado (item 5).
- `create_worker_referral` (indicação entre empresas) e `accept_company_invite_by_token` não mudam
  na v1: indicação continua Gestor-only. Se o dono quiser indicação por Encarregado, é extensão
  explícita, não herança.

## Alternativas rejeitadas
- **Elenco por pessoa**: freela "sairia" com o encarregado; contradiz a decisão do dono e quebraria
  o UNIQUE/consentimento de `team_connections` (o freela consentiu com a empresa, não com a pessoa).
- **`invited_by` como filtro de RLS para "meus freelas"**: transformaria rastro em autorização e
  faria a remoção da pessoa esconder freelas do sucessor.
- **Estender o ramo 1 de `can_view_worker_profile` a membro confirmado**: entregaria PII do Elenco
  inteiro a qualquer Encarregado; sem necessidade operacional (PIX é lido no turno).

## Referências
- Spec: .harness/spec/equipe-encarregados/spec.md (R7, R10b, A12, A13b, A13c)
- ADR-20260821-uuid-de-freela-nao-e-credencial-de-pii · migration 20260824000400 (link é segredo)
