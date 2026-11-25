# ADR: copiloto agêntico com page-agent como motor

- Data: 25/11/2026
- Estado: implementado atrás de flag desligada. Não aplicado no banco, não publicado, não commitado.
- Falta antes de ligar em produção: gate do `harness-security-reviewer`, decisão LGPD, emenda ao Article 16 e teste em navegador real.

## Decisão
O dono pediu explicitamente um copiloto que ensina mostrando na tela e que também faz (navega, preenche, clica, explica), com
https://github.com/alibaba/page-agent como motor. A pesquisa (`pesquisa-page-agent.md`) recomendou **não** adotar e
`pesquisa-estado-da-arte.md` recomendou só ferramentas tipadas, sem clique por DOM. **A decisão do dono prevalece.** Este
registro diz o que foi adotado, com quais travas, e o que continua em aberto. As ressalvas das pesquisas não foram refutadas.

## O que é usado e o que não é
Dependências com versão exata, instaladas com `--ignore-scripts`: `@page-agent/core`, `@page-agent/llms`,
`@page-agent/page-controller` (todas 1.12.4, MIT, repositório alibaba/page-agent, um único mantenedor no npm: gaomeng1900) e
`zod` 4.3.5 (peer).

| Do page-agent | Uso |
|---|---|
| Laço `PageAgentCore` (reflexão, passos, abortar) e protocolo `AgentOutput` | usado |
| Cliente LLM (`llms`) com `customFetch` | usado; a URL pedida é ignorada |
| `clickElement`, `inputTextElement`, `scrollVertically` | usadas, só depois das travas |
| Leitura do DOM (`dom_tree`, `flatTreeToString`) | **não roda** |
| `selectOptionElement` | substituída (setter nativo) |
| `execute_javascript`, `scroll_horizontally` | removidas; o método também devolve falha |
| Pacote `page-agent`, `@page-agent/ui`, máscara, CDN, extensão, MCP, `/llms.txt` | não instalados ou desligados |

Por que a leitura foi substituída: o serializador envia o atributo `value` (o React espelha nele inclusive senha), corta
atributos em 20 caracteres **antes** de qualquer hook (e-mail ou PIX cortado escapa de regex), envia todo o texto, o título e a
URL completa, e marca como clicável qualquer filho com `cursor: pointer`.

Achados no `dist` durante a implementação:
- `LLM.invoke` repete a chamada **e a execução da ferramenta** (`maxRetries` 2 por padrão): um clique poderia rodar duas vezes. Fixado em 0.
- `selectOptionElement` atribui `value` direto, o que o React controlado tende a ignorar.

## Travas (cada uma com teste)
1. **Leitura por lista de permissão** (`observe.ts`): só controles, rótulos, títulos de seção e avisos. Nunca texto corrido.
   Valor de texto livre vira "preenchido", salvo o que o próprio copiloto digitou. Campo sensível não informa nem se está
   preenchido. `data-copilot-private`, oculto e a UI do copiloto são removidos. Com modal aberto, só ele é lido.
2. **Filtro de vocabulário**: texto da página só sai com palavras conhecidas da interface ou escritas pela pessoa no pedido.
3. **Redação em três pontos**: pedido e resposta a `ask_user` na origem; corpo final no `customFetch` (reconstruído só com
   campos conhecidos); e de novo no proxy. Nos dois últimos, sobrar padrão aborta.
4. **Classificação pelo código** (`risk.ts`): `safe`, `confirm` (inclui o desconhecido), `forbidden` (D) e `blocked`. Considera
   atributo `data-copilot-risk`, catálogo próprio de âncoras, nome acessível e texto visível, ancestrais, label, formulário,
   título do diálogo, filhos marcados e rota. Confirmação **não** libera D.
5. **Guarda em captura** (`guard.ts`): durante a tarefa, todo evento sintético de ativação é barrado, salvo dentro do elemento
   liberado, e o alvo real do evento é reclassificado. Barra `pushState`/`replaceState` para `/convite*`, `window.open` e envio
   de formulário sem confirmação.
6. **Cartão montado pelo código** com tela, alvo real e dados do formulário (só na tela da pessoa). Habilita após 600 ms, vale
   uma vez, expira em 2 min e é invalidado se alvo ou formulário mudarem.
7. **Rotas por lista de permissão**; `navigate` recebe um id, nunca URL; rota desconhecida é bloqueada.
8. **Limites**: 20 passos, 25 ações, uma ação por passo, sem repetição automática. PARAR dentro do modal aberto.
9. **Texto do modelo** é exibido como texto puro, sem URL. Os rótulos de passo são gerados pelo código.
10. **Proxy `copilot-llm`**: usuário real (a chave anon é recusada), CORS fechado, prompt de sistema e esquema da ferramenta do
    **servidor**, formato exato do corpo, listas fechadas de provedor, host e modelo (o endpoint de demonstração não é
    configurável), saída reconstruída campo a campo, limite por usuário, orçamento por usuário e global com reserva atômica,
    sem log de conteúdo, falha fechada (sem secret 503; sem cota 503).

A segurança não depende do modelo: os testes de injeção usam um modelo simulado que **obedece** à injeção.

## Riscos residuais (honestos)
Ações e efeitos
- **A guarda vê eventos de DOM, não chamadas de rede.** Se um elemento classificado como `safe` (link permitido, aba, botão com
  `aria-haspopup`/`aria-expanded`, "Fechar"/"Voltar") grava no próprio handler, a gravação acontece sem cartão.
- **Gravação automática ao digitar, sair do campo ou escolher em lista dentro de `<form>`** não pede confirmação.
- Botão destrutivo com **nome inocente e sem marcação** cai em `confirm`: a barreira vira a leitura do cartão pela pessoa.
- A categoria D depende de texto em pt-BR e de marcação. Tela nova com ação sensível precisa de `data-copilot-risk="D"`.
- `location.assign`/`location.href` disparado por código da página não é interceptável (só o que passa por clique em link ou pelo History).
- Ouvinte de captura em `window` registrado antes do nosso roda antes dele.
- A regra de D é ampla de propósito: "Cancelar" ou "Confirmar" inofensivos também são entregues à pessoa.

Privacidade
- Regex não reconhece nome, endereço nem número por extenso. O filtro de vocabulário cobre o texto da **página**, não o que a
  pessoa escreve: nome ou endereço digitado no pedido **é enviado**. Nome que também é palavra da lista passa.
- Datas completas anteriores a 14 anos atrás são tratadas como nascimento; uma data de nascimento recente ou sem ano, fora do
  contexto "nasc...", passa. Número com menos de 8 dígitos sem contexto passa.
- Valores, horários, funções, nomes de tela e de botões vão ao provedor.
- **LGPD não resolvida**: novo operador e transferência internacional. Falta base legal, contrato com cláusulas da ANPD (ver
  `pesquisa-estado-da-arte.md` §4), retenção do provedor e atualização da Política de Privacidade. O aviso no primeiro uso
  informa, mas não resolve isso. `store: false` na OpenAI não é retenção zero.

Injeção
- O filtro reduz, mas texto atacante feito só de palavras comuns passa em rótulos e títulos. O modelo pode então desviar o
  objetivo dentro do permitido: navegar, preencher campo comum (inclusive redigir uma mensagem) e **pedir** confirmação enganosa.
  Enviar ainda exige o cartão; D continua impossível.

Dependência e produto
- Um mantenedor; API de hooks marcada como experimental. Atualizar exige reler o `dist` (usamos `override` sobre métodos de
  `PageController` e três primitivas exportadas). Um método novo que leia ou aja na página não seria coberto automaticamente.
- Importar `page-controller` registra ouvintes globais (e um `setInterval` onde não há Navigation API) e o construtor marca
  `#root` com um atributo. Só acontece quando a primeira tarefa começa.
- O page-agent imprime no console as entradas das ferramentas (já redigidas); o Sentry pode capturar como breadcrumb.
- Telas legadas sem `data-*`, ou com `div` clicável sem `role`, ficam invisíveis ao copiloto.
- Qualidade, latência e custo com modelo real em pt-BR **não foram medidos**. Nenhuma chave foi usada.

## Article 16 e ADR de IA em runtime
O Article 16 trata de IA no desenvolvimento e diz que o produto não depende de IA para funcionar. Isso é mantido: flag
desligada por padrão, motor carregado só sob pedido, 503 sem secret e o app completo com o modo guia. Mas há **IA em runtime
e um novo provedor**, o que o texto atual não autoriza. A emenda (com data e justificativa) é decisão do dono e não foi feita.
