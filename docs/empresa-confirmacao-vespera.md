# Confirmação de Véspera — Avise-se do Freela um Dia Antes

Quando a escala quebra, geralmente você só descobre no dia — às 8h, quando o freela não aparece e o turno já começou. Esta feature antecipa a descoberta: **na véspera (18h), pergunte ao freela já escalado: "você confirma amanhã?"** — ele responde em um toque, e se disser "não", você tem a noite inteira para chamar um substituto.

---

## Como funciona do lado do freela

### Receber o pedido

Na véspera do turno, o freela vê um **card destacado** em **"Meus Turnos"** (aba **Agendados**):

```
Você vai trabalhar amanhã?

[Sim, vou]  [Não vou poder]
```

A notificação no sino também avisa: "Confirma seu turno de amanhã?".

### Responder em um toque

- **"Sim, vou"** → O card mostra um badge verde: **Confirmado** ✓
- **"Não vou poder"** → O card mostra um badge âmbar: **Avisou que não vai** ⚠

A resposta é **imutável** — você não pode mudar de ideia depois.

**Importante:** Silêncio (não responder) é só um alerta — o turno continua seu. A empresa é quem decide se dispensa você ou espera.

---

## Como funciona do lado da empresa

### Ver quem confirmou

Na tela **"Presença e Pagamento"** de um turno, você vê um **resumo no topo:**

```
3 confirmados · 1 sem resposta · 1 não vai
```

Cada freela tem um **badge** na lista:
- ✓ **Confirmado** — disse que vai
- ○ **Sem resposta** — você pediu, mas ele não respondeu ainda
- ⚠ **Avisou que não vai** — ele disse que não consegue

### Pedir confirmação manualmente

Se quiser reforçar o aviso ou adiantar para antes da véspera:

1. Na tela **"Presença e Pagamento"**, procure pelo botão **"Pedir confirmação"** na linha do freela
2. Clique — uma notificação é enviada **imediatamente** ao freela com o mesmo card em `/my-jobs`

**Limite:** você pode pedir no máximo **2 vezes** por freela no mesmo turno (1 automática + 1 manual, ou 2 manuais).
- Após o 2º pedido, o botão fica desabilitado com o texto: "Limite de pedidos atingido"
- Se já pediu uma vez, precisa esperar **6 horas** para pedir de novo

### Quando o freela avisa "não vai"

Você recebe uma **notificação urgente:**

```
Freelancer não vai poder trabalhar amanhã
```

Clique para ir direto para a tela de **"Presença e Pagamento"** daquele turno.

O botão de **dispensar** o freela agora aparece como **"Dispensar e chamar substituto"** — dispensa o freela **e abre a interface de Chamado de Turno** (F1) para reabrir a vaga imediatamente.

#### Exceção: há pagamento agendado?

Se você já agendou um pagamento para aquele freela, **não consegue dispensar** nem chamar substituto enquanto o pagamento estiver ativo. Você precisa:

1. Estornar o agendamento de pagamento primeiro
2. Depois dispensar o freela e chamar substituto

---

## Quando é enviado o pedido automático?

Por padrão, a confirmação é solicitada **todos os dias às 18h** para turnos que começam **amanhã** (data local).

**Nota importante:** este envio automático depende de uma configuração de servidor (`pg_cron`) que **ainda não está habilitada em produção**. Enquanto isso:
- A confirmação funciona **pelo botão manual** ("Pedir confirmação") que você controla
- Você pode pedir confirmação a qualquer hora (não apenas na véspera)
- O automático será ativado assim que a configuração for liberada

---

## Fluxo prático: como não deixar ninguém faltando

1. **Final da tarde (véspera):**
   - Você recebe notificação: freela X "não vai poder"
   - Clica em "Avisar no WhatsApp" para tentar virar de última hora
   - Ele não responde

2. **Mesma noite:**
   - Abre a tela **"Presença e Pagamento"** do turno
   - Badge de freela X mostra ⚠ **Avisou que não vai**
   - Clica em **"Dispensar e chamar substituto"**
   - O Chamado de Turno (disparo 1→N) abre com os freelas do seu Elenco
   - Escolhe uma lista (ex: "Cozinha") e **dispara o chamado**

3. **Antes de abrir (amanhã):**
   - Freela Y aceita o chamado
   - Você confirma a presença de Y (que é novo)
   - Escala fechada — operação segura

---

## Notas importantes

- **Imutabilidade:** Uma resposta não pode ser mudada. Se o freela responde "Não vou poder", ele pode apenas avisar a empresa por outro canal (WhatsApp, telefonema).
- **Não cancela automaticamente:** silêncio na véspera nunca muda o status do turno — é só um aviso. A empresa decide o que fazer.
- **Integração com Chamado de Turno:** quando um freela avisa que não vai, a empresa tem acesso direto à interface de Chamado (F1) para reabrir a vaga — nenhuma tela duplicada.
- **Histórico:** as respostas ficam gravadas (confirmou, disse que não vai, não respondeu) — futuras análises mostrarão quem é mais confiável na confirmação.

---

**Próximos passos:** configure seu Elenco, agende alguns turnos e teste o pedido de confirmação com um freela de confiança.
