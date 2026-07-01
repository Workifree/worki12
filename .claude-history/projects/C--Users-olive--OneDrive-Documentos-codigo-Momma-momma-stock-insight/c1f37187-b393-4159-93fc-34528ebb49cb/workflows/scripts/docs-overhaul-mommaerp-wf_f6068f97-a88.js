export const meta = {
  name: 'docs-overhaul-mommaerp',
  description: 'Revisa 100% das docs contra o codigo real e reescreve SOTA (so "Momma")',
  phases: [
    { title: 'Investigar', detail: 'Explore o codigo real por modulo' },
    { title: 'Reescrever', detail: 'Reescreve as paginas SOTA e fieis ao codigo' },
    { title: 'Verificar', detail: 'Confere fidelidade, naming e estilo' },
  ],
}

const NAMING = 'REGRA DE MARCA (obrigatoria): a empresa chama-se apenas "Momma". NUNCA escreva "Confeitaria Artesanal", "confeitaria", "artesanal", nem descreva como "doces saudaveis" ou similar. Apenas "Momma". O sistema/ERP chama-se "MommaERP". Onde a doc atual disser "Momma Confeitaria Artesanal" ou "Momma Sistema" ou "Gidape", troque por "Momma" (empresa) ou "MommaERP" (sistema) conforme o sentido.'

const STYLE = 'ESTILO: MkDocs Material em pt-BR. Cada pagina deve ter frontmatter YAML com "description:" (1 linha com emoji), headings com emoji, admonitions Material (!!! note/tip/warning/success ""), tabelas, separadores ---, cards quando fizer sentido. Tom claro para usuario final (operadores de loja, gerentes, financeiro). SOTA: conciso, preciso, util. NAO invente funcionalidade que nao esta no codigo. NAO documente coisas marcadas como stub/desabilitado/feature-flag-off/TODO como se funcionassem. Mantenha EXATAMENTE os mesmos arquivos (nao renomeie, nao crie novos) para nao quebrar a navegacao do mkdocs.yml.'

const GROUPS = [
  { key: 'inicio-guia', module: 'Inicio e Guia Rapido (login, navegacao, visao geral do sistema)',
    hint: 'Olhe src/app (router, providers), src/features/auth (login/aprovacao), src/shared/ui/RootRedirect.tsx (desktop->/mia, mobile/tablet->/dashboard), src/features/dashboard (AppSidebar, menuItems, DashboardLayout, MobileHome/TabletHome). Foco: como o usuario entra, faz login, navega, e o que e a home em cada device.',
    pages: ['docs/README.md','docs/guia-rapido/README.md','docs/guia-rapido/primeiro-acesso.md','docs/guia-rapido/navegacao.md'] },
  { key: 'estoque', module: 'Dashboard e Estoque (visualizacao, produtos, compras, movimentacoes)',
    hint: 'Olhe src/features/dashboard e src/features (estoque/produtos/compras/movimentacoes). Identifique telas reais, filtros, colunas, acoes (lote, validade, setor, visibilidade por loja).',
    pages: ['docs/modulos/README.md','docs/modulos/dashboard.md','docs/modulos/estoque/README.md','docs/modulos/estoque/visualizacao.md','docs/modulos/estoque/produtos.md','docs/modulos/estoque/compras.md','docs/modulos/estoque/movimentacoes.md'] },
  { key: 'logistica', module: 'Logistica (requisicoes, fila/kanban, torre de controle, picking/separacao, encomendas) e Pronta Entrega',
    hint: 'Olhe src/features (logistica, requisicoes, picking/separacao, torre-controle/control-tower, encomendas, pronta-entrega). Identifique fluxos reais: requisicao manual/automatica, kanban, bip de etiqueta, expedicao.',
    pages: ['docs/modulos/logistica/README.md','docs/modulos/logistica/requisicoes.md','docs/modulos/logistica/fila.md','docs/modulos/logistica/torre-controle.md','docs/modulos/logistica/picking.md','docs/modulos/logistica/encomendas.md','docs/modulos/pronta-entrega.md'] },
  { key: 'financeiro', module: 'Financeiro (executivo, contas a pagar/receber, banco, cartoes, livro caixa/cofre, contabilidade, DRE/relatorios) e Notas Fiscais',
    hint: 'Olhe src/features (financeiro, notas-fiscais). Telas: dashboard executivo, contas, contas bancarias, cartoes, LivroCaixa/cofre, contabilidade, relatorios/DRE, conciliacao. NF: upload, OCR, edicao, relatorios.',
    pages: ['docs/modulos/financeiro/README.md','docs/modulos/financeiro/executivo.md','docs/modulos/financeiro/contas.md','docs/modulos/financeiro/banco.md','docs/modulos/financeiro/cartoes.md','docs/modulos/financeiro/caixa.md','docs/modulos/financeiro/contabilidade.md','docs/modulos/financeiro/relatorios.md','docs/modulos/notas-fiscais.md'] },
  { key: 'producao', module: 'Producao (producao diaria, verificacao de perdas)',
    hint: 'Olhe src/features (producao, daily production, perdas). DailyProductionForm, ProductionForecastDashboard. Producao e centralizada na fabrica (loja_id null).',
    pages: ['docs/modulos/producao/README.md','docs/modulos/producao/producao-diaria.md','docs/modulos/producao/verificacao-perdas.md'] },
  { key: 'vendas', module: 'Vendas e PDV (quantidade de vendas, integracao Degust)',
    hint: 'Olhe src/features (vendas), QtdVendas, PontoDeVendaPanel, integracao Degust (degust-sync-sales, degust-pos-financial). Mapeie lojas Degust.',
    pages: ['docs/modulos/vendas/README.md','docs/modulos/vendas/quantidade-vendas.md','docs/modulos/vendas/integracao-degust.md'] },
  { key: 'eventos', module: 'Eventos (gestao, financeiro de eventos, logistica de eventos)',
    hint: 'Olhe src/features (eventos, EventosTimeline). Festas/encomendas PJ, recorrencia, projecao virtual.',
    pages: ['docs/modulos/eventos/README.md','docs/modulos/eventos/gestao.md','docs/modulos/eventos/financeiro-eventos.md','docs/modulos/eventos/logistica-eventos.md'] },
  { key: 'ferramentas', module: 'Ferramentas (Scanner QR, Etiquetas, Rastreabilidade de lotes, Fluxogramas, Consulta NCM)',
    hint: 'Olhe src/features e hooks (useEtiquetaScanner, etiquetas_qr, rastreabilidade por UID, RPC bipar_etiqueta, fluxogramas, NCM). Rotas /etiquetas/:uid, /logistica/recebimento, /logistica/separacao-bip.',
    pages: ['docs/ferramentas/README.md','docs/ferramentas/scanner.md','docs/ferramentas/etiquetas.md','docs/ferramentas/rastreabilidade.md','docs/ferramentas/fluxogramas.md','docs/ferramentas/ncm.md'] },
  { key: 'ia-mia', module: 'Inteligencia Artificial e MIA (chat MIA, requisicao automatica, OCR de NF, conciliacao bancaria)',
    hint: 'IMPORTANTE: a doc atual da MIA esta MUITO desatualizada. Olhe o CODIGO REAL: supabase/functions/mia/index.ts e modulos (_shared/router, agents, tools, llm, react-loop, intent-classifier, memory) e src/features/mia/ (MiaInlineChat, MiaGlassBoxPane, MiaModeToggle, MiaFab, useMia, useMiaActions, hooks). A MIA real hoje: rota /mia e a entrada do desktop (mobile/tablet=/dashboard); router context-aware -> agents especialistas (Estoque/Catalogo, Financeiro/Logistica) com ReAct loop (~3 rounds); streaming token-a-token (SSE); "Modo IA" glass-box split-view (pane desktop / bottom sheet mobile) com Watch Log; confirmacao obrigatoria antes de acoes destrutivas (ConfirmationCard); task plan preview->aprovar->executar; memoria persistente (mia_user_memory, history); modelos gpt-4.1-mini com fallback (Haiku-4.5/Gemini/Grok); canais Web + Telegram. NAO documente como funcionando: voice, UI generativa, glass-box agent autonomo (feature-flag OFF por default). Requisicao automatica IA, OCR de NF e conciliacao bancaria: olhe supabase/functions (process-requisition-ai, review-requisition-matches, OCR de NF, conciliacao) e as telas.',
    pages: ['docs/inteligencia-artificial/README.md','docs/inteligencia-artificial/mia-chat.md','docs/inteligencia-artificial/requisicao-automatica.md','docs/inteligencia-artificial/ocr-notas.md','docs/inteligencia-artificial/conciliacao-bancaria.md','docs/guia-rapido/mia-assistente.md','docs/arquitetura/mia.md'] },
  { key: 'administracao', module: 'Administracao (usuarios do sistema/RBAC, funcionarios/DP-RH, permissoes, configuracoes)',
    hint: 'Olhe src/features (auth/usuarios, funcionarios/HR). Usuarios = acesso/RBAC (aprovacao, papeis, loja). Funcionarios = DP/RH (cargos, experiencia CLT, ferias, desligamentos, punitivos, organograma, analytics). Permissoes = papeis e o caso operacao vs operacoes. Configuracoes.',
    pages: ['docs/administracao/README.md','docs/administracao/usuarios.md','docs/administracao/funcionarios.md','docs/administracao/permissoes.md','docs/administracao/configuracoes.md'] },
  { key: 'arquitetura-ops', module: 'Arquitetura, Operacoes e Decisoes (visao geral, banco, estrutura FSD, stack, observabilidade, runbooks, ADRs)',
    hint: 'Olhe a stack real: React 18 + TS + Vite, Supabase (Auth/DB/RLS/Realtime/Storage), TanStack Query, Tailwind+Radix, Capacitor, Vercel, PWA, OTel. Estrutura FSD em src/. Confirme no package.json e estrutura. Para ADRs e runbooks: corrija apenas naming e imprecisoes obvias, NAO reescreva decisoes historicas. Estes docs sao mais tecnicos: precisao > didatica.',
    pages: ['docs/arquitetura/visao-geral.md','docs/arquitetura/banco-de-dados.md','docs/arquitetura/estrutura-projeto.md','docs/arquitetura/stack-tecnologica.md','docs/operacoes/observabilidade.md','docs/operacoes/metricas.md','docs/operacoes/grafana.md','docs/operacoes/runbooks/mia-fallback.md','docs/operacoes/runbooks/merge-main-stg.md','docs/operacoes/runbooks/bug-fixes-runtime.md','docs/decisoes/README.md','docs/decisoes/001-stack-frontend.md','docs/decisoes/002-supabase-backend.md','docs/decisoes/003-design-system-tailwind-shadcn.md','docs/decisoes/004-sistema-multi-loja.md','docs/decisoes/005-mia-arquitetura-agentica.md','docs/decisoes/006-openrouter-fallback-chain.md','docs/decisoes/007-mobile-pwa-capacitor.md'] },
  { key: 'faq', module: 'Referencia (FAQ, glossario, atalhos)',
    hint: 'Olhe o glossario e FAQ atuais e alinhe os termos com os modulos reais. Atalhos: confira se ha atalhos/gestos reais no app (scanner, mobile).',
    pages: ['docs/faq/README.md','docs/faq/glossario.md','docs/faq/atalhos.md'] },
]

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', description: 'true se todas as paginas estao fieis, sem naming proibido, e no estilo' },
    issues: { type: 'array', items: { type: 'string' } },
    fixed: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'issues', 'fixed'],
}

log('Overhaul de ' + GROUPS.length + ' grupos de docs contra o codigo real')

const results = await pipeline(
  GROUPS,
  // 1) INVESTIGAR (read-only)
  (g) => agent(
    'Investigue no CODIGO REAL (src/ e supabase/) o modulo: ' + g.module + '.\n' + g.hint +
    '\n\nNAO use a pasta docs/ como fonte (pode estar desatualizada/aspiracional). Retorne um inventario FACTUAL e conciso das capacidades ATUAIS voltadas ao usuario: telas/rotas reais, filtros, colunas, acoes, fluxos, e o que e diferente do que docs antigas diriam. Cite file:line nos pontos-chave. Marque o que esta stub/desabilitado para NAO ser documentado como ativo.',
    { agentType: 'Explore', phase: 'Investigar', label: 'inv:' + g.key }
  ),
  // 2) REESCREVER (edita arquivos)
  (findings, g) => agent(
    'Voce vai REESCREVER as paginas de documentacao do modulo "' + g.module + '" para refletir EXATAMENTE a funcionalidade real atual do produto.\n\n' +
    'ACHADOS REAIS DO CODIGO (fonte de verdade):\n' + findings + '\n\n' +
    'PAGINAS A EDITAR (leia cada uma com Read primeiro, depois reescreva com Write/Edit; mantenha o mesmo caminho):\n- ' + g.pages.join('\n- ') + '\n\n' +
    STYLE + '\n' + NAMING + '\n\n' +
    'Para cada arquivo: preserve a intencao da pagina, mas atualize todo o conteudo para a realidade dos achados. Se a pagina descrevia algo que nao existe mais, corrija. Edite TODOS os arquivos listados. Ao final retorne um resumo curto do que mudou por arquivo.',
    { agentType: 'claude', phase: 'Reescrever', label: 'write:' + g.key }
  ),
  // 3) VERIFICAR (le + corrige)
  (writeSummary, g) => agent(
    'Verifique as paginas reescritas do modulo "' + g.module + '":\n- ' + g.pages.join('\n- ') + '\n\n' +
    'Resumo da reescrita:\n' + writeSummary + '\n\n' +
    'Leia cada arquivo e cheque: (1) ZERO ocorrencia de "Confeitaria Artesanal", "confeitaria", "artesanal", "doces saudaveis", "Momma Sistema", "Gidape" (a empresa e so "Momma", o sistema e "MommaERP"); (2) frontmatter com description: presente; (3) estilo Material pt-BR (admonitions, tabelas, emojis) ok; (4) nada obviamente inventado/incoerente. CORRIJA voce mesmo qualquer problema via Edit. Retorne o verdict.',
    { agentType: 'claude', phase: 'Verificar', label: 'verify:' + g.key, schema: VERDICT }
  )
)

const okCount = results.filter(Boolean).filter((v) => v && v.ok).length
log('Grupos verificados OK: ' + okCount + '/' + GROUPS.length)
return { total: GROUPS.length, okCount, verdicts: results }
