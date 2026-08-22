# Analytics de Operação — Guia da Empresa

## O que é

O painel **Analytics de Operação** (`/company/operacao`) traz os números que você hoje monta na mão em uma planilha: gasto, contratações, custo por hora, presença por freela, tempo de preenchimento de chamados.

**Tudo é somente leitura** — o painel não move saldo nem autoriza pagamentos. É auditoria e análise.

---

## Acessando

No menu lateral da empresa, clique em **Operação** (ícone de gráfico de barras).

---

## O que você vê

### Seletor de Período

Na tela, comece escolhendo o período que quer analisar:

- **Atalhos rápidos:** Hoje, Semana, Mês
- **Data customizada:** clique em "De" e "Até" para um intervalo manual
- O padrão ao abrir é o **mês completo até hoje**

### Métrica de Destaque: Tempo Médio de Preenchimento

O número grande no topo (com ícone ⚡) é a **métrica principal**: quanto tempo em média leva entre você disparar um chamado de turno e alguém aceitar.

- **O que significa:** por exemplo, "6 minutos" = turnos disparados neste período preencheram em média 6 minutos
- **Base:** contados apenas os chamados que tiveram pelo menos um aceite; chamados ainda abertos ou que expiraram não entram no cálculo
- **Sem dado:** se você não disparou nenhum chamado com aceite neste período, verá "Nenhum chamado de turno disparado"
- **Pior que zero:** se disparou chamados mas nenhum foi aceito ainda, verá "Chamados disparados, mas nenhum foi aceito ainda"

Este é o número que prova ROI — foi o feedback mais importante da pesquisa: você passa de "2 horas esperando" para "6 minutos" quando usa o broadcast em vez do chamado individual.

### Os Quatro Números Principais

Abaixo da métrica de destaque, você vê:

#### 1. Gasto no Período

**Mostra:** o total que você registrou como pago (modo A — pagamento externo).

- ✅ **Contagem:** só pagamentos com status "registrado" ou "efetivado" entram aqui
- ❌ **Não conta:** pagamentos cancelados ou apenas agendados (promessa, não desembolso)
- **Variação:** se temos dados de dois períodos iguais em semanas diferentes, mostramos se subiu ou desceu (com seta)
- **Aviso:** se houver pagamentos que vieram de duas fontes conflitantes (ex: escrow e registro externo no mesmo turno), verá um aviso amarelo explicando que foi considerado só o modo A

#### 2. Contratações no Período

**Mostra:** quantos freelas você contratou (aceitaram convite).

- **Base:** COUNT de linhas com `status='hired'` (ou `in_progress`/`completed` — qualquer um que foi contratado)
- **Contexto:** apareça também quantas vagas/turnos você criou (para você ver a taxa de preenchimento)
- **Aviso:** se não há dados, verá "Nenhum turno criado neste período"

#### 3. Custo por Hora

**Mostra:** quanto você gasta em média por hora trabalhada.

- **Cálculo:** total gasto ÷ total de horas executadas (ou estimadas — veja abaixo)
- **"—" (tracinho):** se não há turno concluído com marcação de ponto, verá "—" porque não há base para cálculo
- **⚠️ Aviso importante — Estimativa vs. Real:**
  - Se você não registrou check-out, o sistema usa a **hora estimada** do turno
  - O aviso mostra: "X de Y turnos usaram a hora ESTIMADA"
  - Exemplo: se 3 de 10 turnos não tiveram checkout, 7 usaram hora real e 3 usaram estimativa
  - **Impacto:** custo por hora sobre estimativa NÃO é o mesmo número que sobre hora real — pode ser bem diferente
- **Horas inconsistentes:** se um turno tiver check-in DEPOIS do check-out (erro de operação), aparece aviso em vermelho e esse turno é descartado do cálculo
- **Sem marcação de ponto:** se turno foi concluído mas não tem check-in/out nem hora estimada, aparece aviso em vermelho (turno perdido para análise)

#### 4. Horas Realizadas ÷ Previstas

**Mostra:** que percentual das horas que você planejou foi de fato executado.

- **Numerador:** total de horas trabalhadas (hora real de check-in/out, ou estimativa se não tiver marcação)
- **Denominador:** total de horas que você estimou no turno (o campo "Duração" ao criar)
- **Exemplo:** 24h realizadas de 30h previstas = 80%
- **"—":** se não há turno concluído, verá "—"
- **Avisos:**
  - Turnos sem estimativa = não entram no cálculo
  - Turnos sem marcação de ponto = não entram no cálculo
  - Turno que perdeu os dois (sem estimativa E sem marcação) = aviso em vermelho e descartado

### Demanda Não Atendida

Dois gráficos lado a lado:

#### Chamados por Status

Mostra como seus chamados de turno terminaram:
- **Open:** ainda aguardando resposta (achado no período, não fechou)
- **Filled:** preenchido com sucesso
- **Cancelled:** você parou de procurar
- **Expired:** expirou sem ninguém aceitar

#### Chamados por Motivo

Quebra dos motivos que você registrou ao disparar:
- Falta de freela
- Demissão / Quebra de escala
- Pico previsto
- Evento
- Férias
- Folga
- Reforço
- Outro

Isto é o mapa que ajuda você a entender: "Quantos chamados foram por falta mesmo vs. por cobertura de férias?"

### Confirmações de Véspera

Resume o status de confirmação que você pediu aos freelas:
- Quantos confirmaram que vão
- Quantos não responderam ainda
- Quantos disseram que não conseguem

### Tabelas por Freela

Três tabelas, uma abaixo da outra, listando dados por pessoa:

#### Aceitação por Freela

Para cada freela que você convidou neste período:
- **Nome**
- **Chamados disparados para ele/ela**
- **Quantos aceitou**
- **Taxa:** porcentual (aceitou/total)

**Importante:** esta tabela está em **ordem alfabética, NUNCA em ranking de desempenho**. Não há "melhor freela" — é só auditoria. Se você procura quem mais aceita, você tem que ler linha por linha e identificar. Isto é de propósito: rankings incentivam o comportamento "artificial" e o freela que rejeita turnos legítimos acaba penalizado injustamente.

#### Presença por Freela

Para cada freela que foi contratado neste período:
- **Nome**
- **Turnos realizados** (em_progress + completed)
- **Check-in registrado** (quantos desses tiveram check-in)
- **Taxa de presença:** check-ins / realizados

**Mesmo padrão:** ordem alfabética, auditoria sem ranking.

#### Desempenho por Freela

Para cada freela que completou turno neste período:
- **Nome**
- **Turnos concluídos**
- **Horas totais** (ou estimadas se não tiveram checkout)
- **Avaliação média** (estrelas, se você avaliou)

**Idem:** ordem alfabética.

---

## Limitações Honestas

### Período Muito Grande = Truncamento

Se você selecionar um período muito longo (ex: 6 meses), os números podem ser **parciais** por questão de performance. Verá um aviso em destaque:

> "Este período foi truncado. Reduza o intervalo para dados completos."

Se vir isto, reduza o período (por exemplo, de 6 meses para 1 mês por vez).

### Datas de Gasto ≠ Datas de Turno

**Importante:** os números de **gasto** são contados pela **data do pagamento** (quando você registrou ou efetivou). As **horas** são contadas pela **data do turno**.

Exemplo prático:
- Você dispara turno para **21 de agosto**
- Turno acontece, freela termina, check-out fecha (21 de agosto)
- Você só registra o pagamento **em 24 de agosto**

Se você pedir analytics de **21–23 de agosto**, as horas aparecem lá, mas o gasto não (porque foi registrado no dia 24). Isto causa deslocamento no cálculo de "custo por hora" perto das bordas do período.

**Como lidar:** se está fazendo análise mensal, sempre feche o período alguns dias após o fim do mês (ex: dia 5 de setembro para ter todo mês de agosto). Ou use períodos que começam no meio do mês.

### Modo A Não Move Saldo

Lembre: neste painel você vê dados de **modo A** (pagamento externo registrado). Nenhum dinheiro passa pelo Worki — é auditoria e comprovante. O saldo da plataforma não é tocado.

---

## Dicas de Uso

1. **Comparar semanas:** use o seletor rápido "Semana" para ver variação de performance entre semanas
2. **Verificar presença:** a tabela de presença mostra quem realmente faz check-in — use para entender confiabilidade
3. **Detectar furo na escala:** se vir muitos chamados "expired" (expirados) e muitas respostas "Não vou poder" em confirmação de véspera, você tem furos de disponibilidade
4. **Monitorar custo:** custo por hora alto pode indicar que você está agendando mal (horas estimadas longas com pouca execução real)

---

## Perguntas Frequentes

**P: Por que um freela não aparece nas tabelas?**  
R: A tabela só mostra quem foi convidado (aparece em aceitação) ou contratado/presente (presença/desempenho) neste período. Freelas que você tem no elenco mas não convidou não aparecem.

**P: Por que vejo "Sem avaliação" em alguns freelas?**  
R: Você ainda não avaliou aquele freela após o turno. A coluna de avaliação só mostra se você registrou uma nota.

**P: Posso exportar/imprimir estes números?**  
R: Não há botão de download no painel. Use print do navegador (Ctrl+P / Cmd+P) para salvar em PDF, ou screenshot de cada seção.

**P: Os dados são em tempo real?**  
R: Sim, atualizam a cada carregamento da página. Se fizer uma mudança (ex: confirmar pagamento), recarregue para ver o reflexo.
