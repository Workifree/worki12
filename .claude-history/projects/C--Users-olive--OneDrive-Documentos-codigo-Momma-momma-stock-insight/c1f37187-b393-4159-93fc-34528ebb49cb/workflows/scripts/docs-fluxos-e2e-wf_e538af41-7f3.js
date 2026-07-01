export const meta = {
  name: 'docs-fluxos-e2e',
  description: 'Audita e documenta os fluxos end-to-end reais (diagrama + passo-a-passo) por jornada',
  phases: [
    { title: 'Investigar', detail: 'Mapeia o fluxo real no codigo por jornada' },
    { title: 'Documentar', detail: 'Adiciona o fluxo (Mermaid + passos) na pagina' },
    { title: 'Verificar', detail: 'Confere fidelidade, Mermaid e naming' },
  ],
}

const NAMING = 'MARCA: empresa = so "Momma"; sistema = "MommaERP". NUNCA "Confeitaria Artesanal"/"confeitaria"/"artesanal"/"doces saudaveis"/"Momma Sistema"/"Gidape".'
const STYLE = 'ESTILO: MkDocs Material pt-BR. Preserve o conteudo correto ja existente da pagina; ADICIONE (ou corrija) uma secao de FLUXO end-to-end intitulada tipo "Como [X] acontece (ponta a ponta)", contendo: (1) um diagrama Mermaid VALIDO (flowchart LR/TD ou stateDiagram-v2) do fluxo real; (2) um passo-a-passo NUMERADO com as transicoes de estado, rotas e gatilhos reais. Use admonitions/tabelas quando ajudar. NAO invente: descreva apenas o que os achados do codigo comprovam. Mantenha os MESMOS arquivos (nao crie/renomeie paginas).'

const FLOWS = [
  { key: 'requisicao', journey: 'Requisicao ponta-a-ponta (manual + automatica por IA)',
    hint: 'Manual: supabase/functions/process-requisition-ai (parse, source_text verbatim) + fuzzy match (~0.72) + produto_aliases + review-requisition-matches. Automatica: requisicao-automatica-ia + RPC drp_gerar_requisicoes (forecast, shelf-life cap 3-5d, lojas 2-6). Ciclo: status em_fila->em_progresso->finalizada (src/shared/lib/logistics-utils, Logistica.page). Separacao via PickingBipModal (flag foi_separada), expedicao na Torre de Controle, chegada em /requisicoes/chegada. NAO confundir Torre de Controle com requisicao (fluxos independentes).',
    pages: ['docs/modulos/logistica/requisicoes.md'] },
  { key: 'encomenda', journey: 'Encomenda (cliente/PJ): criar -> pronto -> entrega/retirada + recorrencia',
    hint: 'src/features/encomendas (Encomendas.page, EventosTimeline). Status aberto/pronto/finalizado (preparado_at/preparado_por). Recorrencia: split em 2 paginas + projecao virtual (recurrence_excluded_dates, NAO materializa linhas). Campo preco.',
    pages: ['docs/modulos/logistica/encomendas.md'] },
  { key: 'producao-estoque', journey: 'Producao -> Estoque (ciclo fechado): producao diaria -> lotes -> estoque -> perdas/qualidade',
    hint: 'DailyProductionForm, daily_production (loja_id NULL = fabrica, producao centralizada), daily_production_products. Como a producao vira lote/estoque. Perdas/verificacao de qualidade (op_perdas / verificacao de perdas). Reconciliacao estoque<->lotes (sync_estoque_from_lotes, guard app.skip_lote_reconcile) e shelf-life 3-5d como cap.',
    pages: ['docs/modulos/producao/README.md'] },
  { key: 'nf-financeiro', journey: 'Nota Fiscal (OCR) -> Financeiro/Estoque',
    hint: 'Upload da foto da NF -> bucket -> OCR server-side em base64 (sem OOM Android) via OpenRouter (validar model slugs, Gemini). Extracao -> revisao -> cadastro. Como vira conta a pagar (contas_pagar_receber.origem) e itens_nota_fiscal (insumos/estoque). supabase/functions de OCR de NF.',
    pages: ['docs/modulos/notas-fiscais.md','docs/inteligencia-artificial/ocr-notas.md'] },
  { key: 'conciliacao', journey: 'Conciliacao bancaria (match algoritmico + IA)',
    hint: 'Import OFX -> matching 2-step: (1) algoritmico exato (CNPJ/CPF/valor/data), (2) fallback IA para matches fuzzy. Como concilia contra contas_pagar_receber / movimentacoes. src/features/financeiro (banco/conciliacao) + edge function.',
    pages: ['docs/inteligencia-artificial/conciliacao-bancaria.md'] },
  { key: 'mia-acao', journey: 'MIA executando uma acao (mensagem -> resultado)',
    hint: 'Fluxo de EXECUCAO de acao: mensagem -> router (keywordPreRoute/LLM) -> agent especialista (ReAct) -> tool/skill -> no frontend, acoes com requires_confirmation viram ConfirmationCard; usuario confirma -> executeSingleAction (sequencial, delay ~400ms) -> resultado. Acoes destrutivas (isDestructiveAction) sempre pedem confirmacao. supabase/functions/mia (router, agents, tools) + src/features/mia (useMia confirmPendingActions, MiaMessageList). Task plan: preview->aprovar->executar. Streaming token-a-token.',
    pages: ['docs/inteligencia-artificial/mia-chat.md'] },
  { key: 'degust', journey: 'PDV Degust -> Vendas/Financeiro',
    hint: 'Edge functions degust-sync-sales (produtos -> degust_vendas_diarias) e degust-pos-financial (flash-vendas + ticket-medio). Bearer token ~4h (secret DEGUST_API_TOKEN). degust_product_mapping. Telas QtdVendas e PontoDeVendaPanel (aba PDV do Financeiro). Loja 1=Lago Sul(4), Loja 2=Aguas Claras(5). Endpoints que funcionam vs vazios.',
    pages: ['docs/modulos/vendas/integracao-degust.md'] },
]

const VERDICT = {
  type: 'object', additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    mermaid_valido: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
    fixed: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'mermaid_valido', 'issues', 'fixed'],
}

log('Documentando ' + FLOWS.length + ' fluxos end-to-end contra o codigo real')

const results = await pipeline(
  FLOWS,
  (f) => agent(
    'Mapeie no CODIGO REAL (src/ e supabase/) o fluxo END-TO-END da jornada: ' + f.journey + '.\n' + f.hint +
    '\n\nNAO use docs/ como fonte. Retorne o fluxo real em PASSOS NUMERADOS (com transicoes de estado, rotas, RPCs/edge functions e gatilhos), citando file:line. Liste tambem o que a pagina de doc atual erra/omite sobre esse fluxo.',
    { agentType: 'Explore', phase: 'Investigar', label: 'inv:' + f.key }
  ),
  (findings, f) => agent(
    'Documente o fluxo END-TO-END real da jornada "' + f.journey + '" na(s) pagina(s): ' + f.pages.join(', ') + '.\n\n' +
    'ACHADOS REAIS (fonte de verdade):\n' + findings + '\n\n' +
    'Leia a(s) pagina(s) com Read, depois ADICIONE/CORRIJA a secao de fluxo conforme o ' + STYLE + '\n' + NAMING + '\n\n' +
    'Edite o(s) arquivo(s) com Edit/Write. Retorne resumo do que mudou.',
    { agentType: 'claude', phase: 'Documentar', label: 'doc:' + f.key }
  ),
  (writeSummary, f) => agent(
    'Verifique a(s) pagina(s) ' + f.pages.join(', ') + ' apos adicionar o fluxo da jornada "' + f.journey + '".\n' +
    'Resumo:\n' + writeSummary + '\n\n' +
    'Cheque e CORRIJA via Edit se preciso: (1) o bloco Mermaid e sintaticamente valido (fences ```mermaid, nó/seta corretos, sem caracteres que quebrem); (2) ZERO marca proibida (Confeitaria/artesanal/doces saudaveis/Momma Sistema/Gidape); (3) frontmatter description: presente; (4) o fluxo bate com os passos reais (nao inventado). Retorne verdict.',
    { agentType: 'claude', phase: 'Verificar', label: 'chk:' + f.key, schema: VERDICT }
  )
)

const ok = results.filter(Boolean).filter((v) => v && v.ok && v.mermaid_valido).length
log('Fluxos OK: ' + ok + '/' + FLOWS.length)
return { total: FLOWS.length, ok, verdicts: results }
