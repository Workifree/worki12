# Integração da criação rápida de turnos (edições em arquivos existentes, ainda NÃO feitas)

Contexto: E2-E5 já estão aplicadas em produção (o PRD supõe o contrário). Ordem obrigatória:
**migration antes do frontend**.

## 1. Banco
- Aplicar `supabase/migrations/20261128000100_criacao_lote_turnos.sql` (dirigido, nunca `db push`).
  Gate architect + security antes. Ela para sozinha (HALT) se a policy de INSERT de `jobs` ou o
  trigger `jobs_responsible_guard` não forem os esperados no catálogo.
- Teste: `npx -y -p @electric-sql/pglite@0.6.0 node supabase/tests/pglite-lote/run.mjs`.
- Assinatura: `create_jobs_batch(p_client_batch_id, p_company_id, p_template, p_rows, p_series DEFAULT NULL)`.
  `p_series` é o acréscimo ao PRD: a série passa a ser idempotente (delega a `create_job_series`).

## 2. Frontend (arquivos existentes)
| Arquivo | Mudança |
|---|---|
| `App.tsx` | `const CompanyCreateBatch = lazy(() => import('./pages/company/CompanyCreateBatch'));` e, sob `/company`, `<Route path="create" element={titled('Criar turno', <CompanyCreateBatch />)} />` no lugar do atual. `jobs/:id/edit` continua em `CompanyCreateJob`. A página já lê `?repetir=`. |
| `pages/company/CompanyCreateJob.tsx` | Depois da troca de rota fica só para edição: remover criação, modelos, série e painel de convite (e os testes correspondentes). |
| `types/index.ts` | Reexportar os tipos `ShiftDraft*` de `lib/shiftDrafts` (não duplicar) e somar `creation_batch_id?`, `creation_row?` em `Job`. |
| `CompanyJobs`, `CompanyToday` (R1.5) | Selecionar `creation_batch_id` (só após a migration, senão 42703) e agrupar com "Lote de dd/MM · N turnos · M vagas". |
| `layouts/CompanyLayout` / `BottomNav` | Opcional (wireframe): ocultar a BottomNav nesta tela. Hoje a `ActionBar` fica acima dela. |
| `e2e/criacao-lote.spec.ts` | Criar depois da rota. Medir A11 com o harness-tester a 390px e conferir 320px. |

`lib/jobDraft.ts` não precisa mudar: o rascunho v2 usa `jobDraftKey(...) + ':lote'`
(`lib/shiftDraftStorage.ts`), então o logout já o apaga. O rascunho v1 fica na chave antiga.

## 3. Política de presença (reservada)
- `ShiftDraftTemplate.attendance_mode` fica `null` e não é enviado. A RPC **recusa** valor preenchido
  (`presence_unsupported`).
- O ADR de presença usa `presence_mode`/`site_id`/`qr_mode` e padrão em `companies`. Quando entrar:
  reemitir `create_jobs_batch` (aceitar e gravar, inclusive no caminho de série) e **copiar o padrão
  da empresa**, porque hoje os turnos do lote ficariam com o default da coluna. Somar a linha
  "Presença" em `TemplateFields` e na revisão.

## 4. Copiloto (Fase 5)
`propose_shift_drafts(batch)` = `navigate('/company/create', { state: { shiftDraftBatch: batch } })`.
A página abre a revisão com `client_batch_id` novo. Não há ferramenta de publicar.
`validateBatch` e `parseShiftText` podem ser chamados antes.

## 5. Decisões que diferem do PRD
- `ShiftDraftRow.overrides` também aceita descrição, requisitos, briefing, certificação, tipo de valor
  e intervalo (sem isso, copiar semana perderia dados).
- Chave de agrupamento inclui também etiqueta, textos e intervalo.
- Custo por hora desconta 1h quando há intervalo.
- O service é `services/shiftBatchService.ts` e os componentes ficam em `components/shift-batch/`.
