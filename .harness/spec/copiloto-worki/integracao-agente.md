# Integração do copiloto agêntico

Estado em 25/11/2026: código pronto atrás de flag; **nada montado, aplicado, publicado ou commitado**. Decisões e riscos: `ADR-agente-com-page-agent.md`.

## 1. Montar (uma linha, em `App.tsx`)
Dentro do `BrowserRouter` (e do `AuthProvider`, que já o envolve), ao lado de `<PwaPrompts />`:

```tsx
import CopilotRoot from './components/copilot/CopilotRoot'
...
<CopilotRoot onOpenGuide={() => guia.abrirAjuda()} />   // guia de lib/guide/api
```

- Desligado, não renderiza nada. O painel e o motor são `lazy`: o motor só baixa na primeira tarefa.
- `useAuth` e `guia.abrirAjuda()`: o `GuideProvider` precisa estar montado para o guia responder. Sem `onOpenGuide`, o modo guia leva a `/ajuda`.
- O copiloto some sem sessão, em `/convite*`, login, senha, onboarding, admin, rota desconhecida e com o `tos-gate-modal` aberto.
- O acionador é uma aba de 44 px na borda direita, a 58% da altura (um botão no rodapé cobriria a `ActionBar`). Para pôr o botão num
  menu ou cabeçalho: `showLauncher={false}` e `window.dispatchEvent(new Event('worki:copilot:open'))` (`OPEN_EVENT`).

## 2. Com o guia (`components/guide`, `lib/guide`)
Hoje não há import entre os dois.
- **Tutorial no login** e "disponível a qualquer momento" sem IA são do guia (`GuideWelcome`, `BotaoComoFaco`). O copiloto não abre tutorial sozinho.
- Qualquer elemento `[data-guide]` é ignorado pelo copiloto (não lê nem aciona). Se o guia puser interface sem esse atributo, adicionar.
  Não envolver conteúdo do **app** em `data-guide`, ou ele some para o copiloto.
- Destaque unificado (opcional): passar `overrides={{ highlighter }}` a `CopilotRoot`, com `show(el)` chamando
  `guia.destacar(el.getAttribute('data-copilot'), texto)` quando houver âncora e caindo em `createOutlineHighlighter()` quando não.
  Testar dentro de `<dialog>` e conferir se o clique da pessoa ainda chega ao alvo. Memorizar o objeto (fora do componente).
- "Abrir o guia" a partir do copiloto: `guia.iniciarRoteiro(id)` pode virar ferramenta no futuro (exige incluir a ação em
  `session.ts` e em `contract.ts`).
- As rotas do copiloto (`lib/copilot/routes.ts`) são separadas das do guia: **rota nova precisa entrar lá**, senão o copiloto a trata como bloqueada.

## 3. Marcação nas telas (para quem edita telas)
- `data-copilot-risk="D"` em todo gatilho D. Prioridade para o que o texto não denuncia: toggles de consentimento e privacidade, botões com
  ícone ou rótulo vago, modais de dinheiro e de acesso (marcar o próprio `<dialog>`).
- `data-copilot-private` em: PIX, CPF, CNPJ, telefone e e-mail exibidos (`MemberCard`, modal de pagamento), link e QR de convite, recibo e
  termo, dados do onboarding. **Hoje nenhuma tela usa o atributo.** Redação e vocabulário cobrem parte, mas esta é a camada que remove.
- `data-copilot-risk="A"` só em controle sem efeito nenhum.
- Revisar o que grava sozinho (`onChange`/`onBlur`) e handlers de aba, link e menu que gravam: o copiloto não pede cartão para eles.
- Preferir `<button>` ou `role` a `div` com `onClick`, que o copiloto não enxerga.
- Palavra nova de interface que apareça como "..." deve entrar em `lib/copilot/vocabulary.ts`. Nunca adicionar nome de pessoa ou empresa.

## 4. O que o dono precisa fazer, nesta ordem
1. **Antes de gente real:** `harness-security-reviewer` no diff; decisão LGPD com advogado e Política de Privacidade; emenda ao Article 16.
2. **Migration** `supabase/migrations/20261130000100_copiloto_cota.sql`, aplicada de forma dirigida por MCP (**não** usar `supabase db push`).
   Conferir no catálogo: RLS ligado, zero policies, `EXECUTE` só para `service_role`.
3. **Chave só como secret** (nunca `VITE_*`, nunca no repo). Criar chave exclusiva e **teto de gasto no painel do provedor**.

   ```bash
   supabase secrets set COPILOT_LLM_PROVIDER=anthropic COPILOT_LLM_MODEL=claude-haiku-5-5 COPILOT_LLM_API_KEY=<chave> --project-ref vrklakcbkcsonarmhqhp
   ```
4. **Deploy** com verificação de JWT (sem `--no-verify-jwt`): `supabase functions deploy copilot-llm --project-ref vrklakcbkcsonarmhqhp`.
   São cinco arquivos: `index.ts`, `handler.ts`, `contract.ts`, `providers.ts`, `redact.ts`. Preview da Vercel precisa entrar em `COPILOT_ALLOWED_ORIGINS`.
5. **Flag:** `VITE_COPILOT_ENABLED=true` (primeiro só local ou preview) e novo build. A CSP atual já permite o domínio do Supabase.
6. **Desligar:** `COPILOT_ENABLED=false` nos secrets (a UI cai no modo guia) ou remover a flag e republicar.

### OpenRouter (`PROVIDER=openrouter`; modelo padrão ainda não definido, sai do teste)
Endpoint fixo `https://openrouter.ai/api/v1/chat/completions`. Todo pedido leva, fixo no código,
`provider: {data_collection:'deny', zdr:true, require_parameters:true, allow_fallbacks:true}`; o fallback só alcança endpoint que
passa por esses filtros. Sem `HTTP-Referer`, `X-Title` ou `user`. Sem chamada de ferramenta = 502 `model_no_action`; argumentos
inválidos, várias chamadas ou resposta cortada = 502 `invalid_model_output`.
Com `zdr:true`, a conta ainda pode admitir endpoints de "Safety Retention": **escolher "ZDR only"** em
https://openrouter.ai/settings/privacy e manter desligados o registro de entradas/saídas e o uso dos dados para treino. A triagem de
CSAM em trânsito anunciada pelo OpenRouter também vale para tráfego ZDR (considerar na decisão LGPD).

Premissa não medida: 40 mil tokens de entrada e 2 mil de saída por tarefa. Preços da API pública (US$/Mtok), lidos em 26/11/2026.

| Modelo (só estes 7; outro = 503) | Entrada / saída | ~US$ por tarefa | ~por 1.000 | `tool_choice` |
|---|---|---|---|---|
| `upstage/solar-mini-4-5` | 0,01 / 0,04 | 0,00048 | 0,48 | forçado |
| `inclusionai/ling-3.0-flash` (ZDR: DeepInfra, 0,06 / 0,18) | 0,06 / 0,18 | 0,00276 | 2,76 | `auto` |
| `thinkingmachines/inkling-2-mini` | 0,075 / 0,30 | 0,00360 | 3,60 | forçado |
| `google/gemma-4-26b-a4b-it` | 0,0765 / 0,255 | 0,00357 | 3,57 | forçado |
| `z-ai/glm-5.3-flash` (raciocínio obrigatório) | 0,12 / 0,38 | 0,00556 | 5,56 | forçado |
| `deepseek/deepseek-v4.1-flash` | 0,051 / 0,567 | 0,00317 | 3,17 | forçado |
| `anthropic/claude-haiku-5.5` (acima de 100 mil: 0,50 / 2,50) | 0,10 / 0,50 | 0,00500 | 5,00 | `auto` |

- O preço é o de referência: o endpoint ZDR que atende pode cobrar mais (no DeepSeek há de 0,05 a 1,50 na entrada). Em produção não
  há `max_price`; o teto financeiro é o da chave.
- Passos: chave exclusiva com limite de crédito no painel; secrets `COPILOT_LLM_PROVIDER=openrouter`,
  `COPILOT_LLM_MODEL=<escolhido no teste>`, `COPILOT_LLM_API_KEY=<chave>`; redeploy. Modelos com raciocínio podem gastar os 2.000
  tokens de saída antes de chamar a ferramenta: o teste mostra isso como erro.

**Reserva de modelo (decisão do dono, 26/11/2026; `copilot-llm/handler.ts` e `providers.ts`)** — só OpenRouter:
- Fila por pedido: `COPILOT_LLM_MODEL` (padrão `anthropic/claude-haiku-5.5`), depois `COPILOT_LLM_FALLBACKS` (secret opcional, separado por
  vírgula; padrão `z-ai/glm-5.3-flash,thinkingmachines/inkling-2-mini`). Cada item é validado contra a allowlist de PRODUÇÃO (só ZDR);
  item inválido é ignorado (log `reserva_ignorada` com a contagem, sem o nome), duplicatas saem, máximo 3 modelos. Secret vazio = sem reserva.
- É sequencial no proxy (não usa o campo `models` do OpenRouter): ZDR, `data_collection: deny`, `require_parameters` e o `tool_choice`
  de cada modelo (forçado, exceto Haiku 5.5 e Ling, que usam `auto`) valem para todos.
- Só falha de infraestrutura passa para o próximo: erro de rede, timeout, HTTP 5xx, 404, 408, 429 e `error` no corpo de um 200
  ("Provider returned error"). 401, 402 e 403 (também dentro de um 200) falham claro (`provider_NNN`), sem tentar outro. Resposta ruim do
  modelo (texto solto, ação inválida) NÃO troca de modelo: segue a nova tentativa no mesmo modelo.
- Limites: 20 s por tentativa, 55 s no total, no máximo 3 tentativas. Se todas falharem: 502 `all_providers_failed`.
- A cota é reservada UMA vez por pedido; o acerto usa os tokens de quem respondeu mais os de tentativas que falharam e cobraram.
- Disjuntor em memória (por instância): modelo que falhou fica 60 s fora da fila; com todos fora, tenta o principal. 401/402/403 não o abrem.
- Log (sem conteúdo): `{fn:'copilot-llm', event:'fallback', de, para, motivo}`. Só no modo de avaliação (que nunca usa reserva, para não
  misturar modelos na comparação) a resposta traz `eval.answered_model` e `eval.attempts`.
- Contas de teste (os dois ids do handler): 30/min, 1.500/dia, 2,5 milhões de tokens/dia; usuário comum e teto global inalterados.
- **Publicar** (nada disso vale antes): `scripts/copiloto-deploy.ps1`.

**Teste de modelos** (`scripts/copiloto-eval/`, telas fictícias, Node 22.18+; chave só em `OPENROUTER_API_KEY` no ambiente):
1. Ensaio sem rede: `node scripts/copiloto-eval/run.mjs --simular`.
2. Fase 1: `node scripts/copiloto-eval/run.mjs` (7 modelos, 7 tarefas, 1 repetição; mais baratos primeiro, Haiku por último).
   `--sem-zdr` inclui `qwen/qwen3.7-flash`, que não tem ZDR e fica fora da produção (imprime aviso; `data_collection:'deny'` continua).
3. Fase 2: `... --fase 2 --modelos x,y` (2 ou 3 melhores, 3 repetições; `--repetir N`).
- `--teto-usd` (padrão 0,25 por execução; a chave do dono tem US$ 0,30 **no total**, então a fase 2 precisa receber o que sobrou).
  Antes de cada chamada reserva o pior caso (com `max_price` 0,50 / 2,00) e usa o custo devolvido pela API. 401, 402, 403 ou teto
  encerram com o parcial salvo; a tabela compara só rodadas que todos os modelos terminaram. JSON em `resultados/` (ignorado pelo git).
- Critério sugerido: zero violações primeiro; depois acerto, custo e latência. Amostra pequena: não prova segurança.

### Provedor e custo (APIs diretas)
Preço por milhão de tokens (entrada / saída). Anthropic: tabela da referência oficial da API, em cache de 03/11/2026. OpenAI: página
oficial consultada em 25/11/2026 (https://developers.openai.com/api/docs/pricing.md).
**Custo por tarefa é estimativa não medida**: cerca de 35 mil tokens de entrada e 2,5 mil de saída (uns 8 passos).

| `PROVIDER` / `MODEL` | US$ por MTok | ~US$ por tarefa | ~por 1.000 tarefas |
|---|---|---|---|
| `anthropic` / `claude-haiku-5-5` (sugerido; prompts até 100 mil) | 0,10 / 0,50 | 0,005 | 5 |
| `anthropic` / `claude-haiku-4-5` | 1,00 / 5,00 | 0,048 | 48 |
| `anthropic` / `claude-sonnet-5-5` | 2,00 / 10,00 | 0,095 ou mais (raciocina) | 95+ |
| `openai` / `gpt-4.1-mini` | 0,40 / 1,60 | 0,018 | 18 |
| `openai` / `gpt-5.4-mini` | 0,75 / 4,50 | 0,038 | 38 |
| `openai` / `gpt-6-luna` | 0,10 / 0,50 | 0,005 | 5 |

- Também aceitos: `gpt-5.6-luna`, `gpt-5.4-nano`, `gpt-5-mini`, `gpt-4o-mini`. Modelo ou provedor fora da lista = 503.
- Modelos com raciocínio cobram saída extra, e algum modelo OpenAI pode recusar parâmetros do adaptador: **testar com a chave real antes de escolher**.
- Anthropic usa a Messages API nativa (`anthropic-version: 2026-10-21`, versão atual em
  https://platform.claude.com/docs/en/api/versioning, conferida em 26/11/2026; ela remove `temperature`, `top_p` e `top_k`, que
  não enviamos); ferramenta forçada no Haiku, `auto` no Sonnet 5.5.
- Limites (secrets opcionais, com padrão): `COPILOT_LIMIT_PER_MINUTE` 20, `COPILOT_LIMIT_PER_DAY` 200 chamadas (um passo = uma chamada),
  `COPILOT_USER_DAILY_TOKENS` 600.000, `COPILOT_GLOBAL_DAILY_TOKENS` 3.000.000. O orçamento é em **tokens**, não em dólar: ao trocar de
  modelo, rever. Com Haiku 5.5, o teto global fica abaixo de US$ 1,50 por dia mesmo se tudo fosse saída.

## 5. Verificado e como
- 26/11/2026: `proxy-openrouter.test.ts`, `proxy.test.ts` e `redacao.test.ts` (112) e `node --test scripts/copiloto-eval/avaliador.test.mjs`
  (15). Nenhuma chamada a API de modelo. A redação ganhou teto de trecho (200 caracteres sem espaço viram `[oculto]`) para custo linear.
- `npx vitest run src/lib/copilot src/components/copilot`: 180 testes do copiloto (o filtro inclui também os 4 de `copilotAnchors.test.ts`).
  `tsc -b` e ESLint dos diretórios novos do frontend limpos. A pasta da edge function fica fora do ESLint do frontend; ela é checada pelo
  `tsc` via imports dos testes, exceto `index.ts` (Deno, não compilado aqui).
- Mutação: desligando redação caem 43 testes; guarda de eventos, 7; veto D, 32; filtro de vocabulário, 4.
- Build isolado do copiloto: sem `fcapp.run`/aliyun e sem o painel do page-agent. Sem minificação de espaços (modo biblioteca): motor
  ~62 kB gzip, painel ~24 kB, raiz ~5 kB. Sai também um chunk `SimulatorMask` (~7,5 kB) que não é carregado (máscara desligada).
- Migration em PGlite (Postgres em WASM, com stubs de `auth` e dos papéis): reaplicável, quatro limites, acerto, e `anon`/`authenticated` sem acesso.
- O build completo (`npm run build`) e a suíte inteira **não** foram rodados.

## 6. Só se prova no navegador real
O modelo foi **simulado** e o DOM é jsdom, sem layout nem top layer.
1. `<dialog>` + `showModal()`: PARAR e cartão tocáveis (popover dentro do modal); fechar e reabrir modais empilhados (`useStackedModal` reabre diálogos).
2. Safari/iOS antigo e WebView sem Popover API ou `showModal`.
3. `isTrusted`: toque humano passa e clique do copiloto é barrado; ativação por `label`; TalkBack/VoiceOver e gerenciador de senha durante uma tarefa.
4. `elementFromPoint` real (filho no centro), clique em cartões e menus (`Menu` em popover).
5. Inputs reais `date`, `time`, `number` e `select` nas telas verdadeiras (`CompanyCreateJob`): os testes usam uma réplica.
6. 320 e 390 px, teclado virtual, safe area, `BottomNav`, `ActionBar` e a aba lateral cobrindo conteúdo.
7. Classes Tailwind que escondem elementos (`hidden`, responsivas) e menus desktop/celular duplicados.
8. Rotas `lazy`: se 700 ms bastam depois de `navigate`.
9. Capturar na aba de rede o corpo real nas telas de elenco, perfil, presença, recibo e mensagens, **com dados fictícios**.
10. Console e Sentry (breadcrumbs do page-agent).
11. Com chave real: CORS e JWT no Deno publicado, qualidade em pt-BR, custo, latência, e um conjunto de injeção a cada troca de modelo ou prompt.
