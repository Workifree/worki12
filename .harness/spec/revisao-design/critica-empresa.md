# Crítica de design: lado EMPRESA do Worki

## Escopo e método

- Base: capturas `empresa__*.png` (commit `d3edc83c`), em `...\scratchpad\telas\shots\`. Vistas em 390px, 1440px e 320px quando havia.
- Itens já corrigidos (casca dos modais, toasts, validação, altura do chat, contraste básico, `Button sm`, texto mínimo) não foram repetidos.
- Os pontos marcados **[código]** foram conferidos no `HEAD` atual. Os demais vêm só da imagem e valem reconferência.
- **Não avaliado (sem captura):** Cobrir, Passar para..., Cancelar turno, modais de série, Estornar, Confirmar entrega, saída manual, Convidar outro, excluir lista, remover ou confirmar pessoa, visão do Encarregado. Quase não há carregando nem erro nas capturas (só o erro da Trilha).
- Os nomes "ZZ-TESTE" são dado de teste e não contam como defeito.
- Não vi emoji nas telas da empresa.
- Arquivos citados sem caminho completo ficam em `frontend/src/pages/company/`.
- Severidade: **ALTO** confunde, induz erro ou tem cara amadora evidente. **MÉDIO** atrapalha. **BAIXO** é acabamento.

---

## 0. Casca global (layout, navegação, FAB)

Imagens: `empresa__inicio__celular__dobra.png`, `empresa__hoje__320__dobra.png`, `empresa__turnos__celular__modal-menu-turno.png`.

- **ALTO: o FAB "Criar turno" cobre a ação principal dos cards.** No Início ele corta "Presença e Pagamento", que vira "Presenç". No Hoje a 320px corta "Abrir turno". Em Turnos cobre nome, status e a área do `...`. É uma pílula preta larga, igual aos botões que ela cobre.
  - `layouts/CompanyLayout.tsx` (`.worki-fab`) **[código]**. O `pb-40` só resolve o fim da rolagem.
  - Correção: recolher para um círculo `h-14 w-14` (só "+", com `aria-label`) ao rolar para baixo e reexpandir ao rolar para cima. Melhor ainda: tirar o flutuante e pôr "Criar" como item central da BottomNav, ou botão no `PageHeader` de Turnos e Hoje. Se continuar flutuante, o CTA do card não pode ocupar o canto direito.
- **ALTO: o menu `...` abre por baixo do FAB e da BottomNav.** "Pausar" e "Excluir" ficam inacessíveis.
  - `CompanyJobs.tsx:337` usa `z-10`; o FAB usa `z-30` e a nav `z-50` **[código]**. `CompanyJobDetails.tsx:261` usa `z-20`.
  - Correção: no celular, o menu vira folha inferior (`<dialog>`, itens `h-12`, "Excluir" separado por `border-t-2` no fim). No desktop, popover em top layer (`popover` com anchor), que também abre para cima quando falta espaço.
- **MÉDIO: a identidade muda entre celular e desktop.** O celular mostra "Worki." com o selo "Business"; o desktop mostra "Worki" com "EMPRESA". Usar "Empresa" nos dois (`components/Sidebar.tsx` e o header de `CompanyLayout`).
- **MÉDIO: a navegação mistura três cores de "ativo".** BottomNav azul, Sidebar preto com sombra verde (verde é a cor do worker), sino verde. Na empresa, o ativo deve ser preto com sombra preta ou azul, nunca verde (`Sidebar.tsx`, `BottomNav.tsx`, sombra do FAB).
- **MÉDIO: "Hoje" ativa o item "Início"**, e o H1 diz "Hoje". Alinhar os nomes e usar as abas Hoje / Visão geral também no dono único, ou renomear o item.
- **BAIXO: "Relatórios" é item da Sidebar no desktop e fica dentro de Gestão no celular.** Na captura `gestao__desktop` o card some. A decisão é aceitável, mas deve ser deliberada.
- **BAIXO:** o container `max-w-7xl` em 1440px deixa faixas de fundo com tom diferente nas laterais, visíveis como "moldura quebrada" (`CompanyLayout.tsx`).
- **Manter:** BottomNav com 5 itens rotulados, "Criar turno" no topo da Sidebar, "Sair" separado.

---

## 1. Início (`CompanyDashboard.tsx`)

Imagens: `inicio__celular__{dobra,full}`, `inicio__desktop__full`, `inicio__320__full`.

- **ALTO: a primeira dobra é só de contadores.** Três cards de cerca de 115px cada empurram "Contratados" para baixo. "Total de turnos" não gera ação, e "Em andamento 0" é ruído.
  - Correção: uma faixa `grid-cols-3` com cards `p-3` (número `text-xl`, rótulo `text-xs`), todos clicáveis com o filtro correspondente. Remover "Total". A primeira seção passa a ser o que exige ação hoje: sem freela, aguardando chegada, a pagar.
- **ALTO: em 320px o card de contratado perde a identidade** ("W...", "ZZ-...", "Loc..."), porque o chip de status disputa a linha com o nome. Pôr o chip em linha própria, abaixo do nome e do turno, e o nome com `line-clamp-2`.
- **ALTO: o card não mostra data nem horário.** Três "Worker E2E" só se distinguem pelo título truncado. Mostrar "Hoje · 18:00–22:00" na 2ª linha. "Local a combinar" é menos importante que o horário.
- **MÉDIO: três botões pretos iguais "Presença e Pagamento"**, mesmo quando o estado pede gestos diferentes. O rótulo deve seguir o estado ("Confirmar chegada", "Registrar pagamento", "Ver turno"). Botão `fullWidth`, `h-11`.
- **MÉDIO: os "Turnos recentes" são cards altos** (cerca de 145px) com "Freelance" (vocabulário antigo, sem informação), "Criado há 2 horas" (dado errado para a decisão) e "Repetir" solto. Virar lista densa num único card com `divide-y`: título, data e hora do turno, status e `IconButton` Repetir. Máximo de 3 itens, com "Ver todos".
- **MÉDIO:** "Atividade recente" repete esses turnos, e o sino faz o mesmo papel. Remover no celular. Os pontos verde e azul não têm legenda.
- **MÉDIO (desktop):** a grade de 2 colunas com 3 itens deixa um buraco. Em `lg`, usar linhas densas (pessoa, turno, horário, status, ação).
- **BAIXO:** "Bem-vindo de volta" não informa; usar a data de hoje. "Completar Perfil" e "Ver todos" fora do padrão de caixa das frases.
- **Manter:** chip amarelo "Aguardando chegada" e o atalho de Indicações. O atalho, porém, deve aparecer só quando houver indicação.

## 2. Hoje (`CompanyToday.tsx`)

Imagens: `hoje__celular__{dobra,full}`, `hoje__320__*`, `hoje__desktop*`.

- **ALTO: turno vazio e turno preenchido são visualmente idênticos.** "0 de 1 vaga preenchida" e "1 de 1" usam o mesmo cinza. É a principal informação da tela (disponibilidade) **[código, linhas 515-525]**.
  - Correção: chip de estado no topo do card. Sem freela: âmbar com ícone, como em Turnos (`bg-amber-50`, "Falta 1"). Completo: verde. Em andamento ou a pagar: chip próprio. O CTA muda junto: "Chamar freelas" (dark) no vazio, "Ver turno" (secondary) no completo.
- **ALTO: "Abrir turno" preto de largura total em todo card.** São cerca de 10 CTAs iguais e 170px por turno, ou seja, 3 turnos por tela. O card inteiro deve ser clicável (`Card onActivate`), com chevron. Botão só quando há pendência. Meta: altura de 88 a 96px.
- **ALTO: o subtítulo promete "com quem responde por cada um" e nada aparece** no dono único. A linha só é renderizada com `teamEnabled`, mas o subtítulo depende de `gestor` **[código, linhas 340-342 e 526]**. Condicionar a `gestor && teamEnabled`.
- **MÉDIO:** não aparecem hora final, função, local nem o nome de quem foi contratado. Usar "18:00–22:00 · Garçom · Ana". Turnos de 00:20 que já terminaram continuam no topo sem marca de encerrado. Mandar os encerrados para um grupo recolhido.
- **MÉDIO:** "Hoje" aparece duas vezes (H1 e H2). Os títulos usam `font-black`, fora da escala refinada (`text-lg font-bold`).
- **MÉDIO (desktop):** cards de cerca de 770px com um botão pequeno à esquerda e o resto vazio. Em `lg`, linha única: hora, título, ocupação e ação à direita.
- **[código] a validar sem captura:** quando existirem, "Passar para..." e "Cancelar turno" entram em `grid sm:grid-cols-3` e, no celular, empilham 3 botões `lg`. Cancelar fica colado, com o mesmo peso. Mover os dois para o `...` do card, com Cancelar separado e em vermelho.
- **Manter:** o agrupamento por dia.

## 3. Turnos (`CompanyJobs.tsx`)

Imagens: `turnos__{celular,320,desktop}*`, `turnos-filtro-*`, `turnos__*__modal-*`.

- **ALTO:** menu coberto (ver seção 0).
- **ALTO: a pílula verde "Presença" parece status** e não ação. É fraca, e é a ação principal do turno com freela. O card também não deixa claro se é clicável. Trocar por `Button variant="secondary"` "Marcar presença", com a mesma posição e altura de "Convidar freela".
- **ALTO: o filtro padrão "Todos" mistura encerrados no topo de "Hoje".** Há três nomes para o mesmo estado: chip "Concluído", linha "Finalizado" e filtro "Finalizados". Ordenar o dia como: precisa de ação, próximos, encerrados (com `opacity-80`, recolhidos). Usar só "Concluído".
- **MÉDIO:** "Sem freela" com fundo âmbar só aparece em "Amanhã". Outros turnos igualmente vazios (sexta, segunda) ficam brancos. Se a regra for urgência, escrever isso no chip ("Sem freela · amanhã") e manter chip neutro "Sem freela" nos demais.
- **MÉDIO:** os chips de filtro quebram em 2 linhas (390 e 320), com "Finalizados" órfão. Usar linha única `overflow-x-auto` ou segmentado `grid-cols-4 text-xs` com rótulos "Todos / Abertos / Agora / Concluídos". Hoje busca, filtros e cabeçalho gastam cerca de 300px. A busca pode virar ícone.
- **MÉDIO:** o vazio "Nenhum turno encontrado." (`turnos-filtro-andamento`) não tem próximo passo. Usar "Nenhum turno em andamento agora." com os botões "Ver todos" e "Criar turno".
- **MÉDIO:** o menu tem 6 itens e mistura a ação principal ("Presença e Pagamento") com Excluir. "Pausar" e "Editar" aparecem em turno concluído (`modal-menu-turno`). Filtrar o menu por estado.
- **ALTO: o diálogo diz "Excluir turno", e o texto diz "O turno será cancelado".** O botão "Cancelar" ao lado de "Excluir" fica ambíguo num fluxo de cancelamento. O detalhe ainda oferece "Cancelar turno" e "Excluir" no mesmo menu **[código, `CompanyJobDetails.tsx:277-292`]**.
  - Correção: um só gesto. Título "Cancelar este turno?", com nome, data e quantos freelas serão avisados. Botões "Voltar" e "Cancelar turno" (danger). "Excluir" só para turno vazio.
- **MÉDIO (`modal-convidar-freela`):** é um segundo caminho, diferente de "Chamar freelas". O texto "atrelar a este turno" não identifica o turno. Mostrar título e data no subtítulo e usar o mesmo componente e verbo ("Chamar").
- **Desktop, MÉDIO:** é a melhor lista do produto, mas cada linha tem um grande vão no meio. Dar colunas fixas (hora, turno e local, freela, status, ação). Hoje as ações mudam de x conforme o estado.
- **Manter:** grupos com contador, hora em negrito, "Convidar freela" no card vazio, `...` sempre à direita.

## 4. Detalhe do turno (`CompanyJobDetails.tsx`)

Imagens: `turno-detalhe__{celular__full,desktop}`, `__modal-menu`, `__modal-excluir`.

- **ALTO: não há ação principal quando existe freela.** O caminho para Presença e Pagamento são as linhas "Candidatos 1" e "Em andamento 1", sem chevron nem aparência de botão. O comentário no código diz "Resumo + a ação principal do turno", mas o botão só existe no vazio **[código, linhas 348-383]**.
  - Correção: botão dark `lg fullWidth` "Presença e pagamento" (ou o próximo passo) logo abaixo do cabeçalho no celular, preso acima da BottomNav. No desktop, no topo da coluna lateral.
- **ALTO:** no vazio, "Convidar freelas do elenco" leva para `/company/team` e perde o contexto do turno **[código, linha 364]**. Abrir ali o Chamado deste turno.
- **MÉDIO:** "Candidatos" é vocabulário de marketplace e não vale no modelo de convite. Usar "Freelas · 1 de 1 vaga". "Em andamento 1" aparece em turno de sexta, ainda futuro, o que contradiz o estado. Usar "Contratados".
- **MÉDIO:** a hierarquia está invertida. "Criado há 14 horas" e o preço grande aparecem antes do horário, que está numa caixinha abaixo da descrição. O cabeçalho deve dizer "Sex., 27/11 · 10:00–14:00" em `text-base font-bold`, com local abaixo. Mover "Criado há" para o rodapé.
- **BAIXO:** "R$ 100" deve ser "R$ 100,00". "/ dia" pode ficar na mesma linha. "Sexta-Feira" tem o F maiúsculo por causa do `capitalize`.
- **Manter:** "Voltar" e `...` em posição previsível; Excluir em vermelho no fim do menu.

## 5. Presença e Pagamento (`CompanyJobCandidates.tsx`)

Imagens: `turno-candidatos{,-2,-3}__*`.

- **ALTO: o histórico de chamados empurra o trabalho para fora da dobra.** Três cards "Chamado encerrado" (dois sem aceite) ocupam a primeira tela inteira, e o freela contratado fica escondido (`turno-candidatos__celular__dobra`). `components/team/ShiftCallsPanel.tsx`.
  - Correção: a ordem passa a ser freelas e depois chamados. No topo fica apenas o chamado aberto. Os encerrados vão para um `<details>` "Histórico de chamados (3)", uma linha cada.
- **ALTO: o card do freela tem cinco elementos com o mesmo peso numa sopa de wrap**: chip "Contratado", "Confirmar Presença", a pseudo-checkbox "☐ Confirme a chegada primeiro", "Pedir confirmação" e "Dispensar". A "checkbox" é um `StatusChip` com ícone `Square` e parece clicável **[código, linhas 1652-1655]**.
  - Correção, em três zonas: (1) nome e status no topo; (2) um único CTA dark `fullWidth h-12` do próximo passo; (3) secundárias numa linha `grid-cols-2`. "Dispensar" fica no rodapé, após `border-t`, alinhado à direita, ou no `...`. Apagar o chip "Confirme a chegada primeiro", porque o stepper já explica.
- **ALTO: o stepper no celular vira uma escada desalinhada** de cerca de 250px, com círculos em x diferentes e sem conectores. `components/JobLifecycleStepper.tsx:27` usa `flex-col sm:flex-row items-center` com `li w-full` **[código]**.
  - Correção: horizontal sempre (`grid grid-cols-4`, círculo `h-6 w-6`, rótulo `text-xs`), ficando com cerca de 56px.
- **ALTO: o rótulo da ação é ambíguo.** "Confirmar Presença" abre um modal que registra o horário real de chegada. "Pedir confirmação" é a véspera. Há três "confirmar" diferentes. Usar "Registrar chegada", "Registrar saída" e "Perguntar se vem".
- **MÉDIO:** o card inteiro navega para o perfil (`role="button"`) e contém botões, o que favorece toque acidental no meio do pagamento. Só avatar e nome devem navegar.
- **MÉDIO:** há ruído de gamificação e campos vazios ("Lvl 5", "Não informado", "Sem avaliações ainda", e "Sem observações do freela." em caixa, itálico e aspas). Ocultar o que está vazio. Mostrar valor combinado, horário e telefone ou WhatsApp, que hoje faltam.
- **MÉDIO:** "Falta de funcionário" e "Outro" em pílula preta sólida parecem botão ou status crítico. Usar texto cinza "Motivo: ...". "1 chamado · 1 aceite" deve ser "1 chamado enviado". "Chamado cancelado" por pessoa repete o título.
- **MÉDIO (`-2`, sem freela):** há três CTAs para preencher: "Chamar Freelas", "SOS: fora do Elenco" (cinza, sem dizer por que está desabilitado) e "Convidar Freela do Elenco". Manter um primário "Chamar freelas". Esconder o SOS até ser elegível ou explicar em texto ("Libera 4h antes do turno"). O vazio não deve ter um segundo caminho. "Atrelado" deve virar "Nenhum freela neste turno".
- **MÉDIO (`-2`):** o "Cancelar" solto no card amarelo não diz o que cancela. Usar "Encerrar chamado". O chamado segue "aberto" com a única pessoa tendo recusado. Mostrar "Todos recusaram" e o CTA "Chamar mais gente".
- **[código] MÉDIO:** pagamento agendado mostra "Marcar como pago", "Ver Comprovante" e "Estornar" (linhas 1206-1235). "Estornar" para algo ainda não pago deve ser "Cancelar agendamento". "Avaliar" não pode ter o mesmo peso de "Ver Recibo".
- **MÉDIO:** o status é "Finalizado" aqui e "Concluído" no resto.
- **BAIXO:** o H1 "Presença e Pagamento" é genérico, e o nome do turno fica em cinza sem data. Usar o turno como título, com data e hora no subtítulo.
- **Desktop, BAIXO:** coluna única com a faixa verde de "Primeira vaga preenchida" na largura toda. Em `lg`, duas colunas (freelas 2/3, chamados 1/3).
- **Manter:** "x de y vagas preenchidas", o tempo de preenchimento (como linha discreta), "Chamar Freelas" no topo.

### Modais de Presença e Pagamento

- **Registrar e agendar pagamento. ALTO [código]:** a chave PIX só renderiza se existir (linhas 2111 e 2248). Sem chave, como nas capturas, nada avisa, justamente no momento de pagar. Mostrar "Freela sem chave PIX" com "Pedir no WhatsApp" ou "Ver contato". O modal também não diz **quem** está sendo pago nem de qual turno. Pôr "Pagar Ana · Garçom · 25/11" no título.
  - **MÉDIO:** o aviso âmbar do agendamento tem 5 linhas e "PROMESSA" em caixa-alta. Reduzir a duas frases. O âmbar fica para risco, e o resto vai em texto cinza.
  - **MÉDIO:** o efeito colateral "o turno será marcado como concluído" está enterrado. Colocar logo acima do botão.
  - **BAIXO:** "Confirmar Registro" e "Confirmar Agendamento" quebram em 2 linhas. Usar "Registrar" e "Agendar", em `grid-cols-[1fr_1.4fr]`. O valor deve ter máscara `R$ 100,00` e `inputmode="decimal"`.
  - **Manter:** o segmentado PIX / Dinheiro / Outro (tirar a sombra dos não selecionados, que hoje parecem três botões de ação).
- **Presença manual. ALTO [código]:** o texto diz "Pré-preenchido com o horário planejado", mas o campo vem `--:--` quando esse horário ainda é futuro (linhas 1121-1124 e 1963). O texto deve ser condicional. Com turno futuro, a ação nem deveria ser oferecida como principal: explicar "Disponível a partir das 10:00".
- **Chamar freelas. MÉDIO:** "Todos" parece filtro, mas seleciona; usar "Selecionar todos". A busca com 1 pessoa é desnecessária (mostrar acima de 6) e o placeholder fica cortado. Pré-selecionar o motivo "Falta de funcionário" contamina o relatório; começar com "Selecione". O rodapé fixo com contagem está bom: manter.
- **Dispensar. BAIXO:** a hierarquia é boa. Corrigir "está contando com ele" (gênero) e usar "Voltar" e "Dispensar".
- **Avaliar. MÉDIO:** as 5 estrelas vêm preenchidas, o que induz nota 5. Começar vazio e desabilitar o envio sem nota.

## 6. Criar e editar turno (`CompanyCreateJob.tsx`)

Imagens: `criar-turno*`, `turno-editar*`. Há mudanças no `HEAD` neste arquivo; reconferir.

- **ALTO: o celular tem cerca de 2.100px e a ação fica só no fim**, sob a BottomNav. Prender uma barra de envio acima da nav (`sticky`, com resumo "4 h · R$ 100" e o botão `h-12`) e esconder a BottomNav nesta tela.
- **MÉDIO:** a ordem não acompanha a urgência. Pôr "Função, data, entrada, saída, pessoas e valor" primeiro. Título e descrição podem ser sugeridos pela função, e a descrição obrigatória é atrito. Entrada e Saída em `grid-cols-2`, também em 320px.
- **MÉDIO:** "Comece de um turno anterior" no desktop são 6 cards em grade antes do formulário; limitar a 3 ou a uma linha. No celular, o carrossel cortado está bom.
- **MÉDIO (desktop):** o botão final encolhe e quebra "Criar / turno". Usar `shrink-0 whitespace-nowrap min-w-40`.
- **MÉDIO:** o "Falta preencher: ..." em frase corrida de 7 itens não leva ao campo. Mostrar "Faltam 7 campos" com link para o primeiro.
- **MÉDIO (editar):** o campo Valor desabilitado parece placeholder. Mostrar como texto "R$ 100,00 por dia (fixo)" e remover o select de tipo se também for fixo. Editar não oferece Cancelar nem aviso sobre o impacto em freela já contratado.
- **BAIXO:** o acordeão opcional tem sombra de botão e rótulo em 2 linhas; usar "Mais detalhes (opcional)" como linha sem sombra. Travessões na copy ("— o Worki registra"). "Intervalo de almoço (1h)" em turno noturno deve ser "Intervalo (1h)".
- **Manter:** três blocos nomeados, labels, hints, duração calculada, "Repetir este turno", e 2 e 3 colunas no desktop. É a melhor tela de formulário.

## 7. Elenco (`CompanyTeam.tsx`)

Imagens: `elenco__*`.

- **ALTO: o modal "Adicionar freela" expõe jargão técnico.** "ID do worker", "Worki ID", "Cole o ID", instrução com setas e o aviso de que não há busca por telefone. A aba se chama "Worki ID" e usa ícone de telefone, o que promete telefone. O link, que é o caminho fácil, é a 3ª aba.
  - Correção: abrir em "Link" com o botão "Enviar no WhatsApp" e "Copiar link". QR em 2º. "Código do freela" em 3º, com ícone de chave. Nunca escrever "worker".
- **MÉDIO:** há três blocos antes da primeira pessoa (abas, "Adicionar Freela" e card de link), e os dois primeiros fazem o mesmo. Levar o link para dentro do modal e deixar a lista no topo.
- **MÉDIO:** o card de pessoa tem cerca de 245px; com 30 freelas fica inviável, e não há busca nem filtro por função. Usar linha de 72px (avatar, nome, "Garçom · 4 turnos com você · último 25/11"), com toque para o perfil, "Convidar" compacto e `...`. "4 turnos no total" e "4 com você" são redundantes.
- **ALTO: a lixeira fica colada em "compartilhar"** (8px), com o mesmo formato. É destrutivo sem rótulo, ao lado do polegar (`elenco__celular__dobra`). Mover "Remover do elenco" para o `...`. O ícone de compartilhar também precisa de rótulo ("Indicar a outra empresa", se for isso).
- **MÉDIO (desktop):** um CTA preto de 740px dentro do card. Usar linhas ou grade de 2 e 3 colunas, com botão no tamanho do conteúdo.
- **BAIXO:** "Garcom" sem acento (exibir o rótulo, não o slug). "Elenco", "Meu Elenco" e "Listas do elenco" com caixas diferentes. A aba e o H1 repetem o nome.
- **Manter:** o vazio de Listas, que explica o benefício (acrescentar o botão junto, no celular), e o histórico "com você".
- **Nova lista:** boa. A busca é desnecessária com 1 pessoa.

## 8. Indicações (`CompanyReferrals.tsx`)

- **MÉDIO:** há dois níveis de abas (Meu Elenco/Indicações e Recebidas/Enviadas) mais um CTA de largura total. Usar segmentado leve no 2º nível.
- **MÉDIO:** o vazio não explica como receber nem traz ação. Acrescentar uma frase e, em "Enviadas", "Indicar freela".
- **BAIXO:** "Empresa destino" deve ser "Para qual empresa". "Indicar" desabilitado não diz o que falta.
- **Manter:** a frase "Quem decide é sempre o freela".

## 9. Equipe e acessos (`CompanyTeamMembers.tsx`)

Imagens: `equipe__*`.

- **ALTO: o alerta "Gere um novo link do Elenco" domina a tela vazia.** Tem borda e sombra amarelas, CTA preto largo e fala de "alguém que saiu da equipe" quando não há ninguém na equipe. Há três CTAs pretos, e dois deles convidam. Um toque invalida o link já distribuído.
  - Correção: exibir só após uma remoção real, como aviso com botão `secondary` e confirmação. No vazio, manter um único CTA, o do card, e esconder o do header.
- **MÉDIO (modal):** "Encarregado" como cartão azul selecionável com uma só opção parece escolha. Mostrar como texto. O título está em `font-black` com fonte diferente dos outros modais. O foco verde é cor do worker; usar `ring-black` ou azul.
- **BAIXO:** "Convidar pessoa" e "Convidar alguém da equipe" devem ter o mesmo rótulo.
- **Manter:** a diferença entre Equipe e Elenco no subtítulo, e "sem criar senha".

## 10. Mensagens e conversa (`CompanyMessages.tsx`)

- **ALTO [código]: o chip mostra "cancelled" em inglês.** O `default: return status` (linha 404) também deixa passar `expired`, `pending` e `interview`. Cancelado cai no amarelo de atenção. Mapear todos, com "Cancelado" em cinza e fallback "Encerrado".
- **ALTO: há uma conversa por candidatura.** São 11 linhas "Worker E2E" com avatar genérico, sem última mensagem, hora ou não lidas. Não dá para achar nada. Agrupar por pessoa, ou ao menos mostrar prévia, hora e selo de não lidas, ordenar por última mensagem e mandar canceladas sem mensagem para "Arquivadas".
- **MÉDIO:** o título "FREELAS (11)" conta linhas, não freelas. Usar "Conversas", sem caixa-alta.
- **MÉDIO (celular):** o chat é um card com borda e sombra dentro da página, com cerca de 32px de margem perdida. Usar sangria total no celular (`max-md:border-0 max-md:shadow-none max-md:-mx-4`). O `HEAD` já esconde o título com a conversa aberta.
- **MÉDIO:** o status de "Contratado" usa verde e o de "Concluído" azul, enquanto em outras telas "Concluído" é cinza ou verde. Ver o padrão de status.
- **Manter:** o layout de duas colunas no desktop, o vazio "Selecione uma conversa" e o campo de envio embaixo.

## 11. Notificações (`pages/Notifications.tsx`)

- **MÉDIO:** os chips cortam "Status" e "Sistema" no celular sem pista de rolagem (`scrollbar-hide`, linha 88) **[código]**. Mostrar um chip parcial com fade ou reduzir para "Todas / Não lidas / Mensagens / Pagamentos".
- **ALTO: o feed não orienta ação.** "Vaga preenchida no turno" se repete 10 vezes **sem dizer qual turno, quem ou quando**. Todas usam o mesmo ícone amarelo de info, inclusive cancelamento e "ninguém aceitou". Incluir turno, data e pessoa; usar ícone e cor por tipo; agrupar repetidas. (O texto é gerado nos triggers e RPCs de notificação.)
- **MÉDIO:** "É a pessoa certa? Confirme em até 72 horas ou revogue" é um parágrafo de 8 linhas sem botões. Pôr "Confirmar" e "Não conheço" no item.
- **MÉDIO:** cada item é um card com borda preta e fundo azul. Usar uma lista com `divide-y` e a não lida marcada por ponto e peso.
- **BAIXO:** "Marcar todas como lidas" de largura total no topo compete com o conteúdo; virar link no header. O ponto verde é cor do worker.

## 12. Gestão (`CompanyGestao.tsx`)

- **BAIXO:** cards de cerca de 95px para itens de menu. Usar lista agrupada de linhas de 64px.
- **BAIXO (desktop):** a grade 2/1/1 deixa metade vazia. Limitar a `max-w-2xl`.
- **Manter:** agrupamento Pessoas / Empresa / Suporte, descrições curtas, chevrons e "Sair" separado no fim. É referência de clareza.

## 13. Dados da empresa (`CompanyProfile.tsx`)

- **MÉDIO:** a capa preta vazia, o logo placeholder e a pílula amarela "— | 0 avaliações" ocupam a dobra com vazios. Cada "—" vira "Adicionar setor / site / endereço", que abre a edição. Capa de `h-20` quando não há imagem. Mostrar um aviso de perfil incompleto com o que falta.
- **ALTO (`modal-editar`, na verdade edição inline):** no celular, "Salvar Alterações" e "Cancelar" ficam **no topo, antes dos campos**. Quem preenche termina embaixo, sem botão. Barra fixa no rodapé com Cancelar e Salvar.
- **MÉDIO:** "Segurança" e "Zona de Perigo" ficam atrás de "Configurações da Conta", um botão solto no fim. Criar item próprio "Conta" em Gestão.
- **MÉDIO:** "Meu Link de Elenco" duplica o Elenco. O toggle "Ligado" parece chip de status; usar switch. O texto jurídico de Preferências é longo e defensivo.
- **BAIXO:** "Contato & Endereço" e "Canais de comunicação": os subtítulos não acrescentam. Há caixa de título misturada ("Editar Perfil", "Briefing Padrão").
- **Excluir empresa:** manter a confirmação digitada, a lista de consequências e a zona separada. Botão "Excluir empresa" em uma linha; "pendentes bloqueiam" deve ser verificado antes de pedir a digitação.

## 14. Relatório de pagamentos (`CompanyOrdersReport.tsx`)

- **ALTO:** "garcom" e "atendente" aparecem como slug cru na tabela e nos cards. Mapear para o rótulo com acento.
- **ALTO (celular):** o card não mostra **o nome do turno**, e a função faz o papel de título. A linha "—" solta nas abertas não tem ação. Usar nome da pessoa (título), "Garçom · turno · data", valor à direita, e tocar leva ao turno. Aberta ganha "Registrar pagamento".
- **MÉDIO:** filtros e exportação ocupam a primeira dobra e vêm antes dos números. Ordem no celular: período em chips, depois "A pagar R$ 250" e "Pago R$ 400", depois a lista. Datas e status atrás de "Filtrar". Exportar e Imprimir num `...` ou no fim; "Exportar CSV" não deve ser o CTA dark da tela.
- **MÉDIO:** são 6 KPIs. "Aberta / Paga / Conciliada" não é explicado ("Conciliada" é jargão; usar "Confirmada pelo freela", se for esse o sentido). Fundir contagem e valor em 3 cards.
- **Manter:** a tabela desktop (valores à direita, status em chip). É o melhor uso de largura do app. Acrescentar linha clicável, coluna Turno e total no rodapé.

## 15. Relatório de operação (`CompanyOperationAnalytics.tsx`)

- **ALTO: "Custo por hora R$ 6.413,68/h" com gasto de R$ 400,00.** O denominador é ínfimo, vindo de marcações de teste. Exibido assim, destrói a confiança no relatório. `services/operationAnalyticsService.ts:790` divide sempre que `totalHours > 0` **[código]**. Definir um piso (por turno ou no total) e mostrar "—" com "horas insuficientes ou inconsistentes".
- **ALTO:** os cartões se contradizem: 6 contratações, "0h realizadas de 0h previstas", "4 sem estimativa · 0 sem marcação", ao lado de um custo por hora calculado.
- **MÉDIO:** são cerca de 2.900px no celular. Tabelas por freela cortam colunas ("Avaliação (global — todas as empresas)" estoura em `operacao__celular__full`). No celular, uma só lista por pessoa; blocos por freela em `<details>`.
- **MÉDIO:** há caixa-alta com tracking em todos os títulos, `font-black`, sombra em cada card e legendas cinza-claro. É a tela mais distante da escala refinada. O hero preto com sombra azul grita mais que o dinheiro.
- **BAIXO:** "Sem período anterior para comparar" repetido 4 vezes vira uma nota única. Trocar "chamado(s)" por plural real. "Não move saldo" é linguagem interna. "Motivo da quebra" com 74% "Outro" pede revisão das opções.
- **Manter:** barras com valor e percentual; a nota "não é ranking" uma única vez.

## 16. Perfil do freela (`WorkerPublicProfile.tsx`)

- **ALTO: não há "Convidar para turno".** A única ação é "Mensagem", e "+ Registrar" (treinamento) é o único botão dark. Primário "Convidar para turno" no cabeçalho, com WhatsApp ao lado.
- **MÉDIO:** contato e PIX, que são o dado operacional, ficam depois de Nível, XP e capa. Subir para logo abaixo do nome, com copiar e ligar. Remover XP e Nível na visão da empresa.
- **MÉDIO:** o histórico mostra turnos sem data. "Contratado" não diz se é futuro. "Especialidades" é um título sem conteúdo. "Já trabalhou com" apenas a própria empresa é redundante.
- **BAIXO:** caixas cinza dentro de card dentro de página; usar `divide-y`.

## 17. Perfil público da própria empresa (`pages/CompanyPublicProfile.tsx`)

- **MÉDIO:** para a dona, falta o contexto "É assim que o freela vê" e "Editar". A BottomNav marca "Elenco". A pílula "— (0)" deve ser "Sem avaliações".
- **Manter:** layout curto e claro.

## 18. Unidades (`Organization.tsx`)

- **ALTO: no celular o campo de e-mail colapsa** para cerca de 22px, com a borda esmagando o texto (`unidades__celular__dobra`). `flex flex-col sm:flex-row` com `flex-1` no input zera a base na coluna **[código, linhas 275-285]**. Usar `sm:flex-1` com `h-11 w-full`. Há também label a conferir: nenhum é visível.
- **MÉDIO:** "Gerentes" aqui (por e-mail) convive com "Equipe e acessos" (por link), dois fluxos de convidar gente. Explicar a diferença ou unificar.
- **BAIXO:** as métricas parecem botões; usar texto ou torná-las clicáveis.

## 19. Trilha (`BonusTrail.tsx`)

- **Manter:** o erro com explicação, garantia ("marcos continuam registrados") e "Tentar de novo". É o modelo de estado de erro.
- **BAIXO:** título em `font-black`, fora da escala. Falta `PageHeader`.

## 20. Onboarding (`CompanyOnboarding.tsx`)

- **Manter:** passo 1 de 2 com barra, 5 campos, 2 colunas no desktop. Há mudanças no `HEAD`; reconferir.
- **BAIXO:** no desktop, "Sair e voltar" flutua longe do contexto. Placeholder "Tech Solutions Ltda" deve ser um exemplo do setor. O placeholder de CNPJ/CPF fica cortado.

## 21. Admin (`pages/Admin.tsx`, interno)

- **BAIXO:** é o visual antigo (caixa-alta, inputs de borda cinza). O erro "Acesso negado" aparece com os campos vazios. Há mudanças no `HEAD`; baixa prioridade.

---

## Padrões transversais que devem virar regra do sistema

1. **Uma ação primária por tela e por card, definida pelo estado.** Função única `nextAction(turno)` usada em Início, Hoje, Turnos, Detalhe e Presença, com o mesmo rótulo e a mesma variante. O resto é `secondary` ou `ghost`. Listas não repetem botão preto de largura total.
2. **Dicionário único de status** (`lib/statusLabels` com `<StatusBadge>`). Rótulo, cor e ícone:
   - Sem freela: âmbar.
   - Aguardando resposta: azul.
   - Contratado ou Confirmado: verde.
   - Em andamento: preto.
   - A pagar: âmbar.
   - Concluído, Cancelado e Expirou: cinza.
   - Recusou: cinza.

   Proibido o fallback para o enum cru e proibido ter "Finalizado" e "Concluído" juntos.
3. **Glossário.** Turno (não vaga, exceto como posição), Freela (nunca worker ou candidato), Chamar (convite de turno), Adicionar ao elenco, Convidar para a equipe, Registrar chegada e saída, Perguntar se vem, Cancelar turno. Banir "atrelar", "Freelance", "Lvl" e "Worki ID do worker". Funções sempre pelo rótulo ("Garçom").
4. **Caixa de frase** em títulos e botões ("Adicionar freela", "Chamar freelas", "Presença e pagamento"). Sem caixa-alta com tracking e sem `font-black` fora do número principal. Há duas fontes ou pesos de título convivendo (Hoje, Equipe, Trilha, Relatório).
5. **Três níveis de superfície.** (a) Card com borda preta: objeto acionável ou bloco principal. (b) Lista interna com `divide-y`, sem borda por item. (c) Texto. Proibido card dentro de card. Sombra offset só em elemento clicável, modal e menu; nunca em card informativo nem em opção não selecionada.
6. **Densidade de lista no celular:** de 72 a 96px por linha, com pelo menos 5 itens na dobra. Linha inteira clicável com chevron. Não aninhar botões em card clicável.
7. **Posições fixas.** Primária de formulário ou fluxo em barra no rodapé (acima da safe area). Secundárias no `...` no canto superior direito do card. Destrutiva sempre separada (fim do menu ou após `border-t`), em vermelho, nunca encostada em outra ação.
8. **Diálogo destrutivo:** o título é a pergunta com o objeto, o corpo traz a consequência, e os botões são "Voltar" e o verbo exato. Nunca usar "Cancelar" para fechar num fluxo de cancelamento.
9. **Camadas:** menus em folha inferior ou top layer. O FAB nunca cobre CTA nem menu.
10. **Ação antes de histórico, filtro ou métrica.** Histórico e encerrados recolhidos. KPIs em faixa compacta e clicável.
11. **Dado ausente não ocupa espaço.** Ou some, ou vira "Adicionar X". Quando o dado ausente bloqueia a tarefa (PIX), vira aviso com saída. Métrica implausível vira "—" com o motivo.
12. **Estados:** todo vazio tem uma frase que explica e uma ação. Todo botão desabilitado tem o motivo visível em texto. A copy só afirma o que a tela mostra ("pré-preenchido", "quem responde").
13. **Desktop:** em `lg`, listas viram linhas com colunas fixas, detalhe usa 2/3 e 1/3, formulário usa `max-w-3xl`. Botão tem a largura do conteúdo, nunca 700px.
14. **Cor por papel:** nada de verde como cor estrutural na empresa (ativo da Sidebar, sombra do FAB, foco, ponto de não lida). Verde significa apenas "ok ou confirmado".
15. **Formatação:** sempre `R$ 100,00`; datas "Sex., 27/11 · 10:00–14:00" por uma só função; plural real no lugar de "(s)"; sem travessão na copy.

## Ordem sugerida de ataque

1. Defeitos pontuais e baratos: menu e z-index, FAB cobrindo, "cancelled", slugs de função, input de Unidades, stepper, textos de presença e PIX ausente, custo por hora.
2. Regras 1 e 2 (`nextAction` e `StatusBadge`) aplicadas em Hoje, Turnos, Detalhe e Presença.
3. Reordenar Presença e Pagamento e o Início.
4. Densidade de listas (Elenco, Mensagens, Notificações) e relatórios.
