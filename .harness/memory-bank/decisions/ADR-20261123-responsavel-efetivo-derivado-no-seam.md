# ADR-20261123 — Responsável efetivo é derivado no seam; `is_job_owner` passa a significar "posso operar ESTE turno"

## Status
ACEITO (gate do architect, 23/11/2026). Cobre R19, R4 e R18 (cobertura) da spec
`equipe-encarregados`. Emenda o contrato de ADR-20260817-seam-autorizacao-empresa e
ADR-20260818-multi-unidade-hierarquia-empresa: o par continua mudando junto, mas deixa de ser
"duas perguntas iguais em granularidades diferentes".

## Contexto
Até hoje `is_job_owner(j) ≡ is_company_owner(jobs.company_id)`. Escopo por pessoa exige que um
Encarregado opere só os próprios turnos. Duas opções: (a) mudar o significado de `is_job_owner`
e herdar o escopo em todas as policies/RPCs que já o chamam; (b) criar `can_operate_job` e
re-apontar policy por policy. Turnos legados não têm `responsible_id`, e turnos de pessoa removida
precisam continuar operáveis por alguém sem escrita em `jobs` (ADR-20261123-remover-pessoa-so-corta-acesso).

## Decisão
1. **Opção (a).** `is_company_owner(c)` = "**Gestor** desta empresa" (dono, `manager` ativo,
   operador de organização). Encarregado **nunca** o satisfaz. `is_job_owner(j)` = Gestor da
   company do turno **OU** (`jobs.responsible_id = auth.uid()` **E** a sessão é `encarregado`
   ativo da company) **OU** cobertura ativa (`responsibility_coverages` com `to_user = auth.uid()`,
   `from_user = jobs.responsible_id`, `revoked_at IS NULL`, data local do turno em
   `[starts_on, ends_on]`, **e** `from_user` e `to_user` ambos membros ativos).
2. O cálculo vive num único helper DEFINER `session_can_operate_job(p_company_id, p_responsible_id,
   p_job_date)` — sempre sobre `auth.uid()`, nunca "por qual usuário perguntar" — chamado por
   `is_job_owner` **e** diretamente pelas policies de `jobs` com os valores da própria linha
   (`company_id`, `responsible_id`, data). Motivo: dentro de policy de `jobs`, `is_job_owner(id)`
   relê a tabela pelo snapshot do statement e não vê o `NEW` do UPDATE.
3. **Responsável efetivo** = `responsible_id` se for operador ativo da company; senão (NULL,
   removido, revogado) = Gestor. Não há backfill nem escrita: para o seam isso cai sozinho no ramo
   Gestor; para a UI, `get_my_companies`/RPC de listagem devolve o rótulo derivado.
4. Escrita de `responsible_id` só por: trigger BEFORE INSERT (`COALESCE(NEW.responsible_id,
   auth.uid())`, validação de operador ativo **só quando o valor muda**, sessão nula liberada) e
   `reassign_job_responsible` (DEFINER). Encarregado não troca `responsible_id`/`company_id` por
   PATCH direto (trigger recusa). Validação nunca escreve `company_id = auth.uid()` na mão.
5. Corpo `BEGIN ATOMIC` mantido nas duas funções; os helpers novos são criados **antes** e ficam
   registrados em `pg_depend`. Ordem de DOWN: `is_job_owner` → `is_company_owner` → helpers.
6. **Consequência deliberada de (a):** tudo que hoje chama `is_job_owner` herda escopo por pessoa.
   Onde a pergunta é de **empresa** e não de turno, a chamada tem de mudar para
   `is_company_owner`/`is_company_member` — o caso conhecido é `count_worker_shifts_by_week`
   (guarda F5 deve contar a company inteira). A lista completa está no parecer do gate.

## Consequências
### Positivas
- `shift_calls`, `shift_call_targets`, `shift_attendance_confirmations`, `applications`,
  `validate_application_update`, `cancel_shift_call`, `create_sos_call`,
  `request_attendance_confirmation` herdam o escopo sem reescrita.
- Remoção e fim de cobertura não exigem cron nem reversão.
### Negativas / Trade-offs
- `is_job_owner` deixa de ser substituível por `is_company_owner(jobs.company_id)`; qualquer leitor
  que assuma a equivalência erra. COMMENT das duas funções precisa dizer isso.
- Custo por linha maior (join em `company_members` e possivelmente em `responsibility_coverages`)
  em policies quentes (`applications`). Mitigar com curto-circuito: ramo Gestor primeiro; índices
  `company_members(user_id, company_id) WHERE status='active'` e
  `responsibility_coverages(to_user) WHERE revoked_at IS NULL`.
- Tabelas que ancoram em `company_id` direto (`shift_payments`, `service_terms`) precisam passar a
  ancorar em `job_id`, o que depende de `company_id` dessas linhas casar com `jobs.company_id`
  (verificação obrigatória no catálogo).
- `jobs` SELECT continua `USING (true)`: escopo por pessoa **não** protege título/budget da linha
  de `jobs` (lacuna declarada, A20). Apertar exige ADR próprio + teste do feed do freela.
  **B2 (security-reviewer, aceito):** isso inclui `jobs.responsible_id`, que passa a ser legível por
  qualquer autenticado como o resto da linha (um uuid de pessoa, pseudônimo, sem PII direta). Risco
  aceito conscientemente junto com A20; fecha-se no mesmo ADR que apertar o SELECT de `jobs`.
  `anonymize_account` anula `responsible_id` da pessoa anonimizada.

## Alternativas rejeitadas
- **(b) `can_operate_job` novo, `is_job_owner` Gestor-only**: ~25 pontos re-apontados à mão — é
  exatamente o padrão "cada camada reescreve a pergunta" que produziu os bugs de 24/08.
- **Backfill de `responsible_id` = dono nos legados**: escrita em massa em `jobs`, sem ganho; NULL
  já significa Gestor.
- **`responsible_id` com FK para `company_members`**: o dono não tem linha lá.
- **Cobertura com cron de expiração**: reversão por job agendado é falha silenciosa esperando
  acontecer; a janela por data é avaliada no próprio predicado.

## Referências
- Spec: .harness/spec/equipe-encarregados/spec.md (R3, R4, R18, R19, A1, A2, A15, A16)
- ADR-20260817-seam-autorizacao-empresa · ADR-20260818-multi-unidade-hierarquia-empresa
- Migrations: 20260818100200, 20260824000100–000300
