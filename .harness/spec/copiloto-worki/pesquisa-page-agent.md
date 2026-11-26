# Avaliação técnica: alibaba/page-agent para o copiloto do Worki

Data: 25/11/2026. Base: commit `d8dd3344` (18/11/2026), pacote 1.12.4. Foi só leitura de código: nada instalado, nada executado, nenhum teste em navegador.
Legenda: **[código]** lido no fonte; **[doc]** afirmado pelo projeto; **[inferência]** dedução minha, não testada.
Clone: `C:\Users\user\AppData\Local\Temp\claude\025b17446c25563b\b93dd2bc-cfe7-4dcf-bef8-f1d6f9728c8b\scratchpad\page-agent-leitura\repo` (temporário). Caminhos abaixo são relativos a `packages/` em https://github.com/alibaba/page-agent.

## Veredito: NÃO ADOTAR para produção

Não usar o pacote `page-agent` (agente + painel) no Worki, nem o bundle de CDN.
Alternativa recomendada (opinião de projeto): copiloto com ferramentas tipadas próprias (`abrirRota`, `destacar(idDoAlvo)`, `explicar`), com registro de alvos `data-copiloto="..."`, sem enviar o DOM e sem clique ou digitação pelo modelo. Para "ensinar", a leitura genérica do DOM não é necessária.
Se o produto exigir agente que lê o DOM: o único formato defensável é **motor atrás de camada própria**, em protótipo com dados fictícios, com as condições da seção final.

## 1. Licença
MIT; copyright SimonLuvRamen (2026) e Alibaba Group Holding (2026) (`LICENSE`). Parte do DOM e dos prompts deriva do browser-use, também MIT [doc: README].

## 2. Maturidade
- API do GitHub em 25/11/2026: 29.756 estrelas, criado em 23/09/2025, último push 23/11/2026, não arquivado, 103 issues+PRs abertos.
- Releases: v1.12.4 em 06/09/2026; v1.12.0 em 09/07; v1.10.0 em 15/06. O `main` tem commits posteriores à última release.
- npm: 245.090 downloads entre 26/10 e 24/11/2026; um único maintainer (gaomeng1900).
- Concentração: Simon tem 1.004 commits no shortlog; nos últimos 6 meses, 140, contra 45 do dependabot e 1 de cada um de outros cinco autores. Fator ônibus 1.
- O nome é da organização Alibaba, mas os termos dizem que não é produto nem tem endosso da Alibaba **Cloud** (`docs/terms-and-privacy.md`). Não verifiquei o suporte institucional.
- Hooks marcados como `@experimental` (`core/src/types.ts`). O CHANGELOG lido tem breaking change em 1.10.0, versão menor.
- `docs/CHANGELOG.md` começa em 1.12.0, embora existam tags até 1.12.4.
- Security advisories publicados: 0 (API). Isso não prova ausência de falha. A busca web não achou CVE.

## 3. Arquitetura [código]
**Leitura** (`page-controller/src/dom/dom_tree/index.js`, `dom/index.ts`): percorre `body`, shadow DOM e iframes de mesma origem; indexa interativos e gera texto simplificado. Sem screenshot. Pula subárvores com `aria-hidden="true"`, `data-page-agent-ignore="true"` ou `data-browser-use-ignore="true"`.
`DEFAULT_VIEWPORT_EXPANSION = -1`: **a página inteira**, e `isTopElement` devolve sempre `true`. O system prompt diz que por padrão só o viewport é listado, o que diverge do código.

**Enviado ao LLM** a cada passo (`core/src/PageAgentCore.ts`, `llms/src/OpenAIClient.ts`), por `POST {baseURL}/chat/completions`:
- system prompt e schema das ferramentas;
- instruções e, se ligado, `/llms.txt` (desligado por padrão);
- pedido do usuário e hora;
- histórico: reflexões e memória do modelo, resultados das ações, observações (inclusive URL nova);
- **título e URL completa** (cabeçalho);
- texto da página (sem corte) e atributos, entre eles `value`, `name`, `placeholder`, `title`, `alt`, `aria-label`, `id` (cortados em 20 caracteres).

**Clique** (`actions.ts`): eventos sintéticos de ponteiro e mouse (`pointerType: 'mouse'`), `focus()`, `elementFromPoint`, `target.click()`.
**Digitação**: setter nativo de `value` mais evento `input`; `contenteditable` com eventos sintéticos e `execCommand`.
**Select**: casa só o texto visível, atribui `value`, dispara `change` (issue #749, aberta).
**Laço**: até 40 passos (padrão), uma macroferramenta `AgentOutput` por passo.
**Ferramentas**: done, wait, ask_user, click, input_text, select, scroll (2) e execute_javascript.

## 4. Modelos e proxy
- Só API compatível com OpenAI Chat Completions com tool calling (`OpenAIClient.ts`). A docs lista Qwen, GPT, Claude, Gemini, DeepSeek e outros; Claude exige endpoint compatível. Não testei nenhum. `modelPatch` altera o corpo conforme o nome do modelo (`llms/src/utils.ts`).
- **A chave pode ficar fora do navegador: sim.** `apiKey` é opcional; `baseURL` + `customFetch` permitem proxy próprio (docs de modelos, seção Production Authentication: `website/src/pages/docs/features/models/page.tsx`).
- No Worki seria uma Edge Function com JWT. **[inferência]** Como o cliente monta `messages` e `tools`, o proxy precisa fixar o modelo, limitar tamanho, taxa e custo, e validar ou reconstruir o corpo. Sem isso vira relay de LLM para qualquer usuário logado. Também precisa de CORS e de decisão LGPD sobre provedor, retenção e transferência internacional.
- A CSP atual do Worki (`frontend/vercel.json`) tem `connect-src` em modo Report-Only e já lista o domínio do Supabase.

## 5. Mascaramento e redação
**Não há redação nativa.** No `dom_tree/index.js` a busca por "password" não retornou nada. `dom/index.ts` ainda tem um `@todo` de filtro de dessensibilização.

**Risco grave com React [código]:** o React DOM 19.2.3 instalado no Worki sincroniza input controlado com o **atributo** `value` (`updateInput` chama `setDefaultValue`, que grava `defaultValue`; exceção: input `number` focado). O page-agent lê os atributos com `getAttribute` e inclui `value`. **[inferência forte, não testada]** CPF e telefone digitados cabem nos 20 caracteres e vão inteiros; **senha em input controlado, inclusive `type=password`, também iria** (até 20 caracteres). Chave PIX longa vai truncada, o que não é anonimizar. O conteúdo de textarea também pode ir como nó de texto.

**`transformPageContent` não basta [código]:** só transforma `browserState.content`. Ficam de fora:
- `header` (título e URL completa). No Worki, `/convite-equipe/:token` e `/convite/:token` levariam **o token do convite**;
- o pedido do usuário e as respostas de ask_user;
- o histórico. `clickElement` devolve a **linha original do elemento** (`elementTextMap`, montada antes da transformação) e `inputText` devolve o texto digitado. Ambos voltam no passo seguinte sem redação;
- a observação "Page navigated to → URL".

Redação completa teria de ocorrer em `transformRequestBody`/`customFetch` e de novo no servidor. Regex (a docs só traz exemplos para formatos chineses, e-mail e cartão) não pega nome, endereço ou texto livre.

**Logs [código]:** o agente faz `console.log` da entrada de cada ferramenta e do resultado, e guarda `rawRequest` no histórico em memória. **[inferência]** Se o Sentry do Worki capturar breadcrumbs de console, texto da tela pode ir para ele. Não conferi a configuração.

## 6. Controle de ações
| Recurso | Situação |
|---|---|
| Allowlist/denylist | `interactiveBlacklist`/`interactiveWhitelist` (elementos ou funções) e `data-page-agent-not-interactive` |
| Confirmação humana por ação | **Não há.** ask_user só roda se o modelo decidir. A docs "Security & Permissions" (com aviso beta) propõe controlar alto risco por **instrução no prompt**, o que não é barreira |
| Só destacar/ensinar | **Não há modo pronto.** Seria preciso remover ferramentas (`customTools: {click_element_by_index: null, ...}`) e criar a de destaque |
| Hook antes de cada ação | **Não há dedicado.** `onBeforeStep` roda antes da chamada ao LLM, quando a ação ainda não é conhecida. Dá para sobrescrever as ferramentas ou criar subclasse de `PageController` e injetar em `PageAgentCore` (`selectorMap` é `private` no TS) |

**A denylist é frágil [código]:**
- Compara o **elemento exato** (`interactiveBlacklist.includes(element)`), não a subárvore; o texto continua sendo enviado.
- `data-page-agent-not-interactive` usa `querySelectorAll`, também elemento a elemento.
- `cursor: pointer` torna qualquer elemento interativo, e esse teste vem **antes** das checagens de `disabled`. **[inferência]** Um filho de botão bloqueado herda o cursor, pode ser indexado, e o clique sobe até o botão. Botão desabilitado com cursor pointer também pode ser indexado.
- A allowlist **acrescenta** interativos. Não restringe o agente a eles.
- A barreira por subárvore é `data-page-agent-ignore`, que também esconde o conteúdo. Isso é opt-out: uma tela nova esquecida fica exposta.

## 7. React, dialog, mobile
- **Inputs controlados:** há tratamento (setter nativo + `input`). Select usa atribuição direta e `change`; **não testado** com React 19. O PR #718 (aberto) trata de ações que hoje falham em silêncio e verificação do valor; o mantenedor relatou falso negativo com máscara.
- `patchReact` só marca raízes (`#root`, `#app` etc.) como não interativas.
- **`<dialog>` nativo:** não achei tratamento específico (`dialog` aparece em `SEMANTIC_TAGS`; a busca de issues não retornou nada específico). Com `viewportExpansion=-1`, o conteúdo atrás do modal tende a ser lido e indexado, e a checagem `element.inert` não cobre inércia herdada do `showModal()`. **[inferência]** `target.click()` pode acionar algo atrás do modal. Máscara e painel são anexados ao `body`: ficam abaixo da top layer e inertes apesar do z-index alto, então **parar e responder ask_user podem ficar inacessíveis** com o modal aberto. Precisa de teste.
- **Mobile:** sem eventos de toque; sem hover real, arrastar ou atalhos [doc: limitations]. O painel tem media query para até 480px. Não testei teclado virtual, safe area nem convivência com a BottomNav. A máscara intercepta a tela enquanto o agente roda.

## 8. pt-BR
UI e `language` aceitam só `en-US` e `zh-CN` (`core/src/types.ts`, `ui/src/i18n/locales.ts`). O prompt manda responder no idioma do usuário [código]; qualidade em pt-BR não verificada. Para UI pt-BR: usar `PageAgentCore` sem o painel e `customSystemPrompt` ou instruções próprias.

## 9. Bundle
- bundlephobia (1.12.4): chunk principal 104.635 B min / 32.612 B gzip, mais um chunk de 22.200 / 7.208. Não verifiquei se o peer `zod` entra na conta; não vi `zod` na checagem do `package.json` do Worki, que filtrei só por react, vite e zod.
- IIFE de demonstração no jsDelivr: 228.364 B; 63.014 B com `gzip -9`.
- Não medi com o Vite do Worki. Se usado, carregar sob demanda.

## 10. Telemetria e endpoints de terceiros
- Busca textual nos fontes de core, llms, page-controller, ui e page-agent: as chamadas de rede encontradas são o LLM (`baseURL`) e `/llms.txt` da própria origem. Não vi analytics. **Não auditei** a dependência `ai-motion`, o `dist` publicado nem o tráfego real.
- No pacote npm, `baseURL` e `model` são obrigatórios (`parseLLMConfig`), sem fallback.
- **Há endpoint padrão de terceiro** no bundle demo/CDN (`page-agent/src/demo.ts`): `https://page-ag-testing-ohftxirgbn.cn-shanghai.fcapp.run`, modelo `qwen3.8-flash`, com autoinicialização. Segundo os termos, também é o padrão da extensão. Os dados são processados na **China continental**; o uso em produção e o envio de dados pessoais são **proibidos**. O projeto declara não armazenar nem registrar o conteúdo, o que não é verificável. Usar isso no Worki seria vazamento. O script demo ainda aceita `baseURL` e `apiKey` pela query da própria URL.
- Extensão e MCP: fora do escopo e não recomendados. A issue #647 (aberta) relata `ws://` local expondo chave e tarefas; há um PR de correção citado (#759), cujo estado não conferi. Não auditei esse código.

## 11. Prompt injection
- Texto de terceiros no Worki (mensagens, nomes, briefing, título de vaga, avaliações) entra no mesmo prompt do pedido do usuário. No system prompt lido **não achei** regra para tratar conteúdo da página como não confiável.
- Issue #212: o mantenedor descreve defesas básicas (remoção de parte do texto invisível, separação no prompt), diz que está longe de ser à prova de falhas e que a confirmação humana estava no roadmap (março/2026). Não achei esse recurso no código atual. https://github.com/alibaba/page-agent/issues/212
- Cenários **[inferência]**: uma avaliação ou mensagem induz o modelo a clicar em pagar, cancelar, convidar ou remover; ou a navegar por um link levando dados na URL; ou a digitar dados no chat e enviar a quem plantou a instrução. RLS não impede nada disso, porque a ação usa a sessão legítima.
- `execute_javascript` usa `eval` (`PageController.ts`). Vem **desligado** (`experimentalScriptExecutionTool`). Se ligado, injeção vira execução de código na sessão. Issue #643, aberta. Nunca ligar.
- Audits de terceiros sobre uma skill que usa o page-agent apontam a mesma superfície, com severidades divergentes: https://www.skills.sh/nousresearch/hermes-agent/page-agent/security/snyk e https://www.skills.sh/nousresearch/hermes-agent/page-agent/security/agent-trust-hub (vistos só pelo resumo da busca).
- O painel usa `innerHTML`; os cartões lidos escapam `content` com `escapeHtml`. Não auditei todos os caminhos.

## Condições mínimas, se insistirem no protótipo
1. Importar só `PageController` (e, se preciso, `PageAgentCore` + llms), versão fixa. Sem CDN, painel, extensão ou MCP.
2. Remover click, input, select e execute_javascript; deixar destaque e explicação. Se um dia houver ação: allowlist própria com negação por padrão, checada no executor, e confirmação em UI própria que o agente não indexe. Pagar, cancelar/excluir, convidar e remover ficam sempre manuais.
3. Reconstruir o estado enviado: só alvos registrados e rótulos estáticos. Sem `value`, sem texto de terceiros, URL reduzida ao padrão da rota.
4. Proxy em Edge Function (JWT, modelo fixo, cotas, validação, sem log do corpo) e ADR de LGPD. O Article 16 da constitution diz que o produto não depende de IA para funcionar: o copiloto precisa ser opcional.
5. Testes com dados fictícios antes de qualquer decisão: captura do corpo enviado (CPF, PIX, senha, token), denylist com filho clicável, `showModal`, celular real, injeção por mensagem e avaliação.

## Não verificado
Execução real; qualidade, custo e latência dos modelos; pt-BR; React 19 com o agente; dialog e mobile no navegador; `ai-motion` e o `dist`; extensão e MCP; configuração do Sentry; leitura integral das issues e PRs (fiz buscas por palavra e li uma amostra); site de docs ao vivo (o WebFetch devolveu 503 no quick-start, então usei o fonte da docs no repositório).
