# Project Memory

## User
- [CTO da Momma](user_role.md) — perfil técnico, decisões de tech/produto/arquitetura

## Critical Feedback
- [Harness delegation não estava acontecendo](feedback_harness_delegation_enforcement.md) — "default = delegar" era fraco; Claude fazia UI inline; corrigido com PROIBIÇÕES ABSOLUTAS + declaração obrigatória no CLAUDE.md
- [Design system frontend OBRIGATÓRIO](feedback_frontend_design_system.md) — MommaPageLayout + GlassCard + isFullBleedPage + sem bg-background (bege) + grid overflow-x-auto; checklist antes de commitar
- [NUNCA auto-push sem pedido explícito](feedback_no_auto_push.md) — commit sim, push só quando pedido na hora
- [NUNCA co-author em commits](feedback_no_coauthor.md) — zero trailers, zero menção ao Claude, commits 100% do usuário, sempre pt-BR
- [Thorough forensics required](feedback_thorough_forensics.md) — verify deployed vs local, check full integration chain, don't assume
- [Verificar runtime antes de commitar](feedback_verify_runtime_before_commit.md) — grep por symbols removidos + npm run dev; tsc/build não pegam ReferenceError
- [Transferência != NF](feedback_transfer_notes_separation.md) — Momma Doces = transferência, NUNCA salvar como NF/financeiro
- [Cofre entries via Contas modal](feedback_cofre_entry_flow.md) — lançamentos cofre via "Nova Conta" em Contas & Faturas, NÃO no LivroCaixa
- [Botão Exportar do Cofre = LivroCaixa.tsx](feedback_cofre_export_button.md) — botão direto na página, NÃO confundir com FinanceReportsModal
- [MIA interaction gold standard](feedback_mia_interaction_style.md) — DADO→OFERTA→ESPERA→EXECUTA→OFERTA, never act without asking
- [Apenas produtos ativos](feedback_only_active_products.md) — NUNCA alterar inativos em produtos_master, source of truth = ativo=true
- [Nunca usar codigo_barras](feedback_no_codigo_barras.md) — Momma não usa código de barras, ignorar em fluxos novos, coluna pode ser removida
- [MIA chat jamais navega frontend](feedback_mia_no_navigation.md) — chat executa via tools, só FAB pode navegar
- [Preview → espera sim → executa EXATO](feedback_mia_preview_wait_confirm.md) — protocolo rígido, nunca trocar de ação após confirmação
- [MIA: streaming real + 3 rounds + identidade](feedback_mia_streaming_rounds_identity.md) — token-by-token obrigatório, ReAct ≤3 rounds, nome+email+role sempre no prompt
- [Agentes: nunca pedir confirmação](feedback_agents_no_confirm.md) — executar WebFetch/WebSearch direto, sem perguntar
- [Trabalhar sempre em stg — NUNCA criar branches](feedback_stg_only_branch.md) — commits direto em stg, se trocar auto voltar imediato
- [MIA disciplina de listas e dados](feedback_mia_list_data_discipline.md) — nunca truncar silencioso, nunca inventar valor, respeitar filtro de período, scope tight, "quantas X?" = contagem + tabela (não só número)
- [WhatsApp observer mode = humano respondeu](feedback_noa_observer_mode.md) — em noaa_messages canal whatsapp com mode='observer', role='assistant' é atendente HUMANO (Noa só observa)
- [Mobile-first é obrigatório](feedback_mobile_first.md) — maioria opera em celular (operadores de loja/separadores/conferentes); auditar viewport mobile antes de OK
- [Sub-features são abas, não itens de menu duplicados](feedback_no_duplicate_menu_entries.md) — feature dentro de outra página = só aba; sidebar mantém só item-pai
- [Menu por tipo de loja + Movimentações virou aba](project_menu_loja_fabrica_visibility.md) — fábrica-only (Financeiro/Produção/DP-RH/Sistema exceto Início) em sidebar+mobile+tablet via visibleFor; grupo vazio sem header; /movimentacoes redireciona p/ aba em Produtos; não reintroduzir como item de menu
- [Experiência: prorrogar na 1ª, efetivar só ao fim da 2ª](feedback_experiencia_botoes_clt.md) — gate UI dos botões em /funcionarios/experiencia; encerrar sempre disponível
- [Design system = glassmorphism verde, NUNCA bege/marrom](feedback_design_glassmorphism_verde.md) — index.css :root bege/marrom é legado abandonado; canônico = MommaPageLayout + GlassCard, sage #57715B sobre branco; doc em .harness/memory-bank/design-system.md
- [NUNCA resolução fixa — tudo responsivo](feedback_no_fixed_resolution.md) — nem "tela de TV" justifica layout 1920×1080 travado; fluido mobile→TV com breakpoints padrão; TV boa = consequência, não modo especial
- [Página full-screen = inlinar fundo da ProduçãoDiária](feedback_full_page_bg_pattern.md) — dentro de DashboardLayout NÃO usar MommaPageLayout (vaza bege); copiar casca bg-white+toldo+folhas+glows; Gemini frontend-builder com licença quebrada (#3501)
- [Deploy prod só com ordem explícita no momento](feedback_prod_deploy_explicit_only.md) — stg é livre, prod é decisão do CTO na hora; nunca buildar/enviar pra prod por aprovação anterior na conversa

## Pipeline & Git Workflow
- [CRITICAL: Never commit to main](feedback_never_commit_main.md) — all changes via feature branches + PRs
- Harness v4 (2026-06-09): 11 agentes em `.claude/agents/`, pipeline com Phase 3.5 (frontend-reviewer ∥ security-reviewer) + 3.7 (memory-updater), playbook refactor.md, pre-push hook
- [Harness v5 — loop de aprendizado ACE + revisor frontend SOTA](project_harness_v5_learning_loop.md) — .harness/learnings/ append-only por gate, git-miner, memory-updater vira Curator; frontend-reviewer opus roda checks+diff canônico+lentes+smoke (SEM Playwright/MCP por decisão do CTO)
- 1 task = 1 branch = 1 PR — no exceptions

## MIA Agentic System (AI-First ERP)
- [MIA como Navegadora do ERP](mia_navigator_architecture.md) — Intent Routing through System Topology, GPS analogy, topologia de sistema nos 4 agents

### Decisão Arquitetural Glass-Box (2026-05-18) — substitui modelos anteriores
- [Glass-Box Architecture v2](mia_glass_box_architecture.md) — intent classifier + 4 camadas (L0 sub-agent tools / L1 React Actions / L2 DOM / L3 vision), glass-box pane só quando necessário, routing layer REMOVIDO, multi-agent parallel DESCARTADO
- [Mirror Per-User Memory](mia_mirror_per_user_memory.md) — profile vivo Supabase real-time, espelha linguagem+padrões (estilo Claude Code auto-memory aplicado multi-tenant)
- [5 Camadas de Memória MIA](mia_5_layer_memory.md) — L1 mia.md global git / L2 skills/<role>.md / L3 page_models shared / L4 user Mirror / L5 session
- [Botão "Modo IA" + Layout](mia_modo_ia_button_layout.md) — sidebar desktop / ao lado seletor loja mobile / split-view ERP+MIA / bottom sheet mobile / FAB descartado
- [Reasoning Models Seletivos](mia_reasoning_selective_use.md) — plan step + distillation + specialist analysis (custo +30%, latência só onde vale)
- [Tool Synthesis Read-Only (Mês 4-5)](mia_tool_synthesis_readonly.md) — MIA gera SELECT pra demanda nova + user salva (post-MVP, território frontier produtizado pra ERP)
- [Dashboard analítico removido — MIA é a entrada do desktop](project_dashboard_analitico_removido.md) — desktop /dashboard redireciona pra /mia; mobile/tablet mantêm /dashboard como home (MobileHome/TabletHome); não reintroduzir analítico nem rotear desktop pra /dashboard

### Implementation Handoff Package (pronto pra outra IA implementar)
- Pacote em `docs/mia/`: ARCHITECTURE.md + HANDOFF.md + IMPLEMENTATION.md + mia.md + skills/financeiro.md + DATA_MIA_CONVENTION.md + migrations/001_mia_glass_box_schemas.sql. Status: Mês 1 ready. Pipeline "6 agents" do MEMORY antigo (spec/sprint/dev/review/qa/security) NÃO existe no repo — apenas 2 workflows (docs.yml + noaa-evals.yml). Trabalho fluxo: direto em stg, sem feature branches.

### State-of-the-Art Path (12 alavancas, 2026-05-19)
- [MIA Glass-Box → Claude Chrome level](mia_glassbox_state_of_art_path.md) — 5 root causes fixados + 12 ondas (auto-healing, mutation observer, L0 tools, route skills, codemod, nav graph, health/observability dashboards, intent registry). Dashboards: /mia/health + /mia/observability. ESLint rules locais. Sem vision — só codebase.

## MIA Agentic System (AI-First ERP) — legacy/contexto pré-glass-box
- **Architecture**: React Actions pattern (not UI automation/page-agent)
- **Frontend**: `MiaContext.tsx` (global state), `MiaChatPanel.tsx` (Sheet panel), `MiaFab.tsx` (floating button), `MiaChatMessage.tsx`
- **Backend**: `supabase/functions/mia/index.ts` supports both Telegram (`body.message.chat`) and Web (`body.web=true`) channels
- **Action Registry**: Pages register handlers via `useMiaActions(route, handlers)` hook
- **Action Detection**: LLM-powered action resolver with 40+ ACTION_TOOLS
- **Types**: `src/types/mia.ts`
- **Integration**: `DashboardLayout.tsx` wraps with `<MiaProvider>`, renders `<MiaFab>` + `<MiaChatPanel>`
- **Streaming**: Token-level SSE streaming via `callLLMStream()` in `core/llm.ts`, `processMessageStreaming()` in `index.ts`
- **Multi-step Planning**: `plan_multi_step` tool creates TaskPlan → preview → approve → execute
- **ReAct Loop**: Domain agents do 3 rounds max (tool → evaluate → tool → evaluate → synthesize)
- **LLM Fallback Chain**: grok-4.1-fast → grok-4-fast → deepseek-v3.2 → llama-4-maverick
- **Status**: Phase 2A complete. Token streaming + multi-step planning DONE. Refactor unified (single-agent ReAct) descartado em mai/2026 — legacy router→specialist→coordinator é caminho único agora (commit `b9c1b30` em stg)
- [MIA Architecture Details](mia_architecture.md)
- [MIA memory cross-session + telemetria](mia_memory_telemetry.md) — history no Supabase, mia_user_memory, mia_feedback_signals, mia_user_patterns
- [MIA Behavioral Intelligence SOTA (L1-L5)](project_mia_behavioral_intelligence.md) — captura TODO uso (gidape_events), aprende contínuo (distillation), proativo (4 crons), counterfactual, injeção em processMessage legacy. Backend live, frontend falta npx vercel
- [Supabase CLI no Windows](reference_supabase_cli_windows.md) — binário ~/.supabase-cli, npm quebra, rede IPv6 flaky exige retry loop

## Data / Permissions
- [Role `operações` tem permissions de admin](project_role_operacoes_duplicada.md) — `operação` vs `operações` (plural) duplicadas, plural vaza acesso a financeiro
- [Compras tem seletor de loja LOCAL (não mexe no StoreContext global)](project_compras_seletor_loja_local.md) — Compras=Notas Fiscais fábrica-only; comprasLojaId(localStorage) filtra lista + define loja do lançamento, contexto global fica Fábrica; gate canSelectStoreNF (isAdmin NÃO inclui master); landmine: UPDATE de saveNota deve preservar loja_id da nota (não zerar contas_pagar_receber/credit_card_transactions); RLS dessas tabelas é authenticated-level sem isolamento de loja; commit e94ad8f7 em stg, sem push

## Camada de Gestão (N1)
- [Gestão Operacional N1 por setor](project_gestao_operacional_n1.md) — ADR 2026-06-05: event bus eventos_operacionais + motor de expectativas + /gestao/<setor>; ondas 0-3, fundação ainda não implementada

## Logística & Supply Chain
- [Min/Max de estoque por demanda](project_minmax_estoque_metodologia.md) — newsvendor p/ perecível, viagem seg/qua/sex (sexta cobre fim de semana), grava em estoque.quantidade_minima/maxima, nível serviço por ABC; spec em .harness/spec/min-max-estoque/
- [Motor de mínimo: escopo dinâmico setor PRODUTOS + só min](project_minmax_motor_setor_produtos.md) — 2026-06-25 recalcular_minmax_estoque deixou lista fixa de 15 → dinâmico (setor='PRODUTOS' c/ venda Degust 56d); grava SÓ quantidade_minima (max DORMENTE por ordem do CTO, máquina de max ainda computada mas não escrita); minmax_escopo_produtos dormente; invariante min≤max não garantido na escrita; match Degust→master revisado e OK (consolidações NOVO/PROM/KIT corretas, sem produto errado)
- [Consulta de Mínimo por Período (aba em Produtos)](project_minmax_motor_setor_produtos.md) — 2026-06-25 RPC READ-ONLY simular_minimo_periodo(dia_inicio dow0-6, dias_cobertura 1-7) projeta mínimo por produto×loja pra janela escolhida na mão (espelha config do repa); matriz produto×loja em /produtos?tab=minimo-periodo; NÃO grava nada, não toca mínimo diário/cron; mesma matemática do motor (janela de hoje reproduz o mínimo gravado); grant authenticated global por decisão do CTO (dado operacional interno)
- [Disco = 1 saco com 2 discos; base 1:1](project_disco_base_embalagem.md) — etiqueta do saco de disco marca 2; base é 1 por saquinho; "todo Discos & Bases = 2" é ERRADO (só disco)
- [Produto invisível na busca = falta produto_loja_visibility](project_produto_visibility_missing_rows.md) — ativo=true não basta; sem linhas de visibilidade some no frontend; checar antes de recriar
- [Reconciliador estoque↔lotes = landmine](project_estoque_lotes_reconcile_landmine.md) — sync_estoque_from_lotes força estoque=SUM(lotes) e corrompe avulso (lançamentos sync_lote_auto fantasma); guard app.skip_lote_reconcile (migration 20260525190955) blinda só o bip, Picking/Produtos editam lote direto e seguem em risco
- [Lote "morto" no QR trava Scanner](project_lote_duplicacao_setnull_landmine.md) — lote do QR deletado + FK etiquetas_qr.lote_id ON DELETE SET NULL orfaniza → movimentacoes FK rejeita. Frente A: resolver_lote_etiqueta (f2c2c924). Frente B: find_or_create_lote idempotente + backfill 308 + UNIQUE(produto,codigo) + deleteBatch guard (48a736aa). lotes NÃO tinha duplicata real (divergência 9 vs 13 chars entre os 2 BatchList). Resta opcional: merge das 60 colisões históricas
- [Momma é doces saudáveis (NÃO padaria), validade 3-5d](project_momma_business_validade.md) — shelf-life é cap obrigatório em DRP/forecast, nunca opcional
- [daily_production sempre loja_id NULL = fábrica](project_daily_production_sempre_fabrica.md) — produção centralizada; nunca quebrar produção por loja sem popular loja_id na origem
- [Torre de Controle ≠ Requisição](project_torre_controle_vs_requisicao.md) — flows independentes; criar requisição não dispara expedição automática
- [Recorrência de encomendas = split em 2 páginas + projeção virtual](project_encomendas_recorrencia_split.md) — PJ no EventosTimeline, delivery/retirada no Encomendas.page; nunca materializar linhas (usar recurrence_excluded_dates); bug do crypto.randomUUID no mobile corrigido em 2026-05-25
- [Etiquetas QR — rastreabilidade fim-a-fim por UID](project_etiquetas_qr_rastreabilidade.md) — tabela etiquetas_qr + RPC bipar_etiqueta = ponto único de validação. PR1 (fundação ac279aa) + PR2 (separação) + PR3 (recebimento) todos em prod (5d94c11). Hook useEtiquetaScanner reusável. Rotas /etiquetas/:uid, /logistica/recebimento, /logistica/separacao-bip/:sessionId.
- [Finalizar requisição dá baixa de estoque por bip](project_saida_estoque_requisicao.md) — RPC dar_saida_requisicao: 1 saída por etiqueta bipada atribuída a quem SEPAROU (separada_por), loja=fábrica, ponte via etiquetas_qr_eventos.referencia_id; migration 20260615153000 APLICADA no banco 15/06 (frontend ainda não deployado → RPC dormente)
- [Pipeline IA da requisição manual](project_requisicao_manual_ai.md) — parse (process-requisition-ai, source_text verbatim) + fuzzy match 0.72 + alias learning (produto_aliases) + revisor (review-requisition-matches); chain barato OpenRouter 5 modelos; NÃO é a automática (requisicao-automatica-ia)
- [Requisição manual: landmines de streaming + match](project_requisicao_manual_streaming_landmine.md) — edge streaming retorna 200 e falha DENTRO do SSE (boundary logs enganam); frontend ignorava evento 'error' → tela vazia fingindo sucesso; match ignorava título da seção → produto errado. Fix stg 4cf8609f (productMatch.ts ciente de categoria + repairItemName + revisor c/ seção); edge só vale após deploy em prod
- [Scanner "já deu entrada" = idempotência, não bug](project_scanner_recontagem_idempotencia.md) — rebipar mesma etiqueta na mesma loja trava por design; pra recontagem voltar etiqueta pra 'gerada'; setor via produtos_master.setor (normalizar unaccent/lower)
- [Produtos unitários (cuba/naked/vulcão/dressed) = 1:1 no scanner](project_cuba_gelato_1a1.md) — trigger trg_enforce_produto_unitario força quantidade=1/tipo=unidade p/ nome com "cuba|naked|vulcao|dressed"; fábrica 2026-06-04: cubas reset+rebipar, nakeds (65→14) e vulcão+dressed (716→71) só acerto de contagem
- [API PDV terceiro = movimentar nossas caixas QR](project_pdv_terceiro_api.md) — edge `pdv-movimentacao` (x-api-key/`pdv_api_keys` bcrypt, escopo loja) p/ PDV externo dar entrada/saída/consulta no nosso ERP; reusa bipar_etiqueta (idempotência por estado, sem índice único); motivos entrada_/saida_pdv_externo; usuário-sistema pdv_integracao_sistema; doc em docs/pdv-movimentacao/API.md; implementado stg 2026-06-25, NÃO aplicado/deployado/commitado

## Supabase
- [Auditoria DB SOTA 2026-06](project_db_audit_2026_06.md) — fechado buraco anon no RLS + 140MB bloat + índices; pendentes Onda 4/5, views secdef, push
- [OpenRouter aposenta slugs sem aviso](project_openrouter_model_slugs_deprecate.md) — Gemini 2.0/1.5 saíram → HTTP 404 quebrou OCR de NF 100% (não era qualidade de imagem); validar IDs em /api/v1/models; OCR NF = foto sobe pro bucket + base64 server-side (sem OOM Android)
- [Logs de edge function sem MCP](reference_supabase_logs_management_api.md) — Management API + token sbp_ do Windows Credential Manager (target `Supabase CLI:access-token`, UTF-8); fonte `function_logs`=console Deno, `function_edge_logs`=boundary HTTP; passar iso_timestamp_start/end
- Project ID: `jaumyfyeueayibbxunxc`
- Region: sa-east-1
- URL: `https://jaumyfyeueayibbxunxc.supabase.co`

## Infra & Docs
- [Rota viva = App.tsx → src/pages/*.tsx](project_live_router_is_app_tsx.md) — main.tsx monta App.tsx (legado); feature .page.tsx do router v2 são código morto; grep em App.tsx antes de editar "a página" de uma rota (tsc/build não pegam)
- [version.json = único escritor generate-version.js](project_version_json_single_writer.md) — vite.config só LÊ; gravar Date.now() no config fazia banner Atualizar nunca sumir (mismatch bundle×version.json em prod)
- [Docs públicas + nome MommaERP](project_docs_site_mommaerp.md) — momma-xi.vercel.app/docs via MkDocs em public/docs servido pelo app (não GitHub Pages); sistema agora se chama MommaERP (Gidape é codinome legado)

## Ouvidoria (denúncia anônima)
- [Ouvidoria anônima SOTA](project_ouvidoria_anonima.md) — anonimato como engenharia (RPCs SECURITY DEFINER sem auth.uid, anonClient sem-JWT, protocolo+senha bcrypt); leitura por allowlist `ouvidoria_acesso` (seed manual SQL, NÃO role); rota pública `/ouvidoria-anonima`, painel donas `/ouvidoria`; entregue stg 2026-06-16 (sem push ainda)

## Store IDs (loja_id)
- 1: Fábrica
- 2: Momma Asa Sul
- 3: Momma Asa Norte
- 4: Momma Lago Sul (Degust POS = "MOMMA BRUNCH")
- 5: Momma Águas Claras (Degust POS = Loja 2)
- 6: Momma Brasília Shopping

## Módulo Funcionários (Core HR — DP/RH) — IMPLEMENTADO COMPLETO + EXTENSÕES MARCOS

### Páginas
- `/funcionarios` (lista + KPIs + col Aniversário + col Posto editável + StoreSelector admin only)
- `/funcionarios/cargos` · `/novo` · `/:id` (perfil c/ banner aprovação desligamento + tab Editar) · `/experiencia` · `/organograma`
- `/funcionarios/desligamentos` (KPIs voluntário/involuntário + rotatividade)
- `/funcionarios/ferias` (saldo visual + marcação CLT + aprovação) · `/funcionarios/ferias/calendario` (vista mensal)
- `/funcionarios/metodos-punitivos` (advertências + suspensões com PDF)
- **`/funcionarios/analytics`** (master only — KPIs todas lojas, headcount, turnover, voluntário/involuntário, top cargos, punitivos, férias status, decisões pendentes, donut/barras SVG)

### Workflow
- Gerente solicita desligamento → status `pendente_desligamento` → master aprova/rejeita
- Marca férias → master aprova → PDF liberado 35d antes → upload assinado
- Edge function diária `cron-ferias-lembrete-assinatura` cria notificação master quando aviso pendente

### Realtime
- `<NotificationBell>` no AppSidebar (admin only) com Supabase Realtime na `notificacoes_master`
- Banner permanente no `/dashboard`

### Schema (15 tabelas + storage)
- `cargos`, `employees` (jornada/turno/estação/foto/empresa/tipo_desligamento/status `pendente_desligamento`)
- `contratos`, `experiencia_decisoes`, `employee_audit_log`, `employee_history` (effective-dated)
- `eventos_esocial`, `lgpd_solicitacoes`
- `ferias_periodos` (auto-criado trigger), `ferias_marcacoes`, `metodos_punitivos`, `notificacoes_master` (realtime)
- `pesquisa_saida` (exit interview), `pesquisa_clima_ciclos`, `pesquisa_clima_respostas`
- Storage `funcionarios-docs` (PDFs + fotos)
- Triggers: matrícula auto · audit log · history (cargo/salário/loja/manager) · descarte LGPD · notificações master (4 tipos)
- RLS gerente edita estação só da própria loja
- [PRD + Marcos features](project_modulo_funcionarios.md) — todas as features do PDF "features rh marcos" aplicadas
- 11 tabelas no Supabase: `cargos`, `employees`, `contratos`, `experiencia_decisoes`, `employee_audit_log`, `eventos_esocial`, `lgpd_solicitacoes`, `ferias_periodos`, `ferias_marcacoes`, `metodos_punitivos`, `notificacoes_master`
- Storage bucket `funcionarios-docs` (privado, admin/rh_admin only)
- Páginas: `/funcionarios` (lista + KPIs + col aniversário) · `/cargos` · `/novo` · `/:id` · `/experiencia` · `/organograma` · `/desligamentos` · `/ferias` · `/metodos-punitivos`
- Hooks: useEmployees · useCargos · useFerias · usePunitivos · useNotificacoesMaster · useMiaFuncionariosActions
- PDFs via jspdf: Aviso Prévio de Férias (CLT Art. 135) + Advertência Disciplinar
- Triggers automáticos: criar período aquisitivo na admissão · audit log · notificação master (férias/punitivos/desligamentos) · matrícula auto · descarte LGPD
- Validações CLT no banco: experiência ≤ 90d, máx 1 prorrogação, fracionamento férias 30d, presets (1×30/15+15/20+10/25+5)
- Banner de notificações master no `/dashboard` (admin only)
- Banner de alerta de fim de experiência D-7/D-30 no dashboard + na lista
- Categoria menu "DP/RH" (não "Gerência"); "Usuários" mudou pra Sistema

## Módulo de Produção (PCP + Recipe Management + MES leve)
- [Fichas Técnicas: Construtor = verdade](project_fichas_tecnicas_construtor_verdade.md) — modal espelha construtor; ingredientes = insumos (não produtos_master); custo via helper compartilhado; foto IA → esboço
- [Custeio completo das sobremesas no construtor (NF, jun/26)](project_custos_fichas_construtor_2026_06.md) — ~75 fichas gravadas (massas/recheios/bolos no pote/fatias/dresseds/nakeds/minis) precificadas por NF; motor compute_item_cost+recompute cascata; correções de insumo (ovo, stevia fator 30, creme leite, farinha amêndoas); convenção produto=1un/fatia=12; 4 minis pendentes
- [Mini ≠ bombom de frutas](feedback_mini_vs_bombom_frutas.md) — produtos distintos; bombom de frutas usa brig PRETO 51%; mini = casquinha 12g choc51 + 25g recheio (sabor=recheio)
- Plano estratégico completo em `.trae/documents/modulo_producao_plano_estrategico.md`
- **Sprint 1 (próximo):** Cadastro de Insumos + Ficha Técnica/BOM — fundação de tudo
- **Terminologia:** Insumo (matéria-prima), Ficha Técnica (receita/BOM), Ordem de Produção/OP, Semi-acabado (sub-receita), Perda, Rendimento, Variância
- **Novas tabelas planejadas:** `insumos`, `fichas_tecnicas`, `ficha_tecnica_itens`, `ficha_tecnica_etapas`, `ordens_producao`, `op_insumos`, `op_perdas`, `op_qualidade`
- **Fundação existente:** `daily_production`, `daily_production_products`, `produtos_master`, `DailyProductionForm.tsx`, `ProductionForecastDashboard.tsx`
- **Diferenciais:** MIA nativa, custo atualizado por NF, ciclo fechado PDV→Produção→Estoque, multi-loja

## Noaa Chat (Chatbot de Vendas)
- [POC Telegram Chatbot](project_whatsapp_chatbot_poc.md) — escopo, decisões, fluxo
- [Painel de Supervisão Noa](project_noaa_supervision_panel.md) — grid mini-telas, takeover, audio, WhatsApp, metricas
- System prompt: `supabase/functions/noaa-chat/system-prompt.ts`
- Shared core: `supabase/functions/_shared/noaa-core/` (llm, session, order, types)
- Persona: Noa (atendente humanizada)
- Canais: Telegram (noaa-chat) + WhatsApp/WaSender (noaa-whatsapp)
- Supervisão: `noaa-supervisor` edge function + frontend `src/features/noaa-supervisor/`
- DB: `noaa_messages` (Realtime), `noaa_sessions` (mode ai/human), view `vw_noaa_metrics`
- Storage: bucket `noaa-media`
- [Noaa Business Rules/Templates](noaa_business_rules.md) — cardápios distintos, 48h delivery, PDF+templates pré-prontos
- [Pipeline análise corpus WhatsApp](project_noaa_corpus_analysis.md) — docs/noaa/analise-flows-clientes/, classify+cluster+extract via Haiku 4.5, 11 flows mapeados, doc world-class
- [Refatoração world-class — Etapa 1 concluída 2026-04-28](project_noaa_refatoracao_etapa1.md) — Constitutional Rules + Critic v2 + Reclamação Intercept; 23 testes Deno + 5/5 evals; deploy pendente do CTO
- WhatsApp atendimento: instance Evolution `cs-cst-evolution-api-b40bf447`, conta `556194605682@s.whatsapp.net`, conectada 2026-04-24 20:04 UTC
- Action `evolution_bulk_sync_chain` aceita `cutoff_override_ts` (epoch sec) pra puxar chats anteriores à data de conexão
- Action `evolution_owner_info` confirma ownerJid atual + registered (sanity check antes de bulk-sync histórico)

## Degust POS Integration
- [Painel TV R$0/travado p/ 1 loja = flash-vendas por-caixa congelado (PDV dessincronizado), não bug](project_tv_flash_stale_per_store.md) — Asa Norte 19/06 02:25; checar ultimaAtualizacao por loja antes de re-RCA; fix staleLive no tv-dashboard (stg)
- [Sync congelava dias parciais — corrigido](project_degust_sync_congelamento_landmine.md) — Lago Sul 11×/Shopping 6× subnotificados; forceRefresh v23 + cron 04:30 + reparo 56d; bolos no pote foram recriados no PDV como "* NOVO" (não morreram); pendências: chocolate 628/633→1035?, 387 remap, 634 genérico
- [Lançar pedido = Hub Delivery API, não a integration API](project_degust_order_injection_hub.md) — IncluirPedido em degust.com.br/api/Delivery2, outro host/token; integration API (V1+V2) é read-only
- API: `https://lx-degust-api-integracao-prd.azurewebsites.net`
- CodigoFranqueador/Franquia: 3489
- TODAS as 5 lojas no Degust desde 2026-06 (Linx aposentada): código 1=Lago Sul(4) "MOMMA BRUNCH", 2=Águas Claras(5), 3=BSB Shopping(6), 4=Asa Sul(2) desde 30/04, 5=Asa Norte(3) "ASA NORTE 2" desde 26/05 — mapeamento vivo em `degust_stores` (NUNCA hardcodar)
- Token AUTOMÁTICO via degust_auth + getDegustToken (`_shared/degust-token.ts` + edge degust-auth-refresh); `degust-pos-financial` v20 (2026-06-05) migrou pra isso e pro mapeamento dinâmico — secret estático `DEGUST_API_TOKEN` aposentado; fonte agora versionada no repo
- Cron degust-sync.yml lê degust_stores dinamicamente (loja nova entra sozinha); backfill lojas 2/3 feito (30/04 e 26/05 → 05/06); `historico_vendas` (Linx, parou 09/04) é legado
- Matching produto 2026-06-05: 204 mappings (~73% do valor); PENDENTE decisão CTO: "MINI UNIDADE"+caixas 6/10 (R$ 222k) e OVERNIGHT genérico sem sabor atribuível — criar master genérico ou botões por sabor no PDV; brunch Lago Sul (~R$ 150k) é PDV-only por design; dressed P/M/G + pistache P + naked G chocolate REATIVADOS no master a pedido do CTO
- Tables: `degust_stores`, `degust_product_mapping` (124 mappings), `degust_vendas_diarias` (cache)
- **Key API endpoints that WORK:**
  - `GET /api/financeiro/flash-vendas` — LIVE today: totalVendas, totalCupons, ticketMedio, caixaAberto per store
  - `GET /api/financeiro/ticket-medio?CodigoLoja={}&DataInicial={}&DataFinal={}` — Daily: totalFaturado, totalCupons, ticketMedio, desconto, quantidadeProdutos
  - `GET /api/financeiro/movimentacao-produtos?CodigoLoja={}&DataCaixa={}` — Product-level: hora, produto, qtd, valorUnitario
  - `GET /api/financeiro/exportar-formas-pagamento` — 58 payment methods (PIX=#58, Débito=#4, Crédito=#5, Dinheiro=#1)
- **Endpoints that return EMPTY (not enabled for franchise 3489):** detalhamento-caixa, movimentacaoVendaItem, consultar-movimento
- Edge Functions:
  - `degust-sync-sales` — syncs product data to `degust_vendas_diarias`, returns ProductHistory[] for QtdVendas
  - `degust-pos-financial` — calls flash-vendas + ticket-medio, returns daily financial summaries for Financeiro PDV tab
- Frontend: `QtdVendas.tsx` (product analytics), `PontoDeVendaPanel.tsx` (financial PDV tab)
- `contas_pagar_receber.origem` constraint includes 'pdv' for PDV-generated receivables