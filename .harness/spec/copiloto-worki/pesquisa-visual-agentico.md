# Pesquisa visual do Copiloto: presença do agente, brilho, gota, cursor e toque virtuais

> Data: 26/11/2026. Escopo: só pesquisa e protótipo. Nada em `frontend/src` ou `supabase/` foi alterado.
> Protótipo: `scripts/copiloto-vfx-demo/index.html` (um arquivo, sem build, sem CDN). Automação: `scripts/copiloto-vfx-demo/ferramentas.mjs`.
> Convenção: **[fato]** tem fonte citada ou foi medido/lido por mim; **[opinião]** é julgamento meu ou de quem escreve a fonte; **[não verificado]** é o que não consegui confirmar.

## 0. Resumo em 12 linhas

1. O efeito "gota" do Copilot do Windows **não está documentado** em fonte oficial nem em análise confiável que eu tenha achado. O que existe: janela de voz com microfone ao segurar a tecla e um brilho ao redor da janela compartilhada no Copilot Vision. A gota é a descrição do dono; reproduzi por desenho próprio.
2. O padrão que o mercado convergiu: **brilho colorido só nas bordas** (Siri, Gemini, Claude in Chrome), **cursor fantasma** com etiqueta e **botão de parar sempre à mão**.
3. A decisão que mais pesa em desempenho não é a aparência, é a técnica: o mesmo brilho feito com `@property` + `blur` consome **63% da thread principal a 6x** contra **22%** feito com `transform: rotate` dentro de máscara estática (medido, seção 5).
4. Recomendação: **CSS compositor** (rotate + máscara) como padrão no PC e no celular. WebGL e canvas só como alternativa; `ai-motion` não é necessário.
5. Gota no PC: queda 560 ms, 3 ondas, 1,25 s, brilho acende após 280 ms. No celular: 2 ondas, sem filtro SVG, brilho baixo/médio.
6. Cores: azul `#2563EB`, violeta `#7C3AED`, verde `#00A651`, e uma lasca de âmbar `#F59E0B`. Opacidade máxima 0,78 na borda.
7. Movimento reduzido: versão estática bonita (borda em gradiente fixa, sem rotação, sem ondas). Nada pisca; nenhum efeito passa de 1 ciclo por 5 s.
8. Evitar: animar `box-shadow`, `left/top`, `background-position` de texto, `filter: blur` sobre conteúdo que se move, `backdrop-filter` no celular, feDisplacementMap na página inteira.

## 1. Como abrir o demo

- Abra `scripts/copiloto-vfx-demo/index.html` no Chrome/Edge/Safari (duplo clique, `file://`). Sem servidor.
- Abas A a F: A gota, B brilho, C cursor (PC), D toque (celular), E pílula com shimmer, F barra de comando. Aba **Medições** mostra as tabelas e o botão "Medir neste aparelho" (cerca de 1 minuto).
- Em A, **toque e segure** em qualquer ponto da tela simulada. Cada palco tem "Ampliar" para ver em tela cheia (Esc fecha). "Simular movimento reduzido" liga a versão estática.
- Para refazer quadros e medições: `node scripts/copiloto-vfx-demo/ferramentas.mjs quadros <pasta>` e `node ... medir` (Chrome headless em porta própria 9351; `VFX_NOGPU=1` mede sem GPU).
- Quadros que usei para julgar: 1440x900 e 390x844 a 2x, 3 a 5 instantes por efeito. Os efeitos CSS/WAAPI são congelados por `Animation.currentTime`, então os quadros são determinísticos.

## 2. O que pesquisei

### 2.1 Efeito do Copilot do Windows (gota, ondulação, brilho)

- **[fato]** A documentação da Microsoft descreve o toque longo na tecla Copilot (ou Win+C) como abertura de uma pequena janela de controle de voz, com um microfone no centro, que permanece na tela. https://learn.microsoft.com/en-us/windows/client-management/manage-windows-copilot
- **[fato]** "Hey Copilot" é opt-in e abre conversa por voz mãos-livres (mesma página).
- **[fato]** Press to talk (Alt+Espaço por 2 s) começou no canal Insider em 10/03/2025; ao terminar, o microfone na tela some. https://blogs.windows.com/windows-insider/2025/03/10/copilot-on-windows-press-to-talk-begins-rolling-out-to-windows-insiders/
- **[fato]** No Copilot Vision, o post Insider de 28/10/2025 diz: "You will see a glow around the app or window that you are sharing with Copilot." https://blogs.windows.com/windows-insider/2025/10/28/copilot-on-windows-vision-with-text-input-begins-rolling-out-to-windows-insiders/
- **[não verificado]** A "gota que cai, ondula e brilha colorido em volta" ao segurar. Fiz duas buscas amplas e não achei descrição oficial nem análise confiável. Não afirmo como o efeito é feito.
- **[opinião]** O que vale copiar não é a técnica do Windows, é a **semântica**: o brilho é o sinal de "o agente está ouvindo/trabalhando nesta janela", e o gesto de segurar dá feedback imediato no ponto do toque.

### 2.2 Referências do mercado

| Referência | O que se sabe | Fonte | Observação |
|---|---|---|---|
| Siri (Apple Intelligence) | Orbe trocado por brilho de arco-íris na borda; segura o botão lateral e raios saem desse lado; voz mostra o brilho subindo de baixo. Você continua rolando e digitando durante o Siri. | https://9to5mac.com/2024/11/03/new-apple-intelligence-siri-looks-different-works-the-same/ (03/11/2024), https://www.slashgear.com/1865686/iphone-glowing-around-edges-reason/ | **[opinião da imprensa]** O visual "superou" a capacidade. Um relato de 2026 diz que a Apple estaria abandonando o brilho de borda; **[não verificado]**: https://tech.yahoo.com/ai/articles/apple-siri-redesign-finally-addresses-180115709.html |
| Gemini no Android | Painel flutuante com brilho (ago/2024); testes recentes com brilho nas bordas inferiores e animação com pontos e "faíscas"; Circle to Search banha a tela inteira em tom quente. | https://9to5google.com/2024/08/23/gemini-glow-floating-overlay/, https://www.androidauthority.com/gemini-overlay-sparkling-animation-rollout-3729835/, https://www.androidauthority.com/google-gemini-ui-update-animation-you-tab-apk-teardown-3732589/ | O brilho de perímetro completo vem de fontes secundárias e de teardown; **[não verificado]** como oficial. |
| Claude in Chrome | Borda de brilho sobre a página, cursor "fantasma", controle de parar. Em "agir sem perguntar" aparece borda amarela pulsante tracejada. | https://www.arkoselabs.com/blog/every-agent-hides-somewhere-none-hide-everywhere, https://github.com/afterglow-labs/claude-edge-window-mode | **[fato]** O brilho é feito animando `box-shadow` e gerou relato de **~50% de CPU em M1** (issue aberta em 22/01/2026, fechada "not planned"): https://github.com/anthropics/claude-code/issues/20070 |
| Samsung Now Bar | Mostra atividades em andamento; não achei animação de brilho de IA documentada. | https://9to5google.com/2025/05/06/one-ui-8-now-bar-changes/ | **[não verificado]** a parte visual. |
| Atlas, Comet | Não achei descrição do indicador de agente operando. | - | **[não verificado]** |
| Dynamic Island, Raycast, Linear | Não obtive fonte (o fetch da Apple HIG devolveu só o título). | - | Uso como **[opinião]**: pílula que muda de estado e barra de comando abrindo rápido, com foco no teclado, são referência de "enxuto". |
| page-agent (Alibaba) | `SimulatorMask` = shader WebGL2 (`ai-motion`) + cursor próprio. | seção 2.4 | Lido no código instalado. |

**Padrões de "agente trabalhando" que se repetem [opinião, síntese]:** (1) borda luminosa que respira; (2) pílula ou orbe de status com o passo atual; (3) cursor/toque virtual com etiqueta de quem é; (4) botão **Parar** sempre visível; (5) o usuário continua podendo ver e, quando possível, interagir.

### 2.3 Como implementar, com desempenho e acessibilidade

- **[fato]** `transform` e `opacity` são as únicas propriedades animáveis no compositor sem layout/paint; o resto repinta. `will-change` só quando há problema e por pouco tempo. https://web.dev/articles/animations-guide
- **[fato]** Em aparelho com pouca memória, o custo de criar camada pode superar o ganho; cada camada ocupa textura na GPU. https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count
- **[fato]** `@property` é Baseline "Newly available" desde **09/07/2024**; a previsão é virar "Widely available" em 09/01/2027. https://web.dev/blog/at-property-baseline, https://web-platform-dx.github.io/web-features-explorer/features/registered-custom-properties
- **[fato]** `mask-composite` é Baseline 2023. https://developer.mozilla.org/docs/Web/CSS/mask-composite
- **[fato]** `prefers-reduced-motion` é Baseline "Widely available" desde jan/2020; escalonar ou deslocar objetos grandes é gatilho vestibular. https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- **[fato]** WCAG 2.3.1 (nível A): nada pisca mais de 3 vezes em 1 s, ou fica abaixo dos limites de flash geral/vermelho (área de 0,006 sr em 10 graus, ~341x256 px a 1024x768). https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
- **[fato]** WCAG 2.3.3 (AAA) trata movimento iniciado por interação; 2.2.2 trata movimento automático com mais de 5 s ao lado de outro conteúdo, que precisa de controle de pausar/parar. https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions
- **[fato]** O guia de movimento do `modern-web-guidance` (equipe do Chrome) diz: padrão estático e opt-in de movimento; não aplicar `animation-duration: 0.01ms` globalmente; manter o estado final quando desligar a animação. Lido com `npx modern-web-guidance retrieve motion` (versão de skill 2026_11_10).
- **[fato]** Chrome para de chamar `requestAnimationFrame` em aba oculta; o Firefox historicamente só limita. Pause explicitamente com `visibilitychange`. https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API, https://developer.chrome.com/blog/background_tabs
- **[fato]** `feTurbulence` + `feDisplacementMap` é pesado na CPU, pior em celular; só "em rajadas curtas ou área pequena". Relatos em https://greensock.com/forums/topic/33075-gsap-and-feturbulence-mobile-performance/ e https://bugzilla.mozilla.org/show_bug.cgi?id=1845890 (**[opinião]** de fórum, sem benchmark formal). Meu teste confirma o sentido (seção 5).
- **[fato]** CSS Paint API (Houdini) só em Chromium; Safari e Firefox sem suporte por padrão (dados do caniuse conflitantes nas versões novas). https://caniuse.com/css-paint-api. **Decisão: não usar.**
- **[fato, números de terceiros]** Lottie: `lottie-web-light` 195,8 KB min / 51,4 KB gzip; `dotlottie-web` 314,7 KB min / 33,4 KB gzip mais **~500 KB de WASM** baixado depois. Rive não consegui medir. https://mcp.depscope.dev/pkg/npm/lottie-web-light, https://unpkg.com/@lottiefiles/dotlottie-web@0.81.0/README.md. **Decisão: não usar** para um brilho de borda e um orbe; o CSS pesa bytes.
- **[fato, Brasil]** Samsung (42% a 48%) e Motorola (20% a 31%) lideram, com crescimento do segmento de entrada; **[não verificado]** a divisão por RAM (2 GB/3 GB). https://counterpointresearch.com/key-takeaways.../reports/brazil-smartphone-shipments-decline-11-percent-yoy-h1-2026, https://omdia.tech.informa.com/blogs/2025/april/brazil%20smartphone%20market%20in%202025

### 2.4 `ai-motion` (usado pelo page-agent): serve de base?

Li o código instalado em `frontend/node_modules/ai-motion` (v0.4.8) e o uso em `@page-agent/page-controller/dist/lib/SimulatorMask-*.js`.

- **[fato]** Licença MIT, autor Simon (gaomeng1900), repositório https://github.com/gaomeng1900/ai-motion. Pode copiar com o aviso de copyright. 19 KB de JS não minificado, sem dependências.
- **[fato]** WebGL2; desenha só 4 tiras de borda (geometria de borda, não tela cheia); 4 bandas de luz giram com velocidades diferentes; SDF de retângulo arredondado; ruído e pulso senoidal. Cores: **exatamente 4**, em `rgb()`.
- **[fato]** Teto de **~30 fps** (`delta < 1000/32`). Resolução do canvas = tamanho x `devicePixelRatio` por padrão (em celular 3x são 9x os pixels de CSS). **Não pausa com aba oculta, não olha `prefers-reduced-motion`.** Lança erro se não houver WebGL2. Um contexto WebGL por instância.
- **[fato]** O cursor do page-agent anima `left/top` em um loop de `requestAnimationFrame` que **nunca para** enquanto o objeto existe (interpolação 0,2), e o invólucro bloqueia clique, roda e teclado por padrão. É exatamente a variante ingênua do meu demo (C `left/top`).
- **[fato]** O Worki já passa `enableMask: false` (`frontend/src/lib/copilot/guardedController.ts:93`), então nada disso aparece hoje.
- **Veredito [opinião fundamentada nas medições]:** não vale como base. O resultado visual é equivalente ao CSS compositor, que não tem dependência nem contexto WebGL, e o CSS respeita movimento reduzido e aba oculta de graça. Faria sentido só se quiséssemos o brilho que reage a áudio/entrada contínua. Se um dia usar: limitar `ratio` a 1, pausar no `visibilitychange`, desligar em reduced-motion.

### 2.5 Princípios de sofisticação [opinião, com apoio dos achados acima]

- **Paleta curta:** poucos matizes (azul, violeta, verde) e o âmbar como lasca, com interpolação em `oklab` para não "sujar" no meio. Cor viva só na borda; o miolo fica da cor do app.
- **Hierarquia:** o brilho diz "estou ativo"; o texto da pílula diz **o quê**; o cursor diz **onde**. Só um deles em destaque por vez.
- **Easing:** saída suave para entradas (`cubic-bezier(.22,.9,.24,1)`), entrada-e-saída para deslocamentos (`cubic-bezier(.45,0,.15,1)`). Nada linear, exceto rotação contínua e shimmer.
- **Duração:** microinteração 120 a 260 ms; transição de estado 260 a 650 ms; ambiente (respiração) 5 s ou mais. Acima de 1,3 s o usuário já sente espera.
- **Restrição:** cada efeito paga renda em informação. O brilho **muda de estado** (ouvindo, trabalhando, pronto), não decora.
- **Quando NÃO animar:** tarefas de menos de 1 s; durante digitação e rolagem; com movimento reduzido; com economia de dados/bateria; quando o agente está ocioso (parar o efeito, zero custo); em telas de pagamento e confirmação com valor, onde o foco precisa ser o texto.

## 3. Recomendação concreta

### 3.1 PC (1440, mouse/teclado)

| Peça | Especificação |
|---|---|
| Abrir | Barra de comando por `Ctrl+K` e pelo botão "Perguntar ao Worki". Entra em **260 ms** (opacidade, `translateY(8px)`, `scale(.975)`, easing de saída); sai em **180 ms**. Fundo escurece 0,28 em 200 ms. |
| Segurar o orbe (voz) | **Gota**: ponto cai 560 ms; pressão radial 340 ms; **3 ondas** de 1,25 s escalonadas 0/140/300 ms; brilho de borda acende 800 ms com atraso 280 ms. Soltar: brilho vai a "trabalhando" e apaga em 900 ms após 2,4 s se nada acontecer. |
| Trabalhando | Brilho **médio**: borda 2 px + halo 30 px, opacidade máxima 0,78, luz gira uma volta a cada **7 s**, respira em **5,4 s** (opacidade 0,72 a 1). Pílula no topo-centro com orbe (volta a 3,6 s), passo atual com shimmer de 2,4 s, contador e **Parar**. Troca de passo: 260 ms, `translateY(6px)`. |
| Cursor virtual | Seta de 22 px + etiqueta "Copiloto" azul. Desliza em **420 a 950 ms** (`300 + distância`), em arco (X e Y com easing diferentes). Clique: seta `scale(.84)` 260 ms + ripple 640 ms. |
| Concluído | Brilho some em 900 ms; orbe fica **verde e parado**; texto fixo. Nenhum flash. |
| Intensidades | Baixa: 18 px, α 0,55, volta 10 s. Média: 30 px, α 0,78, 7 s. Alta (só enquanto segura): 40 px, α 0,84, 5,5 s. |

### 3.2 Celular (390 de largura, polegar)

| Peça | Especificação |
|---|---|
| Abrir | Folha inferior (mesma animação, `translateY(24px)` ao entrar) com alvos de 40 px ou mais. |
| Gota | **2 ondas** (0 e 140 ms), 1,1 s; sem `feDisplacementMap`, sem `blur`. Segurar: haptic leve (`navigator.vibrate(8)`), se existir. Brilho em nível baixo/médio. |
| Trabalhando | Brilho **baixo/médio**, halo 24 px, volta 10 s. Pílula **acima da navegação inferior** (alcance do polegar), 12 px de margem e `env(safe-area-inset-bottom)`. |
| Toque virtual | Disco 46 px escuro translúcido com **aro branco** (contraste sobre botão azul e sobre branco); aperta para `scale(.76)` em 420 ms; ripple branco com aro escuro. Sem rastro e sem sombra grande. |
| Degradação | Nível "lite": brilho **estático** (sem rotação, só respiração de opacidade) quando `deviceMemory <= 2`, `saveData`, ou quando a amostra de 40 quadros mostrar p75 acima de 24 ms. |

### 3.3 Orçamento de desempenho proposto [opinião derivada das medições]

- **Ocioso: zero custo.** Sem agente trabalhando, nenhuma camada animada, nenhum `requestAnimationFrame`.
- **Brilho contínuo:** zero JavaScript por quadro (só CSS). Meta: **no máximo 12% da thread principal a 4x** (medido: 10 a 12%) e menos de 1% de quadros acima de 25 ms.
- **Rajada da gota (até 1,5 s):** no máximo 30% a 4x (medido 26% a 4x no celular; 41% a 6x no PC, o que fica no limite).
- **Camadas:** no máximo 6 animando ao mesmo tempo; uma única camada de tela cheia mascarada (o brilho); nada de `backdrop-filter` no celular.
- **Resolução:** qualquer canvas/WebGL a 0,5x e 30 fps (nunca `devicePixelRatio` cheio).
- **Teste real obrigatório antes de liberar:** Android de entrada (2 a 3 GB) pelo `chrome://inspect`, com 5 minutos de brilho contínuo e leitura de bateria (`adb shell dumpsys batterystats`). **Não medi bateria.**

## 4. O demo, o que cada variante mostrou (e julguei olhando os quadros)

- **A gota:** a combinação queda + pressão + ondas suaves + brilho atrasado lê como "o toque acordou o agente". O brilho em "alto" estava carregado (verde e violeta saturados); baixei para 0,84 e 40 px e ficou elegante. As ondas em azul para violeta, translúcidas, funcionam melhor que um anel de linha fina.
- **B brilho:** as quatro técnicas (CSS ingênuo, CSS compositor, canvas, WebGL) saem **visualmente parecidas**, então a escolha é só custo. O canvas mostrava degraus (faixa interna mais clara) com 5 camadas; com 10 camadas de alfa 0,045 ficou liso.
- **C/D:** o toque virtual sumia sobre o botão azul (disco azul sobre azul). Troquei por disco escuro com aro branco; ficou legível nos dois fundos. O ripple de clique ficou mais claro com aro branco duplo.
- **E:** a janela deslizante (duas `transform` opostas) mantém o texto nítido, sem trepidar, e custa metade do `background-clip: text` a 6x.
- **F:** a folha inferior com escurecimento funciona. O crossfade padrão da View Transition apaga a página inteira; foi preciso zerar `::view-transition-old/new(root)` (defeito que eu mesmo vi no quadro).

## 5. Medições

Ambiente **[fato]**: Windows 11, Chrome 158.0.8127.37, GPU Intel Arc 140V, tela de 75 Hz, 26/11/2026. Mesmo cenário em tela cheia (PC 1440x900; celular 390x844 a 2x), 3,5 s por cenário, 15 cenários. CPU estrangulada por `Emulation.setCPUThrottlingRate` 4x e 6x. "cpu" = tempo de tarefa da thread principal por tempo de relógio. "jank" = quadros acima de 25 ms.

**Limites honestos:** o estrangulamento age na thread principal, não na GPU, e esta máquina tem GPU real; por isso o fps fica em 75 quase sempre e o discriminante é o `cpu`. Para aproximar o pior caso de compositor fiz um segundo passe com `--disable-gpu` (SwiftShader, rasterização por software, 60 Hz). **Nenhum dos dois substitui um Android de entrada real.**

### 5.1 Com GPU, thread principal (cpu %)

| Cenário | Cel 1x | Cel 4x | Cel 6x | PC 6x | Observação |
|---|---|---|---|---|---|
| Base (sem efeito) | 2 | 4 | 5 | 8 | |
| A gota CSS | 8 | 26 | 42 | 41 | rajada |
| A gota SVG + feDisplacementMap | 9 | 33 | 43 | **68** | PC 6x: 68,7 fps, jank 9,1% |
| A gota canvas | 4 | 13 | 18 | 32 | |
| B brilho CSS ingênuo | 7 | 28 | 54 | **63** | |
| **B brilho CSS compositor** | **2** | **12** | 12 | **22** | recomendado |
| B brilho canvas 0,5x | 2 | 9 | 13 | 18 | |
| B brilho WebGL 0,5x | 2 | 7 | 12 | 18 | |
| C cursor `transform` | 3 | 9 | 16 | 24 | |
| C cursor `left/top` | 3 | 17 | 17 | 37 | |
| D toque | 2 | 10 | 12 | 27 | |
| E shimmer `background-clip` | 6 | 26 | 28 | **61** | |
| **E shimmer janela** | 4 | 16 | 32 | 25 | |
| F barra CSS | 5 | 15 | 32 | 29 | |
| F View Transition | 9 | 31 | 40 | 48 | Cel 6x: 66 fps, jank 6,1% |

### 5.2 Sem GPU (fps / jank %)

| Cenário | PC 1x | PC 4x | Cel 1x | Cel 4x |
|---|---|---|---|---|
| Base | 60 / 0 | 60 / 0 | 60 / 0 | 60 / 0 |
| A gota CSS | 48 / 18,7 | 53 / 14 | 60 / 0 | 60 / 0 |
| A gota SVG | 48 / 19,6 | **40 / 29** | 58 / 3 | 59 / 1,9 |
| A gota canvas | 60 / 0 | 48 / 18,5 (cpu 70%) | 60 / 0 | 58 / 2,9 (cpu 46%) |
| **B brilho CSS ingênuo** | 39 / 45 | **20 / 96** | 58 / 3,5 | 58 / 2,5 |
| **B brilho CSS compositor** | 58 / 2,9 | 59 / 2,4 | 60 / 0 | 60 / 0 |
| B brilho canvas | 60 / 0 | 60 / 0 (cpu 50%) | 60 / 0 | 60 / 0 (cpu 36%) |
| B brilho WebGL | 60 / 0 | 60 / 0 (cpu 25%) | 60 / 0 | 60 / 0 (cpu 13%) |
| C/D/E/F barra CSS | 60 / 0 | 59 a 60 / 0 a 0,5 | 60 / 0 | 60 / 0 |
| F View Transition | 60 / 0 | 59 / 1 | 60 / 0 | 59 / 1 |

### 5.3 O que os números dizem

- **Brilho:** o padrão popular de "borda de gradiente animada" (`@property` + `blur`) é o pior; sem GPU a 4x caiu para **20 fps**. O compositor (rotate dentro de máscara estática) ficou em **58 a 60 fps** e **10 a 12% de CPU**. Canvas e WebGL seguram os 60 mas gastam CPU de JS (canvas 36 a 50%).
- **Gota:** o custo está nas ondas grandes (preenchimento) e na transição das propriedades registradas do brilho (**hipótese, não medida**: `--g`/`--ga` animadas repintam a máscara). Sem GPU a rajada cai para ~48 fps no PC. Mitigações no desenho: 2 ondas no celular, ondas limitadas a ~1,2x a diagonal da tela, e trocar a intensidade por **opacidade**, não por largura de máscara.
- **SVG `feDisplacementMap` na página:** o pior de todos na rajada (68% de CPU a 6x, 29% de jank sem GPU). Descartado para produção.
- **Cursor:** `left/top` custa quase o dobro de `transform` (17% contra 9% a 4x) e o page-agent ainda mantém um loop de rAF eterno. Usar `transform` e Web Animations.
- **Shimmer:** `background-clip: text` consome 61% a 6x no PC; a janela deslizante, 25%.
- **View Transition:** a pior da barra (48% a 6x, jank a 6x); como fica só 340 ms por abertura é tolerável, mas CSS puro basta e é mais barato. Se usar, zerar o crossfade do `root`.

## 6. Receitas prontas para copiar para o React

> Todas já rodaram no demo. Para o Worki, o overlay é `position: fixed`, então o tamanho do sweep usa `vw/vh` (no demo usa `cqw/cqh` porque a tela é simulada).

### 6.1 CSS do brilho (compositor), `copilot-vfx.css`

```css
:root {
  --wk-spectrum: #2563EB 0%, #7C3AED 26%, #00A651 54%, #2563EB 76%, #F59E0B 87%, #2563EB 97%, #2563EB 100%;
  --wk-ease-out: cubic-bezier(.22, .9, .24, 1);
  --wk-ease-io: cubic-bezier(.45, 0, .15, 1);
}
.wk-glow {
  position: fixed; inset: 0; z-index: 60; pointer-events: none; contain: strict;
  opacity: 0; transition: opacity .8s var(--wk-ease-io);
  --g: 28px; --lw: 2px; --alpha: .78;        /* largura fixa; a intensidade só muda a opacidade */
}
.wk-glow[data-on="true"] { opacity: 1; }
.wk-glow[data-level="low"]  { --alpha: .55; }
.wk-glow[data-level="high"] { --alpha: .84; }
.wk-glow__halo {
  position: absolute; inset: 0; overflow: hidden; opacity: var(--alpha);
  --ramp: #000 0, rgba(0,0,0,.88) var(--lw), rgba(0,0,0,.30) calc(var(--g) * .30), rgba(0,0,0,.08) calc(var(--g) * .62), transparent var(--g);
  -webkit-mask-image: linear-gradient(to bottom, var(--ramp)), linear-gradient(to top, var(--ramp)),
                      linear-gradient(to right, var(--ramp)), linear-gradient(to left, var(--ramp));
          mask-image: linear-gradient(to bottom, var(--ramp)), linear-gradient(to top, var(--ramp)),
                      linear-gradient(to right, var(--ramp)), linear-gradient(to left, var(--ramp));
  -webkit-mask-composite: source-over; mask-composite: add;
}
.wk-glow__sweep {
  position: absolute; left: 50%; top: 50%;
  width: calc(100vw + 100vh); aspect-ratio: 1; margin: calc((100vw + 100vh) / -2) 0 0 calc((100vw + 100vh) / -2);
  background: conic-gradient(from 0deg, var(--wk-spectrum));                 /* fallback sRGB */
  background: conic-gradient(in oklab from 0deg, var(--wk-spectrum));        /* sem "sujar" no meio */
  transform: rotate(24deg);
}
/* Movimento: só quando o usuário NÃO pediu para reduzir (padrão estático) e o agente está ativo */
@media (prefers-reduced-motion: no-preference) {
  .wk-glow[data-on="true"] .wk-glow__sweep { will-change: transform; animation: wk-sweep 7s linear infinite; }
  .wk-glow[data-on="true"][data-level="low"]  .wk-glow__sweep { animation-duration: 10s; }
  .wk-glow[data-on="true"][data-level="high"] .wk-glow__sweep { animation-duration: 5.5s; }
  .wk-glow[data-on="true"] .wk-glow__halo { animation: wk-breathe 5.4s ease-in-out infinite; }
}
@keyframes wk-sweep   { to { transform: rotate(384deg); } }
@keyframes wk-breathe { 0%, 100% { opacity: calc(var(--alpha) * .72); } 50% { opacity: var(--alpha); } }
/* Nível lite (aparelho fraco): estático, sem rotação */
html[data-copilot-fx="lite"] .wk-glow__sweep, html[data-copilot-fx="lite"] .wk-glow__halo { animation: none !important; will-change: auto; }
/* Contraste alto / cores forçadas: o brilho é decorativo; o estado vai por borda sólida e pelo texto */
@media (prefers-contrast: more), (forced-colors: active) {
  .wk-glow__halo { display: none; }
  .wk-glow { box-shadow: inset 0 0 0 3px Highlight; }
}
/* Aba oculta: pausar tudo */
html.is-hidden .wk-glow * { animation-play-state: paused !important; }
```

```tsx
// AgentGlow.tsx
export function AgentGlow({ on, level = 'med' }: { on: boolean; level?: 'low' | 'med' | 'high' }) {
  return (
    <div className="wk-glow" data-on={on} data-level={level} aria-hidden="true">
      <i className="wk-glow__halo"><i className="wk-glow__sweep" /></i>
    </div>
  )
}
```

### 6.2 Hooks de movimento, visibilidade e nível de desempenho (TS)

```ts
import { useEffect, useState, useSyncExternalStore } from 'react'

const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null
export const useReducedMotion = () =>
  useSyncExternalStore(cb => { mq?.addEventListener('change', cb); return () => mq?.removeEventListener('change', cb) }, () => !!mq?.matches, () => false)

export function usePageVisibility() {            // pausa rAF/JS quando a aba some
  const [visible, setVisible] = useState(!document.hidden)
  useEffect(() => {
    const on = () => { setVisible(!document.hidden); document.documentElement.classList.toggle('is-hidden', document.hidden) }
    document.addEventListener('visibilitychange', on); return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return visible
}

/** 'full' | 'lite'. Chame ao ligar o brilho; se o aparelho engasgar, cai para estático. */
export function pickFxTier(): 'full' | 'lite' {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  if (nav.connection?.saveData || (nav.deviceMemory ?? 4) <= 2 || (nav.hardwareConcurrency ?? 4) <= 2) return 'lite'
  return 'full'
}
export function watchFrames(onSlow: () => void, frames = 40, limitMs = 24) {   // p75 acima do limite => lite
  const d: number[] = []; let last = performance.now(), n = 0, raf = 0
  const tick = (t: number) => {
    d.push(t - last); last = t
    if (++n < frames) raf = requestAnimationFrame(tick)
    else if (d.sort((a, b) => a - b)[Math.floor(d.length * 0.75)] > limitMs) onSlow()
  }
  raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf)
}
// uso: document.documentElement.dataset.copilotFx = pickFxTier(); watchFrames(() => { document.documentElement.dataset.copilotFx = 'lite' })
```

### 6.3 Gota: ondas + pressão + queda (Web Animations, compositor)

```ts
const OUT = 'cubic-bezier(.22,.9,.24,1)'
export function pressDrop(layer: HTMLElement, x: number, y: number, opts: { rings?: 2 | 3 } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {}        // versão estática: só o brilho
  const w = layer.clientWidth, h = layer.clientHeight
  const R = Math.min(Math.hypot(Math.max(x, w - x), Math.max(y, h - y)), Math.hypot(w, h) * 0.6) // limita o preenchimento
  const delays = (opts.rings ?? 3) === 2 ? [0, 140] : [0, 140, 300]
  delays.forEach(delay => {
    const r = Object.assign(document.createElement('div'), { className: 'wk-ring' })
    Object.assign(r.style, { left: x - R + 'px', top: y - R + 'px', width: 2 * R + 'px', height: 2 * R + 'px' })
    layer.append(r)
    r.animate([{ transform: 'scale(.03)', opacity: 0 }, { opacity: .95, offset: .12 }, { opacity: .55, offset: .5 }, { transform: 'scale(1)', opacity: 0 }],
      { duration: 1250, delay, easing: 'cubic-bezier(.16,.8,.24,1)', fill: 'both' }).onfinish = () => r.remove()
  })
  const press = Object.assign(document.createElement('div'), { className: 'wk-press' })   // pressão sob o dedo
  Object.assign(press.style, { left: x + 'px', top: y + 'px' }); layer.append(press)
  press.animate([{ transform: 'scale(.25)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 340, easing: OUT, fill: 'both' })
  return () => press.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, fill: 'forwards' }).onfinish = () => press.remove()   // release()
}
```

```css
.wk-ring  { position: absolute; border-radius: 50%; will-change: transform, opacity;
  background: radial-gradient(closest-side, transparent 80%, rgba(37,99,235,0) 83%, rgba(37,99,235,.20) 92%, rgba(124,58,237,.24) 97%, transparent 100%); }
.wk-press { position: absolute; width: 240px; height: 240px; margin: -120px 0 0 -120px; border-radius: 50%; will-change: transform, opacity;
  background: radial-gradient(closest-side, rgba(37,99,235,.17), rgba(124,58,237,.06) 58%, transparent); }
```

Uso: `pointerdown` chama `pressDrop(layer, e.clientX, e.clientY)` e liga `<AgentGlow on level="high" />` com `transition-delay: .28s`; `pointerup`/`pointercancel` chama o `release` devolvido e baixa o nível para `med`.

### 6.4 Cursor virtual (PC) e toque virtual (celular), só `transform`

```ts
// Dois elementos aninhados: X no externo, Y no interno, com easings diferentes => trajetória em arco
export async function glideTo(outer: HTMLElement, inner: HTMLElement, from: {x:number;y:number}, to: {x:number;y:number}) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y), ms = Math.min(950, Math.max(420, 300 + dist))
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce) { outer.style.transform = `translateX(${to.x}px)`; inner.style.transform = `translateY(${to.y}px)`; return }
  const a = outer.animate([{ transform: `translateX(${from.x}px)` }, { transform: `translateX(${to.x}px)` }], { duration: ms, easing: 'cubic-bezier(.3,.1,.1,1)', fill: 'forwards' })
  const b = inner.animate([{ transform: `translateY(${from.y}px)` }, { transform: `translateY(${to.y}px)` }], { duration: ms, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' })
  await Promise.all([a.finished, b.finished])
  ;[a, b].forEach(x => { x.commitStyles(); x.cancel() })            // fixa a posição e libera a animação
}
export const clickRipple = (host: HTMLElement, x: number, y: number) => {
  const r = Object.assign(document.createElement('i'), { className: 'wk-ripple' }); Object.assign(r.style, { left: x - 28 + 'px', top: y - 28 + 'px' }); host.append(r)
  r.animate([{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(.95)', opacity: .7, offset: .4 }, { transform: 'scale(1.45)', opacity: 0 }],
    { duration: 640, easing: 'cubic-bezier(.25,.6,.3,1)', fill: 'both' }).onfinish = () => r.remove()
}
```

```css
.wk-cursor { position: fixed; left: 0; top: 0; z-index: 70; pointer-events: none; will-change: transform; }
.wk-cursor svg { width: 22px; height: 24px; filter: drop-shadow(0 2px 3px rgba(15,23,32,.28)); }
.wk-cursor b { position: absolute; left: 14px; top: 20px; background: #2563EB; color: #fff; font: 700 10.5px/1 system-ui; padding: 3px 8px; border-radius: 7px; }
.wk-touch { width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; background: rgba(15,23,32,.20);
  border: 2px solid rgba(255,255,255,.95); box-shadow: 0 0 0 1.5px rgba(15,23,32,.30), 0 8px 18px rgba(15,23,32,.22); }  /* legível sobre azul e sobre branco */
.wk-ripple { position: fixed; width: 56px; height: 56px; border-radius: 50%; border: 2px solid rgba(255,255,255,.95); pointer-events: none;
  box-shadow: 0 0 0 1.5px rgba(15,23,32,.32); background: rgba(37,99,235,.14); will-change: transform, opacity; }
```

### 6.5 Shimmer do passo (janela deslizante, compositor)

```tsx
// medir a largura do texto uma vez por passo e passar em --w
<span className="wk-shim" style={{ ['--w' as string]: `${w}px` }}>
  <span>{texto}</span>
  <span className="wk-shim__win" aria-hidden="true"><span className="wk-shim__txt">{texto}</span></span>
</span>
```

```css
.wk-shim { position: relative; display: inline-block; white-space: nowrap; color: #6B7280; }
.wk-shim__win { position: absolute; inset: 0 auto 0 0; width: calc(var(--w) * .5); overflow: hidden; opacity: 0; pointer-events: none;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 38%, #000 62%, transparent); mask-image: linear-gradient(90deg, transparent, #000 38%, #000 62%, transparent); }
.wk-shim__txt { position: absolute; left: 0; top: 0; width: var(--w); color: #0F1720; }
@media (prefers-reduced-motion: no-preference) {
  .wk-shim__win { opacity: 1; will-change: transform; animation: wk-win 2.4s linear infinite; }
  .wk-shim__txt { will-change: transform; animation: wk-txt 2.4s linear infinite; }
}
@keyframes wk-win { from { transform: translateX(calc(var(--w) * -.5)); } to { transform: translateX(var(--w)); } }
@keyframes wk-txt { from { transform: translateX(calc(var(--w) * .5)); } to { transform: translateX(calc(var(--w) * -1)); } }
```

Texto do passo dentro de `role="status"` / `aria-live="polite"` (o shimmer é decorativo; a janela é `aria-hidden`). Parar o shimmer quando o passo for o último.

### 6.6 Barra de comando

```css
.wk-cmd { transform: translate(-50%, 8px) scale(.975); opacity: 0; visibility: hidden;
  transition: opacity .2s var(--wk-ease-out), transform .26s var(--wk-ease-out), visibility 0s .26s; }
.wk-cmd[data-open="true"] { transform: translate(-50%, 0) scale(1); opacity: 1; visibility: visible; transition-delay: 0s; }
@media (max-width: 640px) { .wk-cmd { top: auto; bottom: 0; width: 100%; border-radius: 18px 18px 0 0; transform: translate(-50%, 24px); } }
@media (prefers-reduced-motion: reduce) { .wk-cmd, .wk-cmd[data-open="true"] { transform: translate(-50%, 0); transition: opacity .15s linear, visibility 0s; } }
```

Em produção prefira `<dialog>` + `showModal()` + `@starting-style` (guia `animate-to-from-top-layer` do modern-web-guidance) para foco preso, Esc e camada superior de graça. Se usar View Transition: `::view-transition-old(root), ::view-transition-new(root) { animation: none; }`.

## 7. Riscos e acessibilidade

- **Fotossensibilidade (WCAG 2.3.1):** nada aqui alterna claro/escuro. Respiração em 5,4 s e opacidade 0,72 a 1; sem flash. Não adicionar "pulso de sucesso" rápido ao concluir.
- **Pausar/parar (WCAG 2.2.2):** o brilho passa de 5 s ao lado de outro conteúdo. O botão **Parar** da pílula (ou do painel) para o agente e o efeito; mantenha-o no teclado e no leitor de tela. Acrescentar preferência persistente "Efeitos do Copiloto: reduzidos".
- **Movimento reduzido:** brilho vira borda em gradiente **fixa** (opacidade 200 ms), sem rotação, sem ondas, sem cursor deslizando (o cursor "teletransporta" com fade de 160 ms), sem shimmer, orbe parado. Isso mantém o estado final visível, como pede o guia.
- **Contraste alto / cores forçadas:** o brilho some e entra borda sólida `Highlight`. **O estado nunca vai só por cor:** sempre há texto no `aria-live` ("Trabalhando: lendo a escala").
- **Cor e daltonismo:** a luz que gira passa por verde e âmbar; como é decorativa e o estado está em texto, ok. Evitar usar verde/vermelho para "sucesso/erro" só no brilho.
- **Bateria e térmico [opinião, sem medição]:** brilho contínuo é o pior caso. Mitigar: ligar só enquanto o agente trabalha, `lite` em aparelho fraco, `visibilitychange`, apagar após ociosidade. Medir bateria em aparelho real.
- **Camadas e memória:** `will-change` só enquanto ligado; no desligar, remover (o guia do web.dev alerta para memória).
- **Suporte:** `conic-gradient(in oklab ...)` precisa de Chrome 111+; há declaração de fallback sRGB. `cqw` (só no demo) é Chrome 105+; em produção use `vw/vh`. `@property` só é necessário nos tokens de transição do demo; **as receitas de produção não dependem dele**. `mask-composite` tem prefixo `-webkit-` incluído.
- **Mantém a interatividade:** o overlay é `pointer-events: none`. Se o agente precisar travar a página, faça isso à parte (o page-agent travava clique, roda e teclado por padrão).
- **Sobreposição de conteúdo:** o halo vai até 28 px por cima de elementos nas bordas (botões laterais, barra inferior). Com α 0,78 e máscara não degrada contraste de texto, mas confira ícones de 1 px nas bordas.
- **iOS Safari e Firefox:** não testei. Use o botão "Simular movimento reduzido" e abra o demo nos dois antes de liberar; o prefixo `-webkit-mask-composite` já está nas receitas e a interpolação `in oklab` tem fallback sRGB.

## 8. Lacunas que ficam

1. Efeito exato do Windows: sem fonte.
2. Atlas, Comet, Samsung Now Bar e Dynamic Island: sem fonte útil.
3. Rive: peso não medido.
4. Bateria e GPU de Android de entrada real: não medidos. O passe sem GPU é uma aproximação.
5. Safari/iOS e Firefox: o demo não foi aberto neles.
6. Percepção de beleza foi julgada por mim olhando quadros; vale uma rodada com o dono no celular dele.

## 9. Fontes (acessadas em 25 e 26/11/2026)

- Microsoft, gerenciar Copilot no Windows: https://learn.microsoft.com/en-us/windows/client-management/manage-windows-copilot
- Windows Insider, press to talk (10/03/2025): https://blogs.windows.com/windows-insider/2025/03/10/copilot-on-windows-press-to-talk-begins-rolling-out-to-windows-insiders/
- Windows Insider, Vision com texto (28/10/2025): https://blogs.windows.com/windows-insider/2025/10/28/copilot-on-windows-vision-with-text-input-begins-rolling-out-to-windows-insiders/
- 9to5Mac, novo Siri (03/11/2024): https://9to5mac.com/2024/11/03/new-apple-intelligence-siri-looks-different-works-the-same/
- SlashGear, brilho do iPhone: https://www.slashgear.com/1865686/iphone-glowing-around-edges-reason/
- Yahoo/Tech, redesign do Siri (2026): https://tech.yahoo.com/ai/articles/apple-siri-redesign-finally-addresses-180115709.html
- 9to5Google, Gemini overlay (23/08/2024): https://9to5google.com/2024/08/23/gemini-glow-floating-overlay/
- Android Authority, Gemini: https://www.androidauthority.com/gemini-overlay-sparkling-animation-rollout-3729835/ e https://www.androidauthority.com/google-gemini-ui-update-animation-you-tab-apk-teardown-3732589/
- Issue do Claude in Chrome, CPU do brilho (22/01/2026): https://github.com/anthropics/claude-code/issues/20070
- Arkose Labs, indicadores de agentes: https://www.arkoselabs.com/blog/every-agent-hides-somewhere-none-hide-everywhere
- Modo Edge do Claude in Chrome (borda amarela): https://github.com/afterglow-labs/claude-edge-window-mode
- page-agent: https://github.com/alibaba/page-agent; efeito extraído: https://github.com/wxmvv/page-glow-effect; `ai-motion`: https://github.com/gaomeng1900/ai-motion (código lido em `frontend/node_modules`)
- web.dev, animações: https://web.dev/articles/animations-guide; camadas: https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count
- web.dev, `@property` Baseline: https://web.dev/blog/at-property-baseline
- MDN: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion, https://developer.mozilla.org/docs/Web/CSS/mask-composite, https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- W3C WCAG: https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html, https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions
- Chrome, abas em segundo plano: https://developer.chrome.com/blog/background_tabs
- caniuse CSS Paint API: https://caniuse.com/css-paint-api
- feTurbulence em celular: https://greensock.com/forums/topic/33075-gsap-and-feturbulence-mobile-performance/, https://bugzilla.mozilla.org/show_bug.cgi?id=1845890
- Pesos Lottie/dotLottie: https://mcp.depscope.dev/pkg/npm/lottie-web-light, https://unpkg.com/@lottiefiles/dotlottie-web@0.81.0/README.md
- Mercado brasileiro: https://counterpointresearch.com/key-takeaways.../reports/brazil-smartphone-shipments-decline-11-percent-yoy-h1-2026, https://omdia.tech.informa.com/blogs/2025/april/brazil%20smartphone%20market%20in%202025
- `modern-web-guidance` (equipe do Chrome), guia `motion`: `npx -y modern-web-guidance@latest retrieve motion`
