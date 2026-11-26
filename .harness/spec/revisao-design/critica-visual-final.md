# Crítica visual final (commit 7a1b86ec)

Revisor independente, somente leitura. Nenhum código foi editado e nada foi commitado.

**Como as telas foram vistas.** Usei `scripts/galeria-telas` com `GALERIA_SEM_GUIA=1` em 390, 320, 1440 e 1024. Foram 82 cenários, 346 fotos, 82 de 82 estados confirmados, 0 lacunas e **0 requisições externas**. Saída em `C:\Users\user\AppData\Local\Temp\claude\025b17446c25563b\b93dd2bc-cfe7-4dcf-bef8-f1d6f9728c8b\scratchpad\g\`.

**Como o copiloto foi visto.** A galeria não tem cenário de copiloto. Fiz uma cópia da galeria no scratchpad (`...\scratchpad\gc\`), com `VITE_COPILOT_ENABLED=true`, porta 5195 e 5 cenários próprios, e abri o copiloto com Ctrl+K. As fotos ficaram em `...\scratchpad\gco\`. O mock não tem fixture para a função `copilot-llm`, então **só fotografei o estado "Copiloto não está disponível agora"**. Barra de comando com resposta, cartão de confirmação e pílula em execução **não foram vistos**.

Li uma por uma cerca de 35 fotos: as telas principais em 390, as mais densas também em 320 e 1440.

---

## (a) O que está bom e deve ser mantido

1. **A casca de login e cadastro** (`acesso-login-freela__390`) está limpa. A página é o formulário, "Voltar" virou link, o seletor de papel é segmentado e "Entrar" aparece sem rolar. No PC, o cartão centralizado está correto.
2. **O cartão "Você está no turno agora"** (`freela-telas-inicio__390`) é o melhor componente do app. Tem um primário verde com sombra, endereço, valor e o status "Empresa confirmou chegada". É o modelo de "cartão só para o que pede ação agora".
3. **A faixa de métricas de 3 colunas** (Ganhos, Empresas, Nível) substituiu os 3 cartões, como pedia a regra 7.
4. **Listas com `divide-y`**: Histórico recente, Turnos recentes, Primeiros passos e Elenco ativo seguem a regra.
5. **O onboarding em uma coluna** (`onboarding-freela-passo1-vazio__390`) tem barra de passos, "Falta preencher: ..." em lugar de asterisco e "Próximo" em barra inferior de largura total.
6. **A validação de "Criar turno"** (`empresa-turnos-criar-validacao__320`) traz erro sob o campo, com ícone e texto, e borda vermelha. Está exemplar.
7. **Os chips de filtro em 1 linha rolável** e as abas sublinhadas em Meus Turnos (regra 11) funcionam.
8. **A ação inferior fixa no detalhe do turno** ("Chamar freelas") e em Criar turno cumpre a regra 9.
9. **O verde do freela e o preto da empresa** estão consistentes nos CTAs principais. A borda de 1,5px deixou os campos mais leves sem perder o caráter.
10. **O estado vazio da empresa** ("Você ainda não tem turnos." com uma ação) e o estado de erro com "Tentar de novo" estão corretos em conteúdo.

---

## (b) Defeitos por severidade

### ALTO (o dono nota no primeiro minuto)

| # | Tela / tamanho | Defeito | Correção |
|---|---|---|---|
| A1 | `freela-telas-inicio__320` | **O dinheiro aparece truncado: "R$ 2.3…"** na faixa de métricas. Valor em reais nunca pode ter reticências. | Na métrica, trocar `truncate` por `tabular-nums text-[clamp(18px,5vw,22px)]`. Abaixo de 360px, Ganhos ocupa linha inteira (`col-span-3`), ou o formato fica compacto ("R$ 2,4 mil") com o valor completo em `title`/aria. |
| A2 | BottomNav do freela e da empresa a 320 | Rótulos cortados: "Empres…", "Recebimen…", "Mensag…". | Usar rótulos curtos ("Empresas" → "Clientes"? "Recebimentos" → "Recibos", "Mensagens" → "Chat"), ou `text-[11px] tracking-tight` sem `truncate`, ou só ícone abaixo de 340px. |
| A3 | `erros-error-boundary-logado__390` | O ErrorBoundary usa cartão com borda preta de 2px e **sombra borrada** (blur). É o único blur do app e quebra a regra 2. | Usar `ErrorState` do sistema sem caixa: ícone, título, frase, botão. |
| A4 | `empresa-turnos-lista__1440`/`1024` | Os chips de filtro aparecem **cortados à direita ("Concluídos")** mesmo com 600px livres, porque a máscara de rolagem de `FilterChip` age no desktop. | Aplicar a máscara só quando houver overflow (`@container` ou checar `scrollWidth`), ou `md:[mask-image:none] md:flex-wrap`. |
| A5 | `equipe-gestor-pessoas__390` | A linha de convite (João Pedro, Camila, Diego) espreme o texto numa coluna de ~100px, com 4 a 5 linhas ("O prazo de 72 / horas para / confirmar..."). Fica amador. | Em `MemberCard`, o texto de ajuda passa para a linha de baixo em largura total (`basis-full`), e "Novo link"/"Convidar de novo" vira item do `Menu` ou botão `sm` abaixo do texto. |
| A6 | `equipe-gestor-pessoas__390` | "Não é essa pessoa" é um **botão vermelho cheio de largura total**, logo abaixo de "Confirmar" preto. Viola a regra 6: vermelho só no diálogo final. | Usar `dangerOutline` ou botão de texto vermelho. O vermelho cheio fica para o diálogo de confirmação. |
| A7 | `freela-perfil-visao__390` | **O perfil tem 2.577px**: 8 cartões empilhados, capa preta em gradiente e CPF e PIX em texto aberto. É a tela que mais contradiz a reforma. | Capa vira faixa verde clara de 72px, ou some. Nível vira faixa de 3 métricas sem caixas internas. "Dados" vira lista com CPF e PIX mascarados (`•••.982.247-••`) e "mostrar". Certificações, Avaliações, Preferências e Ajuda viram **um** grupo de lista. "Configurações da conta" vira linha da lista. |
| A8 | `empresa-painel-inicio__390` | **A ação principal está invertida.** "Criar turno" é contornado pequeno, enquanto "Registrar saída" é preto cheio dentro da linha. No estado vazio, "Criar turno" fica preto e "Criar primeiro turno" também, ou seja, 2 primários pretos na mesma tela. | Uma regra: o CTA do cabeçalho segue contornado sempre que existir uma ação de linha urgente. No estado vazio, mostrar só o botão do estado vazio (esconder o do cabeçalho). |

### MÉDIO

| # | Tela | Defeito | Correção |
|---|---|---|---|
| M1 | Início, Hoje e Início vazio da empresa (`empresa-painel-*`) | "Primeiros passos" ocupa ~430px com 5 linhas "Me mostre" iguais, repetido em Início **e** Hoje. | Mostrar só o próximo passo (1 linha + "4 restantes"), ou recolher depois do 1º turno criado. Não repetir no Hoje. |
| M2 | `empresa-painel-inicio__390` | A faixa de KPIs em fundo cinza e sem borda parece **esqueleto de carregamento**; com 0/0/0 (vazio) é puro ruído. | Fundo branco com `divide-x` e a mesma borda do grupo de lista. Esconder quando tudo for zero. |
| M3 | Linhas de turno da empresa (Início 390) | O meta é truncado no ponto útil ("· Ate…", "· …") e o avatar some no celular, mas existe no PC. | Trocar a ordem: data · hora na 1ª linha e local na 2ª. Mostrar o avatar também no celular (32px). |
| M4 | Turnos recentes (Início empresa) | Cada linha tem chevron **e** ícone de "repetir" sem rótulo: dois alvos lado a lado, e o ícone é enigmático. | Tirar o chevron (a linha inteira navega). "Repetir" vira item de `Menu` ou botão com texto "Repetir". |
| M5 | Histórico recente (freela) | O chevron fica **antes** do selo de status, no meio da linha. | Selo junto ao texto ou à direita, e chevron sempre no fim. |
| M6 | `empresa-turnos-lista__390` | Em 4 linhas, 3 botões "Presença" idênticos e 1 "Chamar" preto com sombra. Títulos quebram em 2 linhas. Etiquetas "Série · todo sábado" somam ~30px por linha. Linha de ~150px (regra 8 pede ≤ 96px). | "Presença" vira toque na linha e o botão fica só no turno de Hoje. Série vira ícone ↻ inline no meta. `line-clamp-1` no título. |
| M7 | `equipe-gestor-hoje` / `empresa-painel-hoje-dono-sozinho__390` | Ações mistas: "Ver turno" (texto), "Chamar" preto cheio, "Chamar" contornado. Peso visual sem lógica aparente. | Preto cheio só no turno mais urgente (hoje + falta). Os demais ficam contornados. "Ver turno" sai, porque a linha navega. |
| M8 | `freela-turnos-convites__320` | O cartão do convite tem pílulas de 3 cores (cinza horário, verde valor, azul endereço). O azul é a cor da empresa e aparece na tela do freela. "Aceitar" e "Recusar" têm ícones, enquanto "Sim, vou"/"Não vou poder" não têm. | Pílulas viram linhas de meta com ícone cinza (como no cartão Hoje). Endereço sublinhado, sem fundo azul. Botões sem ícones. |
| M9 | Status azul no app do freela | "Em andamento" no chat do freela e "Identidade verificada" no perfil estão em azul `#2563EB`, a cor da empresa. | Tom de status neutro ou verde no contexto do freela (`StatusBadge tone="info"` → `gray`). |
| M10 | `pagamento-recibo-recebimentos__390` | Cada pagamento é um cartão com ícone cinza de prédio (sem informação), endereço do turno (irrelevante para dinheiro) e "Previsto (promessa)". | Um grupo de lista por seção. Remover ícone e endereço. Linha: título + empresa / data + status, valor à direita. "Previsto para 29/11". |
| M11 | `pagamento-recibo-recibo-registrado-confirmar__390` | O botão desabilitado verde-claro "Aceitar termo e confirmar recebimento" parece quebrado. O mesmo vale para "Aceitar e Continuar" no TOS, "Criar etiqueta" cinza e o enviar do chat. | Botão desabilitado com `opacity-50` sobre a cor real e o texto do motivo logo abaixo. Melhor ainda: manter habilitado e validar no clique. |
| M12 | `freela-telas-mensagens__390` | A lista não tem prévia nem hora da última mensagem (no PC da empresa tem). Avatar "M" em quadrado cinza; no PC, círculo com ícone de pessoa no cabeçalho. | Mesmo `ConversationRow` nos dois papéis: avatar, nome, prévia com 1 linha e hora. |
| M13 | `freela-telas-mensagens-conversa__390` | Faixa cinza vazia de ~16px entre o topo e o cabeçalho da conversa. O campo tem borda preta de 2px enquanto o resto usa 1,5px. | Tirar o `pt`/margem do contêiner. O campo usa `border-ink` 1,5px. |
| M14 | `empresa-painel-inicio__1440` / sidebar | "Criar turno" e o item ativo "Início" são **duas lajes pretas idênticas** empilhadas. | Item ativo com fundo `gray-100` e texto preto semibold (ou barra lateral de 3px). Preto só no CTA. |
| M15 | 1440 em todas as telas | "Como faço...?" / "Ajuda e copiloto" é um botão contornado de 44px solto no canto, mais pesado que o título. O botão verde de largura total no cartão Hoje ocupa 900px. | Botão de ajuda como ícone + texto `ghost`. No PC, CTA de cartão com `md:w-auto md:min-w-[240px]`. |
| M16 | `freela-turnos-erro__390` | O erro perde o título da página ("Meus Turnos") e vem numa caixa rosa (a regra 12 pede sem caixa). | Manter `PageHeader` e usar `ErrorState` sem fundo. |
| M17 | `empresa-elenco-elenco__390` | Avatares azul-marinho cheios (o resto do app usa cinza claro). Botão de enviar em caixa + "..." em 7 linhas. Meta truncado ("1 turno co…"). | Avatar padrão cinza (ou cor por pessoa, igual em todo o app). Enviar vai para dentro do `Menu`, ou fica só o ícone sem caixa. |
| M18 | `empresa-turnos-detalhe__390` | O selo "Aberto" é azul, com ícone tracejado que parece spinner de carregamento. | Ícone de círculo vazio sólido ou nenhum ícone. Usar tom neutro. |

### BAIXO

- O título está em Title Case em vários lugares: "Termos de Uso Atualizados", "Aceitar e Continuar", "Recibo de Pagamento", "Esta Semana", "Fazer Login". Usar caixa de frase.
- A marca muda de gênero: o TOS diz "a Worki", o resto diz "o Worki". Também alternam "Email" e "E-mail".
- No onboarding, `dd/mm/aaaa` e `--:--` aparecem em preto (parecem preenchidos) enquanto os outros placeholders são cinza. Usar `text-gray-400` até ter valor.
- A barra de passos do onboarding do freela é preta. Para o freela, usar o verde `primary`.
- Em Criar turno, Data, Entrada e Saída ficam cada um em uma linha. Juntar Entrada e Saída numa linha de 2 colunas economiza ~90px.
- O disclosure "Requisitos, briefing e certificação (opcional)" tem cara de botão contornado centralizado. Usar uma linha de lista com chevron à esquerda.
- "Repetir este turno" tem caixa tracejada; é o único tracejado do app junto com "Aguardando aceite" no Elenco. Tirar.
- Equipe: os títulos de seção variam ("Precisa da sua confirmação" com 20px, "Pessoas" com 16px, "Etiquetas" com ícone).

---

## (c) Inconsistências entre telas

| Tema | Onde diverge |
|---|---|
| **Título de seção** | 16 semibold sem ícone (Início) contra 20 bold (Equipe "Precisa da sua confirmação"), com ícone (Perfil "Disponibilidade da semana", Equipe "Etiquetas") e verde (Recebimentos "Confirme o recebimento"). Usar 16/semibold, sem ícone, sempre preto. |
| **Contagem no título** | "Precisa de você (1)" e "Turnos em andamento (2)" usam parênteses; Turnos usa "Hoje [2]" em pílula. Escolher a pílula. |
| **Avatar** | Quadrado cinza com letra (Mensagens freela), círculo cinza com letra (Início empresa PC), círculo azul-marinho cheio (Elenco), ícone de pessoa (cabeçalho do chat) e prédio cinza (Recebimentos). Usar um `Avatar` com 2 formas: pessoa redonda e empresa `rounded-xl`, ambas com inicial. |
| **Botão desabilitado** | Verde-claro (recibo, TOS, enviar do freela), cinza cheio (Criar etiqueta, enviar da empresa). |
| **Ação da linha** | Botão contornado, botão preto cheio, botão de texto ("Ver turno"), ícone em caixa (Elenco), ícone solto (repetir). |
| **Cor da bolha do chat** | O freela é verde. A empresa é **azul**, mas os CTAs da empresa são pretos. Escolher: bolha preta da empresa ou azul como cor real da empresa em todo lugar. |
| **Barra superior** | Linha preta de 2px sob o header em toda tela; é a única borda de 2px que sobrou visível. Usar 1,5px ou `gray-200`. |
| **Vazio** | Caixa cinza com texto ("Sem próximos turnos marcados.", "Sem histórico recente.") contra vazio sem caixa com CTA (Início empresa). |
| **Chevron + selo** | Selo depois do chevron (Histórico), chevron + ícone extra (Turnos recentes), chevron + contador (Indicações). |
| **Copiloto** | Título "Como posso ajudar?" no celular contra "Copiloto do Worki" no PC. Botão em pílula 100% arredondada; o resto do app usa 12px. |

---

## (d) As 10 melhorias de maior impacto para a primeira impressão no celular

1. **Perfil do freela enxuto (A7):** de 2.577px para ~1.100px, com um grupo de lista e CPF/PIX mascarados.
2. **Nada de dinheiro truncado (A1)** e **BottomNav sem reticências a 320 (A2).**
3. **Um primário por tela na empresa (A8, M7):** "Criar turno" coerente, um só preto cheio por dobra.
4. **Primeiros passos compactos (M1):** libera ~400px no Início e no Hoje da empresa.
5. **Linha de turno ≤ 96px em Turnos (M6):** menos "Presença" repetido, série como ícone.
6. **Recebimentos como lista (M10):** é a tela do dinheiro; hoje parece um feed de cartões genéricos.
7. **Equipe e convites legíveis (A5, A6):** a tela com pior acabamento hoje.
8. **Avatar único (c):** pequeno, mas é o que mais faz parecer "telas de autores diferentes".
9. **Botão desabilitado com padrão (M11):** hoje 3 telas importantes (recibo, termos, chat) parecem quebradas.
10. **Mensagens com prévia e hora (M12)** no freela, igual à empresa.

---

## (e) O que ficou frágil ou perdeu personalidade com a identidade mais leve

- **O login e o onboarding não têm marca nenhuma.** Não há logo, verde (fora do botão) nem frase do produto. Poderia ser qualquer SaaS. Sugestão: logo "W." de 40px no topo da casca e uma faixa verde de 4px, ou o "W." grande ao lado do título no PC.
- **O fundo cinza-quente com cartões brancos de borda cinza-clara** está correto, mas plano demais. Sem a sombra, o único "brutalismo" que sobrou é a sombra do botão principal e a linha preta do header. Recomendo manter **um** acento por tela: o cartão em foco com `border-ink` preta de 1,5px (hoje ele tem a mesma borda cinza dos demais). Isso devolve hierarquia sem peso.
- **Os títulos de 24 bold, sem caixa-alta, ficaram genéricos.** Uma fonte de título com mais caráter (o projeto já usa pesos fortes) ou `tracking-tight` no `PageHeader` recupera identidade sem voltar ao `font-black`.
- **As métricas da empresa em cinza sem borda parecem placeholder** (M2). Aqui a leveza virou fragilidade: número de destaque pede borda ou fundo branco.
- **O copiloto parece de outro produto.** O ícone com gradiente arco-íris é o único gradiente do app. O botão em pílula total e o painel sem borda preta, sem nenhum traço do sistema, completam a impressão. Sugestão: ícone "W." ou faísca monocromática verde (freela) ou preta (empresa), borda `border-ink` no painel e botão com `rounded-xl` do sistema. No PC, o painel abre no meio da lista, sobre conteúdo; ancorar no topo, sob o botão "Ajuda e copiloto". **Não avaliado:** resposta do agente, cartão de confirmação e pílula de execução (falta fixture `copilot-llm` na galeria; vale criar uma).
- **O cartão "Pagamento para confirmar"** em verde-claro com borda verde ficou bonito, mas compete com o cartão do turno. É o único lugar onde a leveza ainda gera duas áreas "em foco".

---

### Lacunas desta revisão

- O copiloto foi visto só em estado indisponível.
- Não abri: modais de Presença/Pagamento, SOS completo, Lote/seleção a 320, Notificações e telas públicas (landing).
- A cópia de galeria com copiloto ficou em `...\scratchpad\gc\` e não altera o repositório.
