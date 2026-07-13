# Changelog — Worki

Todas as mudanças visíveis ao usuário são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/).

---

## [Não lançado]

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

#### Slice 1 — Loop Relacional (MVP)

**Empresa:**
- Página "Minha Equipe" (`/company/team`) — adicionar freelancers por link de convite ou Worki ID
- Campo "Briefing" ao criar turno (regras, dress code, procedimentos visíveis no convite)
- Convite direto de turno para freelancers da equipe
- Acompanhamento de respostas (aceito/recusado/aguardando/expirado)

**Freelancer:**
- Aba "Convites" em "Meus Jobs" — receber e responder convites de turno
- Campo QR de identidade no perfil (`/profile` → ícone QR) — código único para empresas adicionar
- Página de aceite de convite por link (`/convite/:token`)
- Resposta neutra a convites (recusar não afeta reputação)

**Ambos:**
- Avaliação bidirecional pós-turno (empresa → freelancer; freelancer → empresa)
- Direção explícita em avaliações (quem avalia quem)

#### Slice 2 — Pagamento Postpago (modelo Uber)

**Empresa:**
- Cadastro de cartão de crédito na Carteira da Empresa (`/company/wallet`)
- Seção "Cartões de Crédito" com interface de adicionar/gerenciar cartões
- Modal de cadastro de cartão com validação de dados (número, validade, CVV, CPF/CNPJ, CEP, telefone)
- Cartão tokenizado no Asaas (número do cartão não é armazenado no Worki)
- Modelo de pagamento postpago: **sem depósito antecipado**
- Na conclusão do turno, o cartão é automaticamente debitado
- Aviso in-app quando a autorização do cartão falha
- Turno fica pendente de pagamento até que o cartão seja aceito

#### Slice 3 — Inteligência Financeira (BI da Empresa)

**Empresa:**
- Página "Painel Financeiro" (`/company/financeiro`) — acessível pelo menu Sidebar e card na Carteira
- **Teto de gasto mensal:** configurar limite, barra de progresso colorida (80%/90%/100%), alertas in-app
- **Faturamento do mês:** CTA para informar, destrava indicador de custo % faturamento
- **Indicadores de custo:** custo total, custo/hora, custo % faturamento
- **Gasto por freelancer:** ranking com horas, turnos, fonte das horas (estimada/mista/checada), valor total
- **Custo de no-show (estimativa):** contagem de turnos aceitos sem checkout, custo de oportunidade
- **Alerta de concentração:** flag quando freela ultrapassa 150h E 20 dias distintos (risco de vínculo trabalhista)
- **Seletor de período:** análise por mês atual ou mês anterior

### Alterado

- Fluxo de criação de turno: freelancers da equipe em vez de candidatos anônimos no feed
- Modelo de convite: aceite/recusa substituem candidatura automática em vagas
- Modelo de pagamento: postpago (cartão on-file) é agora a opção padrão; pré-pago (depósito) permanece funcional
- Card "Painel Financeiro" adicionado na Carteira da Empresa como atalho para Financeiro
