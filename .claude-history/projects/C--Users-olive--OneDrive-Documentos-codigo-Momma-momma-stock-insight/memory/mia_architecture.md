---
name: MIA Architecture Details
description: Complete architecture of MIA agentic system - streaming, planning, ReAct, action types
type: project
---

## Streaming Architecture (Token-Level)
- `callLLMStream()` in `core/llm.ts` — async generator yielding tokens from OpenRouter stream API
- `runFinanceAgentStreaming()` in `agents/finance_logistics.ts` — ReAct rounds use sync `callLLM` (need full tool_calls), final synthesis streams via `callLLMStream`
- `processMessageStreaming()` in `index.ts` — routes to domain agent streaming variant, yields `{type: 'token', content}` events
- SSE flow: `status → actions → [status tool updates] → token* → done`
- Frontend: `MiaContext.tsx` uses `requestAnimationFrame` buffering (tokenBufferRef + rafRef) to batch token updates
- `MiaChatPanel.tsx` shows streaming text with animated cursor during loading

## Multi-Step Planning
- `plan_multi_step` tool in ACTION_TOOLS — LLM creates execution plan for complex 3+ step tasks
- Creates `MiaTaskPlan` with items array, each item has `action_type`, `label`, `data`
- Frontend shows preview card → user approves → executes steps sequentially with progress
- `TaskPlanCard` in MiaChatPanel shows status per step (pending/running/success/error)
- Plan supersedes individual actions (actions array cleared when plan created)

## MIA Action Types (40+)
Navigation: navigate, select_tab, open_modal, fill_form, apply_filters, scroll_to, cancel_form, cancel_dialog
Contas: open_new_transaction, update_status, configure_transaction, delete_transaction, submit_form, submit_configure, create_transaction_direct, batch_select, batch_update, batch_delete, expand_transaction, quick_filter, paginate
Banco: bank_create_account, bank_select_account, bank_filter, bank_reconcile, bank_sync, bank_import_ofx, bank_delete_account, bank_export
Caixa: caixa_create, caixa_submit, caixa_edit, caixa_save_edit, caixa_delete, caixa_filter, caixa_export, caixa_transfer, caixa_transfer_submit, caixa_open_reports
Contabilidade: accounting_filter, accounting_search, accounting_expand_move, accounting_post_move, accounting_refresh, accounting_create_journal, accounting_export
Cartões: card_create, card_select, card_import_csv, card_delete, card_reconcile, card_export
DRE: dre_open, dre_set_params, dre_generate_pdf
NF: open_upload, open_manual_invoice, open_analytics, open_transfers, open_reports, show_list, create_invoice_direct

## Sub-route Registration (MIA Action Handlers)
- `/financeiro` — useMiaFinanceiroActions (main contas tab)
- `/financeiro/banco` — useMiaBankActions
- `/financeiro/cartoes` — useMiaCartoesActions
- `/financeiro/caixa` — useMiaCaixaActions
- `/financeiro/contabilidade` — useMiaAccountingActions

## Phase 2A Complete Checklist
- User profile + expertise detection
- Module visit tracking (localStorage)
- Onboarding adaptativo (first visit detection)
- Guided workflows (step X of Y)
- Contextual suggestions
- Feedback loop (failed actions → backend → corrective response)
- Token-level SSE streaming
- Cancel forms (cancel_form/cancel_dialog)
- Export in ALL modules (caixa + contabilidade + banco + cartões)
- Multi-step planning (plan_multi_step tool)
