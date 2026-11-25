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

### Provedor e custo
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
- Anthropic usa a Messages API nativa (`anthropic-version: 2026-10-21`); ferramenta forçada no Haiku, `auto` no Sonnet 5.5.
- Limites (secrets opcionais, com padrão): `COPILOT_LIMIT_PER_MINUTE` 20, `COPILOT_LIMIT_PER_DAY` 200 chamadas (um passo = uma chamada),
  `COPILOT_USER_DAILY_TOKENS` 600.000, `COPILOT_GLOBAL_DAILY_TOKENS` 3.000.000. O orçamento é em **tokens**, não em dólar: ao trocar de
  modelo, rever. Com Haiku 5.5, o teto global fica abaixo de US$ 1,50 por dia mesmo se tudo fosse saída.

## 5. Verificado e como
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
