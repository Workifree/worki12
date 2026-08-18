# Changelog — Worki

Todas as mudanças visíveis ao usuário são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/).

---

## [Não lançado]

### Adicionado

#### Escala Recorrente — Turnos que Se Repetem (2026-08-17)

**Empresa:**
- **Criar série recorrente:** ao invés de cadastrar turnos um por um, crie uma série que gera múltiplos turnos automaticamente
- **Dois tipos de repetição:** (1) **Toda semana** — escolha os dias que se repetem (seg, ter, etc.); (2) **Cobrir um período** — um turno por dia corrido (ideal para férias/eventos)
- **Data final obrigatória:** toda série tem um fim — nada de recorrência infinita
- **Máximo 60 turnos por série:** limita o tamanho das séries; a tela avisa se ultrapassar o limite
- **Prévia ao criar:** antes de confirmar, você vê quantos turnos serão criados e a lista completa de datas
- **Cada turno é independente:** após criada, cada turno funciona como um turno normal (edit, convite, pagamento, avaliação)
- **Convidar para a série inteira:** escolha um freela e convide-o para todas as ocorrências futuras ainda abertas (em paralelo, sem digitar cada uma)
- **Aviso de sobrecarga:** se convidar alguém para tantos turnos que ultrapasse o limite semanal configurado, a tela avisa (a decisão é sua)
- **Editar os futuros:** altere título, função, descrição, requisitos, briefing, local, horário, vagas para todas as ocorrências futuras abertas, de uma vez (o valor fica travado)
- **Cancelar a série:** encerre a série — ela para de gerar novos turnos e remove as ocorrências futuras ainda abertas
- **Prévia antes de aplicar:** tanto para edição quanto cancelamento, a tela mostra quantos turnos serão afetados e quantos ficarão (porque já têm freela ou chamado)
- **Proteção de freelas confirmados:** turnos com freela já contratado ou chamado aberto NUNCA são alterados ou cancelados em massa — segurança contra quebra de compromisso
- **Série é imutável:** após criar, não dá para mudar tipo/dias/datas — crie uma nova se precisar de padrão diferente

#### Chamado de Turno — Disparo 1→N com Primeiro-Aceite (2026-08-17)

**Empresa:**
- **Novo modelo de convite:** em vez de convidar freela por freela e segurar a vaga por horas, a empresa dispara um turno para vários freelas do Elenco **ao mesmo tempo**
- **Quem aceitar primeiro fica com a vaga:** o chamado fecha automaticamente quando a vaga é preenchida; os demais recebem notificação sem qualquer punição
- **Opções de expiração:** 30 minutos, 1 hora, **2 horas (padrão)**, 6 horas, 24 horas, ou até o horário de início do turno
- **Motivo do chamado:** empresa marca por que precisa chamar (falta de freela, demissão/quebra de escala, pico previsto, evento, férias, folga, reforço)
- **Métrica de performance:** a tela do turno mostra em quanto tempo a primeira vaga foi preenchida (ex: "6 minutos" em vez de "2 horas")
- **Visão em tempo real:** painel mostra quantos responderam, quantos recusaram, quantos ainda estão aguardando
- **Cancelar chamado:** empresa pode parar de procurar a qualquer momento — o chamado encerra e ninguém perde reputação
- **Convite tradicional ainda funciona:** para chamar apenas um freela, a interface é a mesma (é um chamado com um alvo)

#### Listas do Elenco — Organizar Freelas por Função (2026-08-17)

**Empresa:**
- **Nova tela "Listas do Elenco":** salvar grupos de freelas por função/tipo ("Cozinha", "Salão", "Chapa", "Limpeza", etc.)
- **Criar/editar/excluir listas:** interface simples de nomear e marcar freelas
- **Um freela em várias listas:** o mesmo freela pode estar em "Cozinha" E "Limpeza"
- **Criar lista vazia:** salvar uma lista sem membros e preenchê-la depois é válido
- **Usar listas no chamado:** ao disparar um turno, clicar num chip de lista **adiciona todos os freelas daquele grupo** à seleção
- **Marcar/desmarcar:** clicar novamente no chip remove só aquele grupo (não desfaz os freelas marcados à mão)
- **Excluir lista não remove ninguém:** quando você exclui uma lista, os freelas continuam no Elenco — apenas a categorização é removida
- **Disponibilidade na hora:** no moment do chamado, os chips mostram **quantos da lista estão realmente disponíveis** para aquele turno (quem já está alocado ou saiu do Elenco não é contado)

#### Revisão Pré-Piloto (Onda 3) — 2026-08-16

**Agenda de Turnos por Dia (Empresa):**
- "Meus Turnos" agora é uma agenda organizada por dia: Hoje, Amanhã, Esta Semana, Depois, Sem Data, Anteriores
- Cada linha mostra horário, função, freela (com avatar/estado) — sem necessidade de clicar
- Turno sem freela em Hoje ou Amanhã fica destacado em âmbar com alerta "Sem freela"
- Seção "Anteriores" permanece recolhida por padrão (operação não vive no passado)

**Gerenciamento de Convites e Recursos Humanos (Empresa):**
- **"Cancelar Convite":** quando convite está pendente, empresa pode cancelá-lo; freela é notificado
- **"Dispensar do Turno":** quando freela já está confirmado, empresa pode dispensá-lo; requer confirmação explícita
- Ambas as ações não são possíveis se houver pagamento já registrado/agendado para o turno (é preciso estornar antes)

**Notificação via WhatsApp (Empresa):**
- Botão **"Avisar no WhatsApp"** aparece ao lado de convites pendentes (se freela tem telefone cadastrado)
- Abre o WhatsApp com mensagem pronta: turno, data, horário, local e valor
- Serve para resgatar convite que pode expirar sem o freela abrir o app

**Convidar Diretamente do Elenco (Empresa):**
- Card de cada freela em "Meu Elenco" agora tem botão **"Convidar para turno"** na base
- Abre modal para escolher um turno elegível (aberto/pausado, sem esse freela, data futura)
- Dispara convite direto sem sair da tela de elenco

**Histórico do Freela por Empresa (Empresa):**
- Card de freela em "Meu Elenco" agora mostra quantos turnos ele já fez com você e quando foi o último

**Comunicação com Empresa (Freelancer):**
- Botão **"Falar com a empresa"** aparece em turnos em andamento e agendados
- Permite freelancer iniciar conversa sem esperar empresa abrir a conversa
- Mesma conversa em ambos os lados; se empresa já abriu, freelancer vê histórico

**Recibo Melhorado (Freelancer e Empresa):**
- Recibo agora mostra **Chegada** (hora real do check-in), **Saída** (hora real do checkout) e **Total de horas trabalhadas**
- Funciona mesmo para turnos que cruzam a meia-noite (cálculo automático)
- Se check-in/checkout não foram registrados, aquela linha é omitida (não inventa dados)

**Unificação de Nome de Tela (Empresa):**
- Tela de "Confirmação de Presença" agora é consistentemente chamada **"Presença e Pagamento"** em todos os pontos de acesso

### Adicionado

#### Revisão Pré-Piloto (Onda 1) — 2026-08-16

**Chave PIX na Plataforma:**
- Freelancer informa sua chave PIX (CPF/CNPJ/e-mail/telefone) durante o onboarding
- Chave é exibida no perfil do freelancer (com botão de copiar)
- Empresa vê a chave PIX em "Meu Elenco" (card do freelancer)
- Ao registrar pagamento, chave PIX vem pré-carregada

**Novo Perfil Público da Empresa:**
- Freelancer pode abrir perfil completo de qualquer empresa antes de aceitar convite
- Mostra: nome, logo, capa, setor, descrição, endereço, briefing padrão
- Inclui avaliações de outros freelancers que já trabalharam lá
- Acessível de: convite pendente, Carteira de Clientes, chat, tela cheia de convite

**Cards de Elenco Clicáveis:**
- Cards de freelancer em "Meu Elenco" (empresa) agora abrem o perfil completo ao clicar
- Botões de compartilhar e remover continuam funcionando normalmente

**Validação na Criação de Turno:**
- Campos obrigatórios (título, função, descrição, valor, data e horário) são validados antes de confirmar
- Data no passado é bloqueada

**Confirmação de Presença Simplificada:**
- QR de check-in e verificação por GPS foram removidos (nenhum verificava de fato)
- Confirmação de presença agora: freelancer faz check-in no app + empresa confirma manualmente na tela do turno
- Rótulo "(GPS)" removido (a geolocalização era solicitada e descartada)
- O QR de **identidade do freelancer** (usado para adicionar ao elenco) permanece ativo

**Limpeza de Interface:**
- Sino da empresa ramifica por papel: navega para `/company/notifications` em vez de tela de erro
- Botão "Mensagem" em perfil de freelancer agora funciona
- Ícones decorativos (lupa/funil) removidos de dashboards
- "Dica Pro" com dados inventados foi corrigida/removida

**Remoção de Superfície de Modelo Antigo (Modos B/C — Postpago):**
- Seção "Carteira da Empresa" (`/company/wallet`) removida
- Modais de depósito e cartão de crédito removidos (Modo B/C não está no piloto)
- Página "Painel Financeiro" (`/company/financeiro`) removida
- Página "Meu Saldo" (worker) removida — substituída por [**Meus Recebimentos**](#meus-recebimentos-pagamento-externo-modo-a)
- Código morto removido: `Analytics.tsx`, `CreateJob.tsx`, `Placeholder.tsx`, `WorkerDashboard.tsx`

**Meus Recebimentos (Pagamento Externo — Modo A):**
- Nova página `/recebimentos` acessível pelo menu inferior (BottomNav)
- Freelancer acompanha todos os pagamentos registrados pelas empresas em uma única tela
- Categorias: agendados (promessa), aguardando confirmação, recebidos, cancelados
- Cada item abre o recibo bilateral completo para conferência e confirmação

### Adicionado

#### Cancelamento de Turno Agendado (2026-07-14)

**Freelancer:**
- Botão "Cancelar turno" na aba Agendados permite cancelar um turno que já foi aceito
- Empresa recebe notificação automática do cancelamento e o turno volta a ficar disponível

### Corrigido

#### Perfil, Home e Notificações (2026-07-14)

**Freelancer e Empresa:**
- **Perfil:** seções de Segurança (trocar senha), Sair e Zona de Perigo agora ficam ocultas atrás do botão "Configurações da Conta" (reduz poluição visual e risco de clique acidental)

**Freelancer:**
- **Próximo Turno na home:** exibe corretamente o próximo turno agendado (antes mostrava "Invalid Date")
- **Status do turno em andamento:** destaca quando o freelancer está no turno agora
- **Sem turnos:** exibe "Sem próximos turnos marcados" quando não há agendamento
- **Notificações de mensagem:** o sino limpa as notificações de mensagem ao abrir a conversa (antes ficavam presas)

### Adicionado

#### Agregados e Histórico Detalhado do Freela (2026-07-12)

**Freela:**
- **XP e nível corretos:** ao concluir turnos, XP sobe (100 por turno) + bônus de perfil (foto +50, especialidades +75), nível progride automaticamente
- **Ganhos totais visíveis:** o total de ganhos e número de turnos concluídos agora aparecem corretos na tela inicial
- **Histórico detalhado:** ao clicar em um turno concluído, vê chegada/saída (timestamps), valor, status de pagamento e avaliação recebida
- **Avaliações no perfil:** tanto freela quanto empresa veem a lista de avaliações recebidas (estrelas + comentário) em seus perfis públicos
- **Avaliação obrigatória após pagamento:** ao receber um turno pago, o freela é solicitado uma vez (por visita) a avaliar a empresa antes de deixar a tela de histórico

#### Pagamento Agendado e Comprovante (2026-07-12)

**Empresa e Freelancer:**
- **Agendamento de pagamento:** a empresa pode agendar pagamento com data prevista, gerando um "Comprovante de Agendamento" que dá respaldo ao freela
- **Transição para pago:** após o agendamento, a empresa marca como efetivamente pago (status → 'recorded'), gerando o recibo normal

#### Briefing Padrão (2026-07-12)

**Empresa:**
- **Briefing padrão do negócio:** configurar uma vez no perfil da empresa (regras da casa, dress code, apresentação)
- **Pré-preenchimento ao criar turno:** ao criar novo turno, o briefing padrão vem preenchido e pode ser ajustado por turno

#### Modo A — Pagamento Externo (Piloto 2026-07-01)

**Empresa e Freelancer:**
- **Registrar pagamento feito por fora:** ao concluir um turno, a empresa registra que pagou o freelancer por PIX/dinheiro (fora do Worki)
- **Recibo in-app:** geração automática de recibo declaratório acessível por empresa e freelancer
- **Confirmação de recebimento (bilateral):** o freelancer pode confirmar que recebeu o pagamento
- **Inteligência financeira unificada:** o painel financeiro e alertas de teto agora contam tanto pagamentos via Worki quanto registrados por fora

**Empresa:**
- Botão "Registrar pagamento" na tela de conclusão de turno (campo "Pagamento feito por fora do Worki")
- Seleção de fonte de pagamento: PIX, dinheiro em espécie ou outro método
- Confirmação e emissão automática de recibo
- Rastreamento do pagamento no histórico de turnos

**Freelancer:**
- Visualização de recibos de pagamentos registrados
- Confirmação de recebimento (gera valor comprovado no recibo bilateral)

#### Meu Elenco e Convites de Turno (Novo Fluxo de Contratação)

**Empresa:**
- Página "Minha Equipe" (`/company/team`) — construir e gerenciar sua equipe de freelancers
  - Adicionar por: link de convite, Worki ID ou **QR Scanner** (câmera)
  - Ver status: confirmados, aguardando resposta, bloqueados
- Campo "Briefing" ao criar turno (regras, dress code, procedimentos)
- Convite direto de turno para freelancers da equipe (sem abrir no feed)
- Acompanhamento de respostas (aceito, recusado, aguardando, expirado)

**Freelancer:**
- Aba "Convites" em "Meus Turnos" — receber e responder convites de turno
- Código QR de identidade no perfil (empresas podem escanear para adicionar)
- Link de aceite de convite por e-mail/WhatsApp/SMS
- Resposta neutra a convites (recusar não afeta reputação)

**Ambos:**
- Avaliação bidirecional pós-turno (empresa avalia freelancer; freelancer avalia empresa)
- Histórico completo de avaliações nos perfis públicos

### FUTURO — Não lançado no piloto

#### Slice 2 — Pagamento Postpago (modelo Uber — Futuro)

Recursos planejados para expansão futura:

**Empresa:**
- Cadastro de cartão de crédito na Carteira da Empresa
- Seção "Cartões de Crédito" com interface de adicionar/gerenciar cartões
- Modelo de pagamento postpago: **sem depósito antecipado**
- Na conclusão do turno, o cartão é automaticamente debitado

#### Slice 3 — Inteligência Financeira (BI da Empresa — Futuro)

Recursos planejados para expansão futura:

**Empresa:**
- Painel Financeiro com análise detalhada de gasto
- **Teto de gasto mensal** com alertas
- **Faturamento do mês** e indicadores de custo
- **Gasto por freelancer** e tendências
- **Alerta de concentração** para risco de vínculo trabalhista

### Alterado

- **Fluxo de criação de turno:** Freelancers da sua equipe em vez de candidatos anônimos no feed
- **Modelo de convite:** Aceitar/recusar convites em vez de candidatura automática em vagas abertas
- **Modelo de pagamento (Piloto):** Pagamento Externo (Modo A — PIX/dinheiro direto) é o padrão; registrado e confirmado no app
