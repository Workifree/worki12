# ADR-20260622 — Aceite de convite push: transição worker `invited`→`hired` e guard de escrow postpago

## Status
ACEITO — 2026-06-22 (architect resolvendo findings do security-review do Slice 1, branch `feat/v1-loop-relacional`).
Complementa o ADR-001 (`.harness/spec/v1-operacao-freelancer/adr-001-conexoes-convite.md`).

## Contexto

O Slice 1 introduz o convite push: a empresa cria a application como `invited`, o freela aceita ou
recusa. O service `shiftInviteService.respondToInvite('accepted')` seta `applications.status='hired'`
(status canônico de "contratado para o turno", base de check-in/checkout e do lifecycle restante).

O security-review encontrou que dois triggers **pré-existentes e já deployados** quebram/distorcem esse
aceite:

1. **`validate_application_update`** (`20260311100000`, ~linha 69) lança EXCEPTION quando um *worker*
   seta `status IN ('approved','rejected','hired')` — regra correta do fluxo PULL (candidatura), onde só
   a empresa contrata. No fluxo PUSH, porém, o convite **já é** o consentimento da empresa em contratar;
   o aceite do freela apenas confirma. Sem ajuste, o aceite quebraria em produção.

2. **`auto_reserve_escrow_on_hire`** (`20260311200000`, AFTER UPDATE) dispara `reserve_escrow` sempre que
   `status` vira `hired`. O Slice 1 é **postpago** — escrow é Slice 2 (ADR-001 e cabeçalho da
   `20260622000100`). Se o aceite setasse `hired` sem guard, ele exigiria saldo pré-depositado da empresa
   e reservaria escrow, contrariando o modelo do piloto. Este consequente **não estava no finding
   original** — foi descoberto no recon dos triggers e é parte indissociável da decisão.

Restrição decisiva: tabelas/funções já estão em produção → **nova migration** (não edição in-place).

## Decisão

**Manter `hired` como o status de aceite** (o service não muda) e tornar a transição segura via nova
migration `20260622000300_invite_accept_hired_transition.sql`:

1. **`validate_application_update`** ganha uma exceção cirúrgica: worker pode `invited`→`hired` **somente**
   quando `OLD.status='invited' AND OLD.invited_by_company_at IS NOT NULL` (convite real). Toda outra
   tentativa de worker setar `hired`/`approved`/`rejected` segue bloqueada — o fluxo PULL não é afrouxado.

2. **`auto_reserve_escrow_on_hire`** ganha early-return: quando o `hired` vem de aceite de convite
   (`OLD.status='invited' AND NEW.invited_by_company_at IS NOT NULL`), **não** reserva escrow. O fluxo PULL
   (candidatura→contratação) continua reservando escrow exatamente como hoje. Slice 2 substitui este
   early-return pelo hook de pagamento postpago.

3. Ambas as funções recriadas passam a `SET search_path = ''` com refs schema-qualificadas (`public.*`),
   alinhando ao padrão do projeto enquanto eram reescritas.

**Instrução ao builder:** `respondToInvite('accepted')` deve continuar setando `status='hired'`. Nenhuma
mudança de service é necessária por esta decisão — o trigger foi ajustado ao redor do contrato existente.

Findings adjacentes resolvidos junto (sem ADR próprio — correções diretas, reversibilidade fácil):
`team_connections` GRANT service_role + remoção do FORCE RLS (in-place), bloqueio company `blocked→*`
(in-place), `search_path=''` nos triggers de rating (in-place), e bloqueio de auto-convite do worker via
`20260622000400` (nova migration, recria a policy de INSERT do worker).

## Consequências

### Positivas
- Aceite de convite funciona em produção sem novo status nem passo extra (modelo push permanece de 1 toque).
- Isolamento de papel preservado: a exceção é estreita (convite real comprovado por 2 condições de OLD).
- Postpago do Slice 1 fica intacto: convite aceito não reserva escrow; PULL segue reservando.
- Slice 2 tem um ponto de integração único e explícito (o early-return) para plugar o pagamento postpago.

### Negativas / Trade-offs
- `validate_application_update` e `auto_reserve_escrow_on_hire` agora carregam lógica de convite —
  acoplamento entre o gate de candidatura e o fluxo push. Mitigação: condições explícitas e comentadas;
  Slice 2 revisita o guard de escrow.
- A reversibilidade é "difícil" (objetos financeiro-adjacentes já deployados): por isso este ADR. O DOWN
  está documentado em cada migration (reaplicar as funções das `20260311100000`/`20260311200000`).
- A transição só é garantida no trigger (BEFORE UPDATE) — a RLS de UPDATE do worker continua não
  comparando OLD/NEW; a máquina de estados fina segue no service (consistente com o ADR-001).

## Alternativas rejeitadas
- **Aceite setar outro status permitido ao worker (ex.: `accepted`) e a empresa confirmar `hired` depois:**
  adiciona um segundo passo de confirmação que o modelo push não precisa (o convite já é o consentimento da
  empresa) e duplicaria notificações. Rejeitada por atrito de produto sem ganho de segurança real.
- **Inserir escrow no aceite (antecipar Slice 2):** fora de escopo do Slice 1 (postpago) e tocaria saldo —
  exigiria contrato de RPC e janela financeira. Rejeitada.
- **Bypass do trigger via service_role/Edge Function no aceite:** moveria operação de status para fora do
  client sem necessidade e contornaria o gate de validação por conveniência. Rejeitada (mantém o gate).

## Referências
- ADR base: `.harness/spec/v1-operacao-freelancer/adr-001-conexoes-convite.md`
- Spec: `.harness/spec/v1-operacao-freelancer/spec.md` (R5, R7, R8)
- Constitution: Art. 1 (isolamento de papel), Art. 8 (saldo só por RPC — Slice 1 não toca escrow).
- Migrations: `supabase/migrations/20260622000300_invite_accept_hired_transition.sql`,
  `supabase/migrations/20260622000400_block_worker_self_invite.sql`
- Triggers pré-existentes ajustados: `20260311100000_security_hardening_checkout_escrow.sql`,
  `20260311200000_auto_escrow_on_hire.sql`
