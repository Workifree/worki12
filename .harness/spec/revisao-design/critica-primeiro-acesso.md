# Crítica de design: primeira vez e regras especiais

Data: 25/11/2026. Base: galeria simulada (principalmente 390px; amostra de telas críticas em 320px e 1440px) e leitura pontual de código nos pontos graves. Nenhum código foi editado. Não houve teste no app real.

Marcas: **[código]** conferido no fonte; **[imagem]** visto só na galeria; **[verificar]** pode ser efeito do dado simulado.
Gravidade: **P0** engana sobre dinheiro, consentimento ou acesso, ou trava a pessoa. **P1** gera abandono ou erro provável. **P2** acabamento.

## Veredito

A identidade neo-brutalista está consistente e boa. Quase toda tela tem um botão principal grande e claro. Os melhores momentos são o convite de equipe por código, o "É a pessoa certa?" do Gestor (pede o nome digitado), o aviso "NÃO PAGUE" no Admin, o comprovante de agendamento ("é uma promessa") e a recusa em dois toques.

O problema está nas bordas: a pessoa chega por um link e perde o contexto, falha de carga vira "zero", e vários erros explicam o que houve sem oferecer o próximo passo.

## P0

1. **Convite de Elenco é aceito sem consentimento. [código]** `InviteAccept.tsx` chama `addToTeamByToken` ou `addWorkerToTeamByToken` no `useEffect`, assim que a página abre. Não há botão "Aceitar" nem "Agora não". As telas de carga e sucesso não dizem qual empresa é ("elenco da empresa") nem qual freela é ("o freela do link"). Estar no elenco libera dados pessoais. Proposta: prévia com nome e logo, "o que a empresa passa a ver", `Entrar no elenco` e `Agora não`.
2. **Falha de consulta vira dado falso. [imagem, cenários DEFEITO]**
   - `empresa-painel-inicio-erro`: esqueleto para sempre e "Bem-vindo de volta, Empresa".
   - `inicio-erro-turnos`: "Turnos ativos 0" e "Total 0" ao lado de "Em andamento 2".
   - `relatorio-erro`: "R$ 0,00" e "Nenhum pagamento no período". É o pior caso, porque o financeiro pode concluir que nada foi pago.
   - `operacao-erro` tem um bom aviso, mas mantém abaixo cartões "Nenhum pagamento registrado", que o contradizem.
   - Proposta: se a carga falhar, usar `ErroDeCarga` no lugar dos números. Nunca mostrar 0 como substituto.
3. **Valor nulo vira "R$ 0,00" confirmável. [imagem; verificar se o banco permite nulo]** Em `nulos-recibo` aparece "Valor pago R$ 0,00" com o fluxo de aceite ativo, e o termo ao lado diz R$ 160,00. `nulos-inicio-freela` pede "Confirme que recebeu" R$ 0,00. A confirmação não pode ser desfeita. Proposta: mostrar "Valor não informado" e bloquear a confirmação.
4. **Turno finalizado com pagamento registrado não tem "Estornar". [código]** O bloco `app.status === 'completed'` de `CompanyJobCandidates.tsx` (perto da linha 1787) mostra só `Ver Recibo`. `renderCompletionAction` tem o botão, e o agendado também. Como registrar o pagamento conclui o turno, quem digita o valor errado fica sem saída nesta tela.
5. **Menu do turno fica coberto no celular. [imagem, DEFEITO]** Em `menu-coberto`, o menu abre atrás de "Criar turno" e da barra inferior, a página não rola e "Excluir" fica inalcançável. Proposta: folha inferior acima da barra, ou abrir para cima.
6. **Gerente revogado, sem marca local, cai no cadastro de empresa nova. [imagem; verificar com conta real]** `gerente-revogado-sem-marca` mostra "Primeiro acesso, Sobre a empresa". A pessoa pode criar uma empresa fantasma achando que está recuperando o acesso. Proposta: tela de acesso encerrado, ou ao menos a pergunta "Você fazia parte de uma equipe?".

## P1 por fluxo

Cada bloco resume: o que fazer agora, passos, saída no erro e confiança.

### Escolha de papel, cadastro, login e senha
Caminho do freela: escolha, login, "Cadastre-se", confirmar e-mail e onboarding em 3 passos.
- No celular, os cartões "Quero trabalhar" e "Quero contratar" não têm seta nem verbo de botão e parecem texto. O CTA do topo é só "Login". Acrescentar "Criar conta" dentro de cada cartão.
- "Criar Conta" não diz se a conta é de freela ou empresa; só a cor muda, e o erro de papel é caro. Usar "Criar conta de empresa" e um link para trocar.
- Quem chega por convite de Elenco ou de gerente vê o login genérico ("Contratar Talentos" ou "Começar a Trabalhar"), sem menção ao convite. O redirecionamento existe **[código]**, mas a pessoa não sabe disso. Colocar a faixa "Entre para responder ao convite de X".
- "Conta criada! Verifique seu email" mantém o formulário e o botão `Criar Conta`, o que convida a repetir. Trocar por uma tela própria com "Reenviar e-mail" e "Trocar e-mail". "E-mail não confirmado" também não oferece reenvio.
- Link de senha expirado: o texto pede um novo link, mas o único botão é "Redefinir Senha". Falta `Pedir novo link`. `/redefinir-senha` sem sessão mostra o formulário normal (`extras-redefinir-senha-sem-sessao`).
- Papel errado: o botão "Voltar" cobre o título em 390 e 320.
- Faltam acentos em "Sua sessao expirou. Faca login" e "voce recebera".
- P2: "dashboard de freelancer" deve virar "área do freela". Padronizar freela/freelancer/worker e E-mail/Email.

### Onboarding
A barra "Passo x de y" e a caixa "Falta preencher" são boas.
- `Próximo` e `Finalizar` parecem ativos com o formulário vazio. A empresa, no passo 1 vazio, não mostra o que falta; só o passo 2 mostra. Padronizar a lista de pendências e, ao tocar, rolar até o primeiro campo.
- PIX inválida do freela: só a caixa cinza no rodapé avisa e o campo não fica vermelho, diferente do CNPJ e do CPF da empresa. Quando o tipo é CPF, oferecer "usar meu CPF".
- "O que você procura" não tem asterisco, e a empresa tem pergunta equivalente também sem marca. Dizer se é opcional; se não for usada, remover. "Objetivos" não descreve a disponibilidade.
- CPF, nascimento e PIX são pedidos sem dizer quem vê. Uma linha ("só empresas do seu elenco veem") aumenta a confiança.
- Erro ao salvar: um aviso flutuante cobre o topo, longe de `Finalizar`. Mostrar erro fixo junto ao botão e dizer que os dados continuam na tela.
- "Sair e voltar" em dois toques é bom. O texto armado do freela é longo e quase encosta nas bordas já em 390.
- Em 320, os cartões "1-5, 6-20, 20+" encostam na borda do cartão.

### Termos
- O modal diz "Termos Atualizados" **[verificar se também aparece no primeiro aceite]**. Não diz o que mudou e não tem "Sair". Quem não concorda fica preso.
- O texto cita a Privacidade sem link; só os Termos têm link.
- Os Termos dizem "Worker" e "Contratante" e citam publicação de vagas. Alinhar com o produto atual e acrescentar um resumo de 3 linhas.
- No onboarding, o link de Privacidade quebra em outra linha e parece um segundo item.

### Convites de Elenco e de gerente
- Papel errado mostra "para testar, abra em uma janela anônima". É texto de desenvolvedor.
- "O freela do link entrou (pendente de aceite dele)" se contradiz. Usar "Convite enviado. Falta o freela aceitar".
- "Já está no seu elenco" deve distinguir pendente de aceito.
- "Ver Meus Turnos" após entrar no elenco tende a abrir uma lista vazia. Levar à empresa e dizer "você será avisado quando houver convite".
- Gerente: em link usado, cancelado ou expirado, o único botão é "Voltar ao Login", para quem já está logado. Em "Conta incompatível", avisar que a conta atual será desconectada e que é preciso outro e-mail.
- Sem conexão no Elenco: só há "Tentar de novo". O gerente tem também "Sair".

### Convite de equipe
É o melhor fluxo: o título diz quem convidou e para quê, e não pede senha. São 5 gestos (e-mail com Termos, pedir código, digitar, entrar, aguardar).
- A tela do código só tem "Trocar e-mail ou pedir novo código". Separar as duas ações, mostrar contagem de reenvio e dizer "confira o spam".
- "Aguarde um minuto" precisa de contador no botão.
- Logado como outra pessoa (exemplo: a dona), o botão fica cinza sem dizer que falta marcar os Termos, e "Não sou eu" tem pouco peso para um erro provável.
- "Convite de Gestor" aparece com ícone de erro, embora haja caminho. Usar visual neutro.
- "Aguardando confirmação" não diz a empresa nem o nome ou e-mail usado, presume "ele" e depende de atualização manual. Mostrar esses dados, oferecer "Avisar o Gestor no WhatsApp" (texto pronto) e verificar sozinho a cada poucos segundos.
- Nome de empresa sem espaços estoura o título: +648px em 390, +718 em 320 e +86 em 1440. Usar `break-words`/`overflow-wrap:anywhere` e reduzir o corpo do título.

### Encarregado: removido ou sem acesso
- "Acesso encerrado" tem bom tom e não culpa a pessoa. Falta o nome da empresa.
- "Sem acesso" é claro e tem saída. No perfil, o comportamento é outro (redireciona com aviso vermelho). Padronizar.
- A Gestão do encarregado só tem Ajuda e Sair. Ele não vê com qual conta, papel e empresa está.
- Em "Visão geral", a saudação usa o nome da empresa, não o da pessoa.
- O Elenco do encarregado exibe a chave PIX (às vezes um CPF) de todos. `MemberCard` mostra `pix_key` sempre que ela vem **[código]**. Pela regra de PII, o encarregado só deveria ler esse dado nos próprios turnos. **[verificar com RLS real; pedir revisão de segurança]**

### InviteTakeover
Empresa, data, valor, local e briefing são legíveis, e `Aceitar`/`Recusar` estão bem posicionados.
- Chamado disputado, individual, SOS e legado são idênticos. O componente não lê a origem **[código]**. Faltam "o primeiro a aceitar fica com a vaga", prazo, e no SOS "você não está no elenco desta empresa; está vendo porque ativou urgências".
- O nome da empresa é truncado já com um nome comum ("Momentos Doces C..."). É a informação de confiança. Permitir 2 linhas.
- O valor sai como "R$ 12500,00". Usar formatação pt-BR.
- Não está claro que o X não recusa. Acrescentar "Decidir depois".
- Em `perdeu-a-corrida`, o cartão com `Aceitar` aparece sob o aviso de que outra pessoa aceitou. **[verificar]**
- Em 320 com texto longo, os botões fixos funcionam bem, mas o briefing fica quase escondido.

### Recibo e termo de serviço
- Para confirmar um recebimento, a pessoa rola cerca de 2.000px, expande o termo, marca e toca no botão. O botão e a caixa nascem desabilitados e o motivo fica em letra pequena. Pôr no topo um resumo (empresa, valor, "falta confirmar") com âncora para o termo. Deixar o botão tocável e, no toque, levar ao que falta.
- Falta a saída "Não recebi" ou "Valor errado" (conversar com a empresa). Hoje só dá para confirmar ou abandonar. É a maior lacuna de confiança do recibo.
- O texto diz "Aceitar termo e confirmar recebimento", mas o aviso de que a ação é irreversível só aparece na variante sem termo.
- Sem CPF, a confirmação de recebimento também trava: o botão habilita e o aceite aborta **[código]**. O link para o Perfil não oferece retorno. Como o perfil informa que o CPF cadastrado só muda via suporte, testar o caso de CPF inválido.
- Estornado vira "Recibo não encontrado ... ou você não tem permissão". Parece sumiço ou fraude. Mostrar "Registro cancelado pela empresa em X", com motivo e link para Recebimentos.
- `recibo-erro` não tem "Voltar".
- IP e user-agent crus ("não são prova") assustam o leigo. Recolher em "Detalhes técnicos".
- O termo falar em validade jurídica ao lado de "não garante" gera dúvida. Revisar com jurídico.
- "ás 13:00" deve ser "às". "R$ 1234567,89" precisa de separador de milhar.
- Texto longo estoura o recibo (+265px em 390, +335 em 320), no nome e na nota. Isso também afeta a impressão.

### Pagamento por estado (empresa) e chamado
- Os modais Registrar, Agendar e Estornar são claros e dizem que o dinheiro não passa pelo Worki.
- Sem PIX: o valor aparece como "0" e não há aviso "este freela não tem chave PIX". Sugerir pedir no chat ou usar Dinheiro.
- "Confirmar Entrega" legado diz "pagamento será liberado imediatamente", com o pagamento pelo Worki pausado. Remover o caminho ou o texto.
- Rotular o estado do dinheiro no cartão: "A pagar", "Agendado", "Pago, aguardando confirmação", "Confirmado". "Finalizado" com `Ver Recibo` não informa se o freela confirmou.
- "Marcar como pago" é irreversível na prática; conferir se pede confirmação com valor e data.
- **Chamado vencido com "Aguardando" (DEFEITO) [código].** O painel deriva `jaVenceu`, mas o rótulo do alvo usa só `response` e `call.status` ainda `open`. Passar o status derivado e mostrar "Não respondeu a tempo", com `Chamar de novo`.
- SOS bloqueado aparece como botão apagado. **[verificar]** se o motivo fica visível sem toque longo ou hover.
- Chamar com elenco vazio diz "todos já estão neste turno ou foram chamados". É falso e não há CTA. Separar o caso e oferecer "Adicionar freela".
- Turno criado sem elenco: o texto diz "antes de criar turnos", mas o turno já foi criado.
- Chat travado não mostra o motivo: campo e botão parecem normais ou só apagados. **[verificar se o cenário aplicou o bloqueio]**

### Trilha e regulamento
- A lista de benefícios, o "Quase lá" com o que falta e o erro "seus marcos continuam registrados" são muito bons.
- "Pedir PIX de segunda", que é a ação do dinheiro, fica depois de todos os marcos (cerca de 2.400px). Levá-lo para o cartão "Disponível para saque", com o motivo quando estiver bloqueado.
- "Bônus conquistado", "liberando", "em conferência" e "disponível" não fecham a conta visualmente. Mostrar uma soma única: conquistado = pago + pedido + disponível + em conferência. Os valores incoerentes das variantes "todos concluídos" e "encerrada" podem vir do mock. **[verificar]**
- A tela mostra "x de 10 marcos"; o regulamento fala em 20, e o convite promete "2 marcos já concluídos". Explicar a contagem ou alinhar. **[verificar o catálogo real]**
- Aceite falhou ("ainda não está aberta"): o botão continua ativo e convida a repetir. O aviso parece informação, não erro.
- "Desligada" e "sem inscrição" são iguais e não têm ação além de "Gestão".
- O regulamento é legível. Falta um resumo no topo (quanto, quando, mínimo, como sair) e data amigável no lugar de "Versão 2026-11-24". "Bônus que não seja genuíno pode deixar de ser pago" precisa de exemplo.

### PWA: instalar, atualizar e offline
- Instalar e Atualizar flutuam no topo e cobrem "Confirmar recebimento" e o valor. No iPhone em 320, o aviso toma boa parte da primeira tela, com quebras ruins e um ponto solto. Usar faixa no fluxo da página ou cartão acima da barra inferior, e só depois do primeiro valor entregue.
- A faixa offline é clara. "Algumas telas podem não carregar" não diz o que acontece com uma ação. Usar "Nada será enviado até a internet voltar" e desabilitar envios. No chat offline, dar o motivo.
- No modal offline, a faixa fica sob o fundo escuro.
- Câmera negada: boa mensagem. Oferecer o botão "Usar Worki ID".

### Vazios, erros e textos gigantes
- Vazios bons: Recebimentos, Elenco, Empresas, Hoje do encarregado. Fracos: "Nenhum turno encontrado" na lista nova da empresa (usar "Crie seu primeiro turno") e freela novo com cinco cartões zerados antes de "como receber o primeiro convite".
- Empresa nova: o primeiro passo real é montar o elenco, mas o CTA é "Criar primeiro turno". Criar um guia de 3 passos: adicionar freela, criar turno, convidar.
- "Algo deu errado" só tem Recarregar; logado, perde o menu. Acrescentar "Ir para o início" e um código de suporte.
- 404: "Voltar" depende do histórico; garantir destino.
- Texto gigante também estoura o nome do freela em Presença e passa por cima do ícone de chat. Aplicar `min-w-0` e quebra de palavra como utilitário padrão em títulos. Em "Hoje", títulos longos empurram a ação; limitar a 3 linhas.
- O stepper Contratado, Chegada, Saída e Entrega fica vertical, solto à esquerda no celular, e ocupa muito. Compactar em linha.

## 320 e 1440
- **Admin em 320:** transborda 52px na visão geral e no erro, e 35px em usuários. "Atualizar" e o filtro saem da tela, a tabela é cortada e valores quebram entre "R$" e o número. No erro, os cartões mostram "R$ 0,00 Dinheiro real na conta Asaas" ao lado de "não foi possível consultar": é o mesmo P0 de zero falso. Ajustar com cabeçalho que quebra, tabela em cartões, `whitespace-nowrap` nos valores e `flex-wrap`. Há alvos menores que 44px. Faltam acentos, e Asaas e Escrow são legado do pagamento pausado.
- `/admin` deslogado mostra a página inicial no cenário `admin-login`. **[verificar]**
- Registrar Pagamento em 320x640: os botões ficam abaixo da dobra do modal. Usar rodapé fixo, como no SOS.
- Em 1440, login, convite, aguardando e recibo funcionam bem centralizados. O InviteTakeover fica pequeno, mas legível.

## Ordem sugerida
1. Consentimento no convite de Elenco.
2. Erro no lugar de zero (painel, relatório, Admin e valor nulo).
3. Estornar no turno finalizado, menu coberto e "Aguardando" vencido.
4. Revisão de segurança da PIX no Elenco do encarregado e do gerente revogado.
5. Recibo: resumo no topo, "Não recebi" e tela de estornado.
6. Convites: contexto no login, reenvio de e-mail e código, tela de espera.
7. InviteTakeover por tipo.
8. Quebra de texto, avisos de PWA, botão de PIX da trilha, Termos com saída.
9. Acentos e vocabulário.

## Limites desta crítica
- A galeria usa dados e respostas simulados e não prova RLS nem comportamento real.
- Não vi todos os 425 cenários: foquei no escopo de primeira vez e regra especial. Em 320 e 1440, vi só uma amostra.
- Telas longas foram revisadas reduzidas e, em alguns casos, cortadas na parte de baixo.
- Não medi contraste, leitor de tela nem teclado.
