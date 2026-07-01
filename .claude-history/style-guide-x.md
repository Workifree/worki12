# Style Guide — Threads e Posts no X (PT-BR)

Modelo: build-in-public técnico estilo Prajwal Tomar (@PrajwalTomar_), adaptado para PT-BR e nicho "agentes de IA dentro do negócio".

---

## Identidade do autor

- Engenheiro de IA aplicada que constrói **agentes e automações dentro de processos internos de empresas** (atendimento, documentos, conciliação, ERP, logística, RAG, vision)
- Constrói coisas reais que rodam em produção — não demos
- Voz: técnica, direta, sem hype, sem guru, sem emoji-spam
- Posta o que aprende fazendo o trabalho real do dia
- DM aberto para projetos

## Bio do X (referência)

```
Construo agentes de IA pra processos internos de empresas.
Atendimento, documentos, conciliação, ERP, automação.
Posto o que aprendo todo dia. DM aberto pra projetos.
```

---

## Regras estruturais — THREAD

### Tweet 1 (HOOK)
- **Forma 1 — resultado quantificado:**
  `Acabei de [verbo de ação] [coisa] pra um cliente.`
  `Cortou [tarefa] de [X horas] pra [Y minutos].`
  `Economizou ~R$[Z]/mês.`
  `Arquitetura abaixo:`

- **Forma 2 — descoberta técnica:**
  `Passei [N dias/horas] tentando [problema técnico].`
  `A solução que funcionou: [insight em 1 linha].`
  `Por quê não é óbvio:`

- **Forma 3 — crítica/contraponto:**
  `Todo mundo tá usando [tool/abordagem padrão] pra [problema].`
  `Em produção isso quebra por causa de [razão específica].`
  `O que funciona na real:`

### Tweets 2 a N-1 (CORPO)
- 1 ideia por tweet, máximo 250 caracteres
- 1 artefato visual/concreto por tweet (screenshot de código, diagrama, métrica, log, output)
- Sem encher linguiça. Cada tweet tem que poder ficar de pé sozinho
- Mistura: contexto → problema → tentativa que falhou → solução → métrica
- Se thread tem >7 tweets, tá longa demais — corta

### Tweet N (FECHAMENTO + CTA SOFT)
Estrutura padrão:
```
Se tu roda [tipo de operação que se beneficia disso]:
- DM aberto
- Ou só me marca aqui se tiver dúvida

Construindo isso pra empresas todo dia. Segue se for útil.
```

Variação aceitável: substituir "DM aberto" por link de calendly só **depois** que tiver tração. No começo, DM > calendly (menos atrito).

---

## Regras estruturais — POST AVULSO (não-thread)

Categorias:
1. **Build update** — `Hoje refatorei [X], ganhei [métrica].` (1-2 frases, 1 screenshot)
2. **Lesson** — `[Lição técnica em 1 frase].` + 1 frase de contexto
3. **Reply de valor** — entra em conversa de outro engineer/founder com comentário técnico
4. **Reflexão** — observação sobre o trabalho, mercado, ferramenta (sem ser hot take vazio)

Posts avulsos: 1 por dia mínimo. Cumulativo > viral.

---

## BANIDOS (não publicar nada com)

- Emojis em excesso (regra: máximo 1 emoji por thread inteira, 0 é melhor)
- 🚀 🔥 ✨ 💡 — banidos terminantemente
- "In this thread", "Here's how", "Let me show you", "🧵 1/" no estilo americano genérico (em PT-BR fica artificial; ir direto)
- "Game changer", "mind-blowing", "incredible", "amazing"
- Linguagem de guru/coach ("manifeste", "elevate", "x10")
- Generalização sem dado ("a maioria das empresas...")
- Auto-promoção direta ("contrate-me", "compre meu curso")
- Conteúdo gerado obviamente por IA (frases vazias, simétricas, com 3 bullets, transições "moreover/furthermore")
- Hashtags (em X 2026 hashtags reduzem alcance)
- Threads sobre "produtividade" / "rotina" / "mindset" — fora de nicho

---

## Tom — exemplos do que EXCLUIR vs MANTER

❌ Excluir: `Hoje implementei uma solução incrível de IA que vai revolucionar como sua empresa lida com documentos! 🚀`

✅ Manter: `Implementei classificação de NF por foto. 96% accuracy num lote de 500 docs. Stack: GPT-4o vision + json schema. Custo: $0.018/doc.`

❌ Excluir: `Aprendi muito hoje trabalhando com agents de IA. A jornada continua! 💪`

✅ Manter: `Agente caiu em loop infinito chamando a mesma tool 12x. Causa: descrição da tool dizia "use sempre que precisar". Reescrevi pra "use só quando X". Resolveu.`

---

## Cadência semanal (baseada em dados, não chute)

Threads diárias matam audiência (34% unfollow por excesso, dados Sprout Social 2025). Cadência real dos top performers (levelsio, Tomar, Marc Lou):

| Dia | Conteúdo principal |
|---|---|
| **Seg** | 1 thread + 1 short post |
| **Ter** | 2 short posts |
| **Qua** | 1 thread + 1 short post |
| **Qui** | 2 short posts |
| **Sex** | 1 short post + 1 lesson curta |
| **Sáb** | Só replies (zero post próprio) |
| **Dom** | Off / replies leves |

**Total semanal:** ~9 short posts + 2 threads + 50+ replies orgânicos.

### Frequência por tipo
- **Threads:** 2/semana (segunda + quarta) — material mais denso da semana
- **Short posts:** 2-3/dia útil — build updates, observações, lições curtas
- **Replies:** 5-10/dia (manual, não automatizado)

### Horários de pico BRT
- **9h** — abertura matinal, alcance no horário americano de pré-trabalho (UTC-3 = US-East 8h)
- **14h** — almoço/intervalo
- **21h** — pós-trabalho BR

### Banco de threads
Se um dia for "dia de thread" e o material não tiver peso pra thread → adiar e postar short post no lugar. Forçar thread fraca prejudica mais que pular um dia.

Threads candidatas geradas em dias não-thread vão pro banco no Notion. Na quarta de manhã, escolher a melhor do banco da semana.

---

## Referência de threads canônicas (preencher manualmente)

> TODO: preencher com 5-10 threads reais do @PrajwalTomar_, @levelsio, @marc_louvion como referência ativa. Buscar threads que tiveram >100 likes e seguir o padrão.

Padrões observáveis em todas:
- Métrica concreta no tweet 1
- 1 artefato visual por tweet
- Sem face, sem voz, sem self-promotion direta
- Fecha com algo útil pro leitor (não pedido)

---

## Para o agente que gera as threads

Ao gerar candidatas:
1. Leia este guia inteiro como contexto
2. Extraia do dia técnico **2 ângulos diferentes** — um focado em problema/solução técnica, outro em decisão de arquitetura ou aprendizado
3. Cada candidato: 4-7 tweets na thread
4. **Anonimize cliente/empregador** — usa "uma empresa", "um cliente", "uma operação", nunca nome
5. **Não invente números** — se métrica não estiver clara no input, omitir e descrever qualitativamente
6. Use português brasileiro coloquial-técnico, não traduções literais de inglês
7. Verifique cada tweet contra a lista de BANIDOS antes de propor
