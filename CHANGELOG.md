# Changelog — Worki

Todas as mudanças visíveis ao usuário são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/).

---

## [Não lançado]

### Adicionado

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

### Alterado

- Fluxo de criação de turno: freelancers da equipe em vez de candidatos anônimos no feed
- Modelo de convite: aceite/recusa substituem candidatura automática em vagas
- Modelo de pagamento: postpago (cartão on-file) é agora a opção padrão; pré-pago (depósito) permanece funcional
