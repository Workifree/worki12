# Pagamento Postpago — Guia da Empresa

Bem-vindo ao fluxo de pagamento postpago do Worki! Este guia explica como funciona o novo modelo de pagamento para empresas.

---

## O que é Pagamento Postpago?

No modelo **postpago** (como Uber), você **não deposita dinheiro antecipado**. Em vez disso:

1. Você cadastra um cartão de crédito uma única vez
2. Quando um turno é concluído, o Worki cobra seu cartão automaticamente
3. O freelancer é pago instantaneamente

**Vantagem:** Você só paga pelo que realmente usou, sem depósitos prévios.

---

## Como Começar

### Passo 1: Acessar a Carteira

1. Abra o app/navegador do Worki
2. Vá para **Carteira da Empresa** (menu lateral ou aba "Empresa")
3. Role até a seção **"Cartões de Crédito"**

### Passo 2: Adicionar um Cartão

1. Clique em **"Adicionar"** (ou **"Adicionar Cartão"** se estiver vazio)
2. Preencha o formulário:

   **Dados do Cartão:**
   - Número do cartão (ex. 4111 1111 1111 1111)
   - Mês de validade (ex. 12 para dezembro)
   - Ano de validade (ex. 2027)
   - CVV (os 3-4 dígitos atrás do cartão)

   **Nome do Titular:**
   - Exatamente como aparece no cartão

   **Dados Pessoais:**
   - Nome completo
   - E-mail
   - CPF (11 dígitos) ou CNPJ (14 dígitos) do titular/empresa
   - CEP
   - Número do endereço
   - Telefone

3. Clique em **"Salvar"**

**Pronto!** Seu cartão foi criptografado e armazenado com segurança. Você pode agora convidar freelancers sem fazer depósitos.

---

## Segurança do Cartão

- O número do seu cartão **nunca** é armazenado no Worki
- Ele é enviado diretamente para o Asaas (gateway de pagamento) via HTTPS criptografado
- O Worki só armazena:
  - Bandeira (Visa, Mastercard, etc.)
  - Últimos 4 dígitos
  - Nome do titular
- Você pode remover o cartão a qualquer momento

---

## O Fluxo de Pagamento

### Antes do Turno

```
Você convida um freelancer da sua equipe
     ↓
Freelancer aceita o convite
     ↓
O cartão é PRÉ-AUTORIZADO (hold de garantia — não é cobrado agora)
     ↓
Turno está garantido com saldo seu no cartão
```

A pré-autorização reserva o valor no seu cartão por **até 3 dias**, garantindo que há saldo para pagar o freelancer.

### Durante o Turno

- Freelancer faz check-in no início
- Trabalha durante o turno
- Faz checkout ao final

### Após Conclusão

```
Você (empresa) confirma a conclusão do turno
     ↓
O Worki CAPTURA o valor no seu cartão
     ↓
Seu saldo é debitado
     ↓
O freelancer recebe o dinheiro na carteira INSTANTANEAMENTE
```

---

## O que Fazer se o Cartão for Recusado

### Cenário 1: Recusa na conclusão do turno

Se ao concluir o turno o sistema mostrar:
> ❌ "Falha ao processar pagamento. Verifique seu cartão."

**Causas comuns:**
- Saldo insuficiente
- Cartão expirado
- Limite de transações por dia
- Dados incorretos

**Como resolver:**
1. Verifique com seu banco se o cartão está ativo
2. Confirme que há saldo disponível
3. Tente novamente no app
4. Se persistir, cadastre outro cartão e tente

### Cenário 2: Turno fica pendente

Se o pagamento falhar, o turno fica com status **"Pendente de Pagamento"** (você verá na lista de vagas).

**Ações disponíveis:**
- Tentar novamente com o mesmo cartão (após resolver com seu banco)
- Cadastrar um novo cartão e tentar cobrar nele
- Cancelar o turno (o freelancer receberá a recusa; você precisará explicar e acertar)

---

## Gerenciar Cartões

### Ver Cartões Cadastrados

Na seção **"Cartões de Crédito"** você vê todos os cartões com:
- Bandeira (Visa, Mastercard, etc.)
- Últimos 4 dígitos
- Titulário
- Se é o cartão padrão (estrela dourada)

### Remover um Cartão

1. Procure o cartão na lista
2. Clique em **"Remover"** ou o ícone de lixeira
3. Confirme a remoção

**Nota:** Se remover o cartão padrão, o próximo será marcado automaticamente como padrão.

---

## Perguntas Frequentes

**P: Por que preciso pré-autorizar o cartão?**  
R: A pré-autorização garante que o dinheiro está disponível. Assim, o freelancer sabe que será pago quando concluir o trabalho.

**P: O dinheiro é debitado duas vezes?**  
R: Não. A pré-autorização é só uma reserva; o débito de verdade acontece só na conclusão.

**P: E se o freelancer não comparece?**  
R: Você pode cancelar o turno e a pré-autorização é liberada. Seu cartão não é debitado.

**P: Posso usar o Worki sem cadastrar cartão?**  
R: Sim. Se preferir o modelo antigo (depósito prévio), você ainda pode. Mas o novo fluxo com freelancers da sua equipe usa cartão postpago.

**P: Meu cartão expirou. O que faço?**  
R: Remova o cartão expirado e cadastre um novo. Você será avisado no app antes de qualquer cobrança.

---

## Suporte

Dúvidas ou problemas com cartão? Entre em contato:
- **Chat no app** — fale com o time Worki
- **E-mail:** [suporte@worki.com]
- **Horário:** Segunda a sexta, 9h–18h (horário de Brasília)
