# ADR-20260816 — Veto do freela é indelével para a empresa (guarda de `blocked` no DELETE de `team_connections`)

## Status
ACEITO

## Contexto

`team_connections` (migration `20260622000000_team_connections.sql`) modela a aresta consentida
empresa↔freela. O estado `blocked` é, por desenho documentado na própria migration, **um veto explícito
do FREELA**: ele saiu da equipe ou bloqueou a loja. A migration implementa esse veto na policy de UPDATE:

```sql
-- tc_update_company
USING (company_id IN (...) AND status <> 'blocked')
```

com o comentário: *"A empresa NÃO pode desfazer esse bloqueio reconvidando (blocked→pending)."*

A policy de DELETE, porém, **não recebeu a mesma guarda**:

```sql
-- tc_delete_company (original)
USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));
```

Enquanto não existia caminho de DELETE no produto, o buraco era teórico. Com a entrega de
"remover freela do elenco" (`TeamConnectionService.removeFromTeam`, commit `d00cdfa4`), que faz
**DELETE físico** por `(company_id, worker_id)`, o bypass virou alcançável pela UI:

1. Freela bloqueia a empresa → linha `status='blocked'`, `blocked_by = <uid do worker>`.
2. Empresa faz `DELETE` da linha — permitido pela policy antiga.
3. Empresa faz `INSERT` de nova conexão — permitido por `tc_insert_company`, que só exige
   `status = 'pending'`.
4. O freela recebe de novo um convite de equipe de quem ele vetou.

O veto fica **decorativo**. É um problema de **consentimento** (LGPD/confiança, vetor de assédio),
não de UX. O bypass contradiz a intenção explicitamente documentada do próprio RLS.

**Restrição que o remédio não pode quebrar:** existe `UNIQUE (company_id, worker_id)`. O DELETE físico
é hoje o **único** jeito de a empresa reconvidar alguém que ela mesma removeu — caso legítimo e ativo
na UI (`CompanyTeam` → remover membro do elenco). Uma guarda ampla demais quebraria isso.

**Nota de escopo:** o bypass não dá acesso indevido a dados nem a convites de turno — a policy
`applications_insert_company_invite` (20260622000100) exige `team_connections.status = 'accepted'`,
e só o próprio worker consegue gravar `accepted`. O dano é a **reabertura de contato não consentida**.

## Decisão

Guardar o DELETE **pela autoria do bloqueio**, não pelo status puro:

```sql
DROP POLICY IF EXISTS "tc_delete_company" ON public.team_connections;
CREATE POLICY "tc_delete_company" ON public.team_connections
    FOR DELETE TO authenticated
    USING (
        company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
        AND (status <> 'blocked' OR blocked_by = auth.uid())
    );
```

- Linha bloqueada **pelo freela** (`blocked_by = worker`) → indelével e imutável para a empresa.
  Só o próprio freela sai de `blocked` (`tc_update_worker`).
- Linha bloqueada **pela própria empresa** (`blocked_by = auth.uid()` do owner) → ela pode deletar e
  reconvidar. Sem essa ressalva a empresa se **auto-trancaria**: `tc_update_company` permite gravar
  `blocked` (está no `WITH CHECK`), mas o `USING` a impede de sair desse estado — o DELETE é a única
  saída. Hoje nenhum caminho do frontend faz a empresa gravar `blocked` (só `blockConnection`, do
  worker, e sempre com `blocked_by` preenchido), mas a policy autoriza; a ressalva preserva o remédio.
- Remoção de membro `accepted`/`pending` + reconvite: **inalterada**.
- Linha legada `blocked` com `blocked_by IS NULL` → `blocked_by = auth.uid()` é NULL → DELETE negado
  (**fail-closed**): autoria desconhecida é tratada como veto do freela. Remediação de suporte via
  `service_role`, que bypassa RLS.

A guarda fica **na RLS**, não em trigger. `team_connections` referencia `workers`/`companies` com
`ON DELETE CASCADE`: um `BEFORE DELETE` que levantasse exceção em linha `blocked` quebraria a
**exclusão de conta** (direito de apagamento, LGPD) e a limpeza administrativa via Edge Function.
RLS aplica-se ao papel `authenticated`, que é exatamente a fronteira do ator "empresa".

## Consequências

### Positivas
- O veto do freela passa a ser **honrado nos dois verbos** (UPDATE e DELETE); a intenção documentada
  em 2026-06-22 vira garantia real.
- Superfície mínima: uma policy, sem mudança de schema, de dados, de RPC ou de tipos. Reversível em
  uma linha de SQL (bloco `DOWN` na migration).
- Article 8 intacto — nada de saldo/escrow.
- Não quebra o reconvite legítimo nem a exclusão de conta (cascade e `service_role` seguem livres).
- Semântica precisa: "a empresa não pode desfazer o veto **que não foi ela quem lançou**".

### Negativas / Trade-offs
- **DELETE negado é silencioso.** Em RLS, uma linha fora do `USING` não gera erro: o DELETE afeta 0
  linhas e o PostgREST responde 204. `removeFromTeam` hoje retorna `{ success: true }` nesse caso →
  a UI mostra "Freela removido do elenco" sem ter removido. Exige ajuste no service (ver abaixo);
  o impacto prático é baixo porque o botão "remover" só aparece em membros `accepted`
  (`listTeamMembers` filtra `status='accepted'`), então a negação só ocorre em corrida (o freela
  bloqueou entre o load e o clique).
- A linha `blocked` fica presa na tabela para sempre do ponto de vista da empresa (custo: 1 linha;
  benefício: preserva a auditoria de `blocked_by` e é o que sustenta o veto contra o UNIQUE).
- Linha legada `blocked_by IS NULL` fica indelével para a empresa (fail-closed deliberado).

## Alternativas rejeitadas

- **(a) `AND status <> 'blocked'` puro** (proposta do spec R6): correta hoje, mas trata bloqueio da
  empresa e veto do freela como a mesma coisa. No dia em que existir "empresa bloqueia freela"
  (a policy de UPDATE já autoriza), a empresa fica trancada sem remédio, com o UNIQUE impedindo
  qualquer reconvite. A versão adotada é a mesma regra + ressalva de autoria — custo zero, sem essa
  armadilha.
- **(b) Soft-remove (`status = 'removed'`)**: exigiria alterar o CHECK de `status`, `TeamConnectionStatus`
  em `types/index.ts` e revisar toda query que filtra `accepted`/`pending`/`blocked` (services, hooks,
  policy `applications_insert_company_invite`), no meio da revisão de piloto. Blast radius grande para
  um ganho — histórico da relação — que **não é o problema** deste ADR: o soft-remove sozinho não fecha
  o bypass (a empresa ainda teria que poder sair de `blocked` para reconvidar, ou o DELETE continuaria
  existindo). Fica disponível como evolução futura se auditoria de roster virar requisito.
- **Trigger `BEFORE DELETE` com `RAISE`**: dá erro alto e explícito (resolveria o silêncio do 204),
  mas atinge também `service_role` e o CASCADE de exclusão de conta → quebra apagamento LGPD.
  Rejeitado por reversibilidade e risco operacional.
- **Remover a policy de DELETE inteira**: quebraria o reconvite legítimo (UNIQUE) e a feature recém
  entregue.

## Gatilhos de reabertura
- Se surgir a feature "empresa bloqueia freela" gravando `blocked` pela empresa, revisar se a ressalva
  `blocked_by = auth.uid()` continua suficiente (ex.: exigir que a empresa só reabra bloqueio próprio
  depois de N dias) e garantir que `blocked_by` seja sempre preenchido.
- Se auditoria/histórico do roster (quem entrou/saiu quando) virar requisito de produto ou de
  compliance → reavaliar a alternativa (b) soft-remove com tabela de eventos, e então esta policy vira
  "DELETE proibido para todos".
- Se aparecer volume relevante de linhas `blocked` com `blocked_by IS NULL` em prod, decidir backfill de
  autoria em vez de manter o fail-closed.

## Referências
- Spec: `.harness/spec/revisao-piloto/spec.md` (R6 — gate obrigatório do architect)
- Migration: `supabase/migrations/20260816000000_team_connections_delete_guard_blocked.sql`
- Origem das policies: `supabase/migrations/20260622000000_team_connections.sql`
- Feature que expôs o bypass: commit `d00cdfa4` (`TeamConnectionService.removeFromTeam`)
- ADRs relacionados: `ADR-20260702-worker-join-by-invite-token.md` (a RPC `accept_company_invite_by_token`
  já respeita `blocked` — idempotente, não reabre), `ADR-20260622-aceite-convite-invited-hired.md`
