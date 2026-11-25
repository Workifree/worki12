# Crítica de design: freela e telas públicas

**Base:** 130 capturas (79 de freela, 51 deslogado) em 390px, desktop e 320 quando havia, vistas em pranchas.
Imagens em `...\scratchpad\telas\shots\`.

**Fora do escopo:** o que as correções posteriores já tratam (modais, toasts, validação, altura do chat, contraste básico, alvos, texto mínimo). Onboarding e estados simulados ficam com o outro avaliador. A captura `freela__onboarding-freela` mostra o Início, não o onboarding, e não foi avaliada.

**Código:** só foi consultado por trechos, para confirmar causas. Nada foi editado nem executado no app. Os itens marcados **[código]** foram confirmados por leitura. Os demais "arquivo provável" são inferidos.

**Severidade:** S1 bloqueia a tarefa ou quebra a confiança (dinheiro, convite, presença). S2 é atrito relevante. S3 é acabamento. Caminhos relativos a `frontend/src/`.

## O que está bom (manter)

- **Início:** o cartão "Pagamento para confirmar" vem em primeiro lugar, com valor grande, uma frase e um CTA de largura total ao alcance do polegar. É a melhor tela e deve servir de modelo.
- **Navegação:** BottomNav de 5 itens, com ícone, rótulo e marcador ativo, sem quebra em 320.
- **Escala refinada:** botões em caixa normal, sombra de 3px e cantos consistentes. A identidade se mantém sem gritar.
- **Convite (código):** Aceitar e Recusar `lg`, recusa em dois toques, "Recusar não afeta sua reputação", aviso de disputa e de expiração. Não há captura com convite pendente.
- **Honestidade sobre dinheiro:** Recebimentos e recibo dizem que o pagamento foi por fora e que o recibo não é documento fiscal.
- **Confirmações** de cancelar turno e sair da empresa: pergunta clara, consequência, "Voltar" e ação vermelha.
- **QR de identidade:** QR grande, explicação curta e duas cópias hierarquizadas.
- **Link de convite de equipe inválido:** causa provável, próximo passo e um único botão.
- **Rodapé de edição do perfil no celular:** Cancelar e Salvar fixos.
- **Termos e Regulamento:** legíveis. A tabela de marcos do regulamento é exemplar.

## Freela

### 1. Meus Turnos: presença sem caminho visível (S1)
`freela__turnos-aba-agendados__celular__full`, `freela__turnos-aba-em-andamento__celular__dobra`, `freela__inicio__celular__full`. Arquivo: `pages/MyJobs.tsx`.

- Há um turno **hoje** (25/11 18:00) e ele aparece em "Agendados" só com "Falar com a empresa" e "Cancelar turno". Nada diz como nem quando registrar a chegada.
- **[código]** O botão "Check-in" só existe em "Em Andamento" (linhas 434-459). O turno entra ali entre 30 min antes do início e 1h depois do fim.
- **[código]** A função `checkinOpensAt` documenta que o banco aceita a chegada a partir de **12h antes**. Tela e banco discordam: quem chega 45 min cedo não acha o botão.
- **[código]** Sem `end_time`, o turno hired nunca vira "em andamento" pela janela, e o botão não aparece.
- **[código]** A janela é montada sobre a data de hoje. Um turno que cruza a meia-noite deixa de ser "de hoje" depois das 00:00. Vale testar.
- O vazio de "Em Andamento" ("Trabalhos agendados para hoje aparecerão aqui durante o horário de trabalho") não diz o horário e não tem ação.

**Correção:** mostrar o turno do dia como cartão "Hoje" fixo acima das abas e no Início. Ele traz horário, local com mapa e o CTA `lg` "Registrar chegada", usando a mesma janela do banco. Antes da janela, o texto é "Chegada liberada a partir de 25/11 às 06:00" (ou a regra de produto escolhida, uma só). Trocar "Check-in/Check-out" por "Registrar chegada/saída", como no stepper.

### 2. Meus Turnos: aba inicial, ordem e abas (S1/S2)
`freela__turnos__celular__dobra`, `...aba-agendados__celular__full`. Arquivo: `pages/MyJobs.tsx`.

- **S1 [código]** A aba inicial é sempre `invites` (linha 259). Quem toca em "Turnos" vê "Nenhum convite pendente" mesmo com turno hoje. Escolher a aba pela prioridade: em andamento, convites, agendados.
- **S2 [código]** A busca ordena por `created_at desc`. "Agendados" mostra 27/11 antes de 25/11. Ordenar pela data do turno, crescente. No Histórico, decrescente pela data.
- **S2** As abas em grade 2x2 parecem duas barras diferentes. O sublinhado de "Convites" fica no meio do bloco. Usar uma linha: "Convites · Hoje · Próximos · Histórico", com contadores, ou segmentado rolável. Os rótulos curtos cabem em 320.

### 3. Agendados: cartão (S2)
`...aba-agendados__celular__full` e `__320__full`.

- Um cartão ocupa quase a tela toda e repete a data (bloco preto e chip). "Contratado" é redundante dentro de "Agendados".
- Falta o horário de término e o nome da empresa, que é a informação principal para quem trabalha com várias.
- "Local a definir" não tem próximo passo.
- "Cancelar turno", em vermelho, ocupa o ponto mais fácil do polegar, com o mesmo peso espacial da ação útil.
- "Ver Detalhes" no Início não tem equivalente de detalhe aqui.

**Correção:** título, empresa, "qui 27/11 · 10:00–18:00", local com "Abrir no mapa" e valor na mesma linha. "Falar" como secundário. "Cancelar" dentro do detalhe ou como link discreto.

### 4. Histórico (S2)
`...aba-historico__celular__full`, `__320__full`.

- **Título cortado:** em 320 vira "ZZ-TESTE equip..." e todos ficam iguais. Permitir `line-clamp-2` e pôr o valor na linha de baixo.
- **Cancelados:** 5 dos 9 itens são cancelados, com o mesmo peso e o valor em preto, como se houvesse dinheiro. Esconder atrás de um filtro, ou compactar com valor riscado ou cinza.
- **"Saída confirmada":** não diz o que falta (o fechamento e o pagamento). Usar "Aguardando fechamento da empresa" com uma linha de apoio.
- **"Concluído":** o cartão não diz se foi pago nem se falta confirmar. O pendente de R$ 80 parece igual ao resolvido. Mostrar "Confirmar recebimento" como CTA nesse cartão.
- **Hierarquia dos botões:** "Avaliar" é verde cheio e repetido em todos, e compete com o dinheiro. Passar para secundário.
- **Aparência:** o cartão cinza com borda cinza parece desabilitado, mas é clicável. Adicionar um chevron.

### 5. Detalhe do turno e avaliação (S2/S3)
`freela__turnos__celular__modal-detalhe-historico`, `...modal-avaliar-empresa`.

- **S2:** o detalhe é um beco sem saída, sem Recibo, Falar ou Avaliar. Pôr no rodapé a ação do estado.
- **S2:** chegada e saída às 00:56 para um turno 01:10–04:50 aparecem sem qualquer nota. Mostrar o total de horas e sinalizar "fora do horário combinado", com caminho para contestar.
- **S3:** o modal de cancelar diz que "o turno volta a ficar disponível", linguagem de marketplace. Trocar por "A empresa será avisada e poderá chamar outra pessoa". Informar também o efeito na reputação.
- **S3:** avaliação está boa. O rótulo do botão desabilitado ensina o próximo passo.

### 6. Recibo: o momento do dinheiro (S1)
`freela__recibo__celular__full`. Arquivos: `pages/ReceiptView.tsx`, `components/ServiceTermSection.tsx`.

- **S1: não existe "Não recebi" nem "Valor errado".** **[código]** A busca por contestação não achou nada. A única saída é confirmar ou ignorar. Adicionar um secundário "Não recebi / há um erro", que abra o chat com texto pronto. Um estado formal de contestação exige spec própria.
- **S1: "Confirmar recebimento" no Início não confirma.** Ele leva a uma página de cerca de 2.000px, com a ação no fim. São cinco passos: rolar, abrir o termo, ler, marcar a caixa e tocar. Pôr no topo o bloco "Você recebeu R$ 80,00 em dinheiro de X?" com CTA fixo no rodapé que leve ao termo, e depois checkbox e botão juntos.
- **S2: dois requisitos, uma instrução.** O texto cita só "Ler o termo inteiro", mas há também a checkbox. A caixa é pequena e parece desabilitada. A caixa de prévia corta uma linha ao meio. Abrir o termo em folha de tela cheia com "Li e concordo" no rodapé.
- **S2: confirmação presa ao termo.** O rótulo "Aceitar termo e confirmar recebimento" junta o aceite jurídico à confirmação. A ADR prevê um gesto só, então a tela precisa explicar por que há termo, em linguagem comum e antes dele.
- **S2: confiança.** "Total de horas trabalhadas 0min", "CPF/CNPJ: não informado" e "Modelo modelo-worki-v1" enfraquecem o documento. Com menos de 1 min, mostrar "horário não registrado corretamente". Ocultar o id do modelo. Avisar sobre o CNPJ ausente fora do corpo do termo.
- **S3:** duas caixas amarelas de aviso legal competem com a ação; virar texto cinza. "Imprimir" no celular deveria ser "Salvar / compartilhar". Falta o nome do Worki como registrador perto do número do registro; o resto da moldura está bom.

### 7. Recebimentos (S2)
`freela__recebimentos__celular__full`. Arquivo: `pages/MeusRecebimentos.tsx`.

- Três cartões de estatística empilhados, um deles de R$ 0,00, empurram "Confirme o recebimento" para o meio da tela. Colocar o pendente primeiro. Resumir em uma faixa: "R$ 400 recebidos · 1 a confirmar", e mostrar "Agendado" só se for maior que zero.
- O cartão pendente não tem botão, só uma pílula que parece botão. Usar CTA de largura total, como no Início.
- "Agendado (promessa)" soa como desconfiança. Usar "Previsto".
- Falta a data do turno em cada item, e não há agrupamento por mês.
- "Total recebido R$ 400" não deixa claro se inclui o valor pendente. Rotular "Confirmado".

### 8. Início (S1/S2)
`freela__inicio__celular__full`. Arquivo: `pages/Dashboard.tsx`.

- **S1: falta a chave PIX no checklist.** O perfil mostra "Chave PIX: Não informada" e "Telefone: Não informado". **[código]** `Dashboard.tsx` não referencia `pix_key`. "Complete seu perfil" pede foto em troca de XP e não pede o dado que faz o freela receber. Criar um alerta no topo, "Cadastre sua chave PIX para as empresas te pagarem", acima da disponibilidade e da foto.
- **S2:** o turno de hoje diz "Agendado" e oferece "Ver Detalhes". Deve dizer "Hoje às 18:00" e mostrar a ação de presença (item 1).
- **S2:** são seis blocos com o mesmo peso. "Minhas Empresas" (o número 1) duplica a BottomNav, e "Nível" é um cartão inteiro. Fundir Ganhos, Nível e nota em uma faixa.
- **S3:** "Pronto para faturar hoje?" é genérico. Usar o contexto: "Você tem 1 turno hoje". "Sua nota: —" deve ser "Ainda sem avaliações". A caixa dentro de caixa em "Complete seu perfil" sobra.
- **S3:** "Histórico recente" tem três títulos truncados em 320 e dois cancelados entre três itens.

### 9. Perfil (S1/S2)
`freela__perfil__celular__full`, `...modal-editar`. Arquivo: `pages/Profile.tsx`.

- **S1:** o texto do CPF manda "fale com o suporte", e **não há canal de suporte** no app (ver item 18).
- **S2:** a página tem cerca de 3.800px e 12 blocos. O primeiro é "Me adicionar a uma empresa", antes da identidade. PIX e telefone ausentes ficam na segunda dobra, em cinza, sem alerta. Ordem sugerida: identidade, pendências (PIX e telefone), compartilhar, dados, disponibilidade. Certificações, preferências e selos vão para subpáginas em lista.
- **S2:** "REGIME N/A", "ESPECIALIDADES" vazio e "Este profissional ainda não..." (terceira pessoa para o dono). Ocultar os vazios ou oferecer "Adicionar".
- **S2:** há três padrões de liga/desliga: o botão verde "Ativado" (parece ação), um toggle com dupla negativa ("Não exibir onde já trabalhei", desligado) e um bloco tracejado bloqueado. Usar um só `Switch` com rótulo positivo, "Mostrar onde já trabalhei".
- **S3:** "0h" com 4 turnos e "★ -" parecem erro. Há rótulos em caixa-alta cinza que não existem em outras telas. A "chave-mestra" é jargão.
- **S3:** na edição desktop, Cancelar e Salvar ficam no cartão do topo, longe do fim do formulário, e o subtítulo diz "salve no fim". Usar barra fixa também no desktop.

### 10. Minhas empresas e Quem te indicou (S2)
`freela__empresas__celular__dobra`, `freela__quem-te-indicou__celular__dobra`. Arquivos: `pages/CarteiraClientes.tsx`, `pages/QuemTeIndicou.tsx`, `components/SectionTabs.tsx`.

- O cartão da empresa tem só dois ícones sem rótulo, compartilhar e **sair**. A ação destrutiva fica exposta e parece "logout". Não há "Falar" nem indicação de que o cartão abre o perfil.
- **Correção:** cartão com chevron, dado útil (próximo turno, turnos feitos) e botão "Falar". "Sair da empresa" vai para um menu ou para o perfil dela.
- Compartilhar não diz o que compartilha.
- "Copiar meu link" não explica para que serve nesta tela.
- O modal de sair deve nomear a empresa e dizer o que acontece com turnos e recibos. O botão vira "Sair da empresa".
- As abas verdes em pasta daqui não se parecem com as de Turnos nem com os chips de Notificações. O título repete a aba.
- O vazio de indicações pode oferecer "Ver preferências de indicação".

### 11. Mensagens e conversa (S2)
`freela__mensagens__celular__dobra`, `freela__conversa__celular__dobra`, `__320__`. Arquivo: `pages/Messages.tsx`.

- São 11 linhas "Restaurante E2E", uma por turno, a maioria cancelada. Não há prévia, hora nem indicador de não lida. Ordenar pela última mensagem, ocultar conversas vazias de turnos encerrados (ou agrupar por empresa) e mostrar prévia, hora e contador.
- O selo "Concluído" é azul aqui e verde no Histórico. "Cancelado" tem o maior peso visual.
- Na conversa aberta, o título "Mensagens", o subtítulo e a moldura gastam cerca de 190px. No celular a conversa deve ser tela cheia, sem cartão e, idealmente, sem BottomNav, com cabeçalho de uma linha que abra o turno.
- No 320, o placeholder é cortado.

### 12. Notificações (S2)
`freela__notificacoes__celular__full`. Arquivo: `pages/Notifications.tsx`.

- Convite, cancelamento e chamado cancelado têm o mesmo ícone "i" amarelo. Só o pagamento se distingue. Dar ícone e cor por tipo.
- "Novo convite de turno" repete o mesmo texto, sem empresa, data ou valor, mesmo para convite já cancelado. Incluir os três dados e marcar "Expirado".
- Todos os itens são azulados com ponto, e com isso o não lido deixa de informar. Agrupar por dia e juntar o par convite/cancelamento.
- Cada item é um cartão de borda preta sem indicação de toque. Virar lista com divisores.
- Os textos "Chamado cancelado" se contradizem ("cancelou o turno deste chamado" e "cancelou o chamado deste turno"). "Chamado" é jargão.
- No celular aparecem só 3 filtros (o desktop tem 5). Conferir se há rolagem sem indicação. Trocar a paginação por "Carregar mais". "Marcar todas como lidas" não deve ser o maior botão da tela.

### 13. Perfil público da empresa (S2)
`freela__perfil-publico-empresa__celular__full`. Arquivo: `pages/CompanyPublicProfile.tsx`.

- Esta é a tela de confiança antes do aceite, e ela quase só mostra vazios: capa preta, logo genérico, "★ — (0)" em amarelo e nenhum fato.
- Mostrar o que existir (cidade, setor, endereço, desde quando está no app, turnos juntos). Reduzir a capa quando não há imagem. Trocar a nota por "Sem avaliações ainda".
- Se o freela veio de um convite, oferecer "Voltar ao convite" como ação primária.

## Públicas

### 14. Links de convite de elenco e de gestor deslogado (S1)
`deslogado__convite-token-falso__celular__dobra`, `deslogado__convite-gerente-token-falso__celular__dobra`. Arquivos: `pages/InviteAccept.tsx`, `pages/Login.tsx`, `pages/AcceptManagerInvite.tsx`.

- Quem toca no link vê o login genérico, "Começar a Trabalhar / Ganhe dinheiro no seu próprio horário". Não há menção a convite nem a empresa.
- O foco é "Entrar", embora um convidado novo precise **criar conta** (um link sublinhado no rodapé).
- **[código]** No elenco, `InviteAccept` redireciona para `/login?redirect=...`. A validade só é checada depois do cadastro, então um link morto custa um cadastro inteiro.

**Correção:** quando o `redirect` for de convite, mostrar a faixa "Você recebeu um convite para um elenco. Crie sua conta para aceitar", abrir no cadastro e usar a copy de convite. O nome da empresa antes do login exige prévia pública, como a do convite de equipe, e passa por revisão de segurança.

### 15. Login e cadastro (S1 em 320, S2 no resto)
`deslogado__login*__320__dobra`, `deslogado__cadastro-*`. Arquivo: `pages/Login.tsx`.

- **S1 [código]** "Voltar" é `absolute top-4 left-4` sobre um cartão centralizado. Em 320x640 ele **cobre o título** nas três telas de login e encosta no cartão no cadastro. Colocar no fluxo (barra superior `self-start`) e usar `ghost`.
- **S2:** `/login` assume freela sem seletor. Uma empresa que cai ali não tem como trocar. Adicionar "Sou freela / Sou empresa".
- **S2:** o cadastro diz "Criar Conta" sem o papel; só a cor indica. Usar "Criar conta de freela". Falta a regra da senha visível antes de digitar, o "mostrar senha" (a redefinição tem) e a linha de aceite dos Termos.
- **S3:** os pontos como placeholder parecem senha preenchida. "Voltar", com borda e sombra, compete com o CTA. "Ganhe dinheiro no seu próprio horário" promete um marketplace que o produto não é; usar "Seus turnos, presença e recibos".
- **S3:** no login de empresa o botão preto não tem a mesma sombra offset do verde e parece outro componente.

### 16. Esqueci e redefinir senha (S2/S3)
`deslogado__esqueci-senha__*`, `deslogado__redefinir-senha__*`.

- "Voltar" fica dentro do cartão (no login fica fora), o alinhamento é à esquerda (no login é central) e o cartão não tem sombra. Criar um `AuthShell` único.
- Redefinir aberta sem token válido mostra o formulário normalmente. Mostrar "Este link expirou" com "Pedir novo link".

### 17. Landing e Sobre (S2)
`deslogado__raiz__celular__full`, `deslogado__sobre__celular__full`. Arquivo: `pages/LandingPage.tsx`.

- `/` e `/sobre` têm cabeçalhos, logos ("Worki." com estrela e "Worki") e CTAs diferentes, embora `App.tsx` aponte `/sobre` para `LandingPage`. A origem da diferença não foi verificada. Unificar.
- Há quatro nomes para o freela: "Trabalhador", "Profissional", "freelancer" e "freela". Usar "freela". "Login" vira "Entrar". Em Sobre falta "Entrar".
- Na home, o freela decide por cartões sem seta nem botão, que não parecem clicáveis. O primeiro CTA explícito está no fim. O letreiro corta o texto e empurra os cartões. Remover o letreiro e dar a cada cartão um CTA verde ou preto.
- "Agora com contrato", "Sem calote" e "Sem vínculo" prometem o que o produto não garante: os Termos dizem que o Worki não garante pagamento. Reescrever como "registro e comprovante". Passar pelo jurídico.
- A ordem em Sobre é empresa primeiro, e a ação de freela é a secundária.

### 18. Ajuda (S1)
`deslogado__ajuda__celular__full`. Arquivos: `pages/Help.tsx`, `pages/Privacy.tsx`, `pages/Terms.tsx`.

- **Não há como falar com ninguém.** Perfil (CPF) e Regulamento mandam falar com o suporte ou pela Ajuda. Termos e Privacidade dizem que o canal "será publicado nesta página". Publicar WhatsApp ou e-mail no topo e no fim, antes do piloto. É também requisito de LGPD a validar.
- O FAQ é escrito para a empresa ("Como monto meu elenco"), e o freela vem em terceira pessoa. Separar "Sou freela" e "Sou empresa". Incluir "Como registro minha chegada?", "Não recebi" e "Como cadastro o PIX?". Usar acordeão e os nomes reais do menu.

### 19. Termos, Privacidade e Regulamento (S3)
- Paredes de texto de 4.300 a 6.000px sem sumário. Adicionar resumo em linguagem simples e índice com âncoras. Tirar a moldura de cartão do texto longo para ganhar largura.
- A Privacidade expõe termos técnicos (RLS, JWT) e cita e-mails transacionais, que a arquitetura registrada diz não existirem. Revisar o conteúdo.
- O fundo frio difere do off-white do resto, e o regulamento usa outra família ou peso nos títulos.

### 20. 404 e link de equipe inválido (S3)
`deslogado__404__celular__dobra`, `deslogado__convite-equipe-token-falso__celular__dobra`.

- Estão claros. No 404, o "Voltar" de quem chegou por link externo pode não ter para onde ir; usar "Ir para o início".
- Há CTA preto (cor de empresa) em telas neutras. "Gestor" supõe que a pessoa sabe o papel: usar "a quem te enviou o convite".

### Desktop (S3)
- A estrutura com Sidebar é boa e consistente. O título muda de posição entre páginas (Notificações, Perfil e Quem te indicou usam colunas e topos diferentes de Turnos). Fixar um contêiner único.
- "Sair" em vermelho fica permanente na Sidebar, acima de "Ajuda".
- Em Empresas e Quem te indicou as abas vêm acima do H1; em Turnos, abaixo.

## Padrões transversais

1. **A tela é organizada por entidade, não por "o que faço agora".** Presença, PIX ausente e confirmação ficam escondidos em aba, perfil ou fim de página. Definir uma fila de pendências no Início, nesta ordem: presença de hoje, convite, PIX, recebimento.
2. **Dinheiro e confiança sem saída de erro.** Não há "não recebi", "horário errado" nem suporte, e há dados zerados ou "não informado" em documento.
3. **Perda de contexto no meio do caminho.** O convite vira login genérico, o CTA do Início vira página longa e o detalhe não tem ação.
4. **Caixa em tudo.** Borda preta em cartão, item de lista, estatística e subcaixa achata a hierarquia. Reservar borda e sombra para o acionável ou urgente. Usar divisores em listas e no máximo um nível de caixa.
5. **Três ou quatro componentes para a mesma coisa.** Abas (sublinhado 2x2, pasta verde, chips pretos), Voltar (botão com sombra fora, dentro, texto solto, preto no 404), liga/desliga (três) e cabeçalho público (dois). Criar `Tabs`, `BackLink`, `Switch`, `AuthShell` e `PublicHeader`.
6. **Cor sem significado fixo.** Verde é CTA, status, valor, aba e sombra decorativa. "Concluído" é azul no chat e verde no Histórico. Amarelo serve para aviso legal, urgência, nota e info. Vermelho de "Cancelado" domina as listas. Criar um `StatusBadge` único: cinza para encerrado ou cancelado, amarelo para aguardando, verde para pago ou confirmado.
7. **Ruído de histórico.** Cancelados dominam Histórico, Início, Mensagens e Notificações.
8. **Vocabulário.** Check-in ou chegada; chamado, convite ou turno; trabalhador, profissional ou freela; "Worker" nos textos legais.
9. **Vazios e valores nulos.** "—", "-", "N/A", "0h" e "(0)". Os vazios bem escritos não oferecem ação. Regra: ocultar o nulo ou convidar a preencher.
10. **Aparelho simples e 320px.** Abas, cartões altos, três estatísticas empilhadas e títulos truncados gastam a dobra. Testar toda tela em 320x640.

## Os 10 piores, em ordem

1. Check-in invisível, com janela diferente da regra do banco (item 1).
2. Recibo sem "Não recebi" (6).
3. Nenhum canal de suporte, embora o app mande falar com ele (18).
4. Links de convite viram login genérico (14).
5. PIX ausente sem alerta no Início (8).
6. "Confirmar recebimento" leva a cinco passos no fim da página (6).
7. "Voltar" cobre o título em 320 (15).
8. Turnos abre sempre em Convites, e Agendados vem fora de ordem (2).
9. Mensagens e Notificações são listas indistinguíveis (11, 12).
10. Perfil gigante, com o crítico enterrado e três tipos de toggle (9).

**A verificar no app real:** o estado de presença com o turno dentro da janela, o convite pendente, a redefinição com link válido e o efeito das correções posteriores sobre os botões desabilitados.
