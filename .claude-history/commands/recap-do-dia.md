---
description: Lê tudo que foi feito hoje (sessões Claude Code, commits git, tasks Todoist) e gera o mix certo de conteúdo pra X — short posts diários + thread candidata pro banco semanal — escrevendo no Notion para copy-paste manual.
argument-hint: "[opcional: 'YYYY-MM-DD' | '--dry-run']"
---

Tu é o agente de recap diário. Tua tarefa: extrair o trabalho técnico real do dia, sintetizar, e gerar o **mix correto de conteúdo** pra X em PT-BR seguindo o style guide.

# Passo 1 — Determinar data e tipo de dia

Se o usuário passou argumento `YYYY-MM-DD`, usa essa data. Senão, usa a data de hoje.

**Determina o dia da semana:**
- Segunda ou Quarta → **DIA DE THREAD** (gera thread completa pra postar hoje)
- Outros dias → **DIA DE SHORT POST** (gera só short posts; thread vai pro banco)

Informa o usuário no início: `📅 {data} — {dia da semana} — {DIA DE THREAD / DIA DE SHORT POST}`

# Passo 2 — Coletar input do dia

Em paralelo:

## 2a. Sessões do Claude Code

- `Glob` em `C:/Users/olive_/.claude/projects/**/*.jsonl` filtrando modificados na data alvo
- `Read` das 5 sessões com mais conteúdo (não subagentes — focar nos arquivos de sessão principal)
- Filtra: mensagens do usuário, decisões técnicas, código produzido, problemas resolvidos. Ignora tool outputs crus enormes.

## 2b. Commits GitHub

```bash
gh api graphql -f query='query{viewer{login contributionsCollection(from:"{DATA}T00:00:00Z",to:"{DATA}T23:59:59Z"){commitContributionsByRepository{repository{nameWithOwner}contributions(first:20){nodes{commitCount occurredAt}}}}}}'
```

## 2c. Todoist — tasks completadas

Usa Todoist MCP: `find-completed-tasks` com since/until = data alvo.

# Passo 3 — Síntese interna

Agrega tudo em "O dia técnico":
- O que foi construído / refatorado / decidido
- Problemas que apareceram e como resolveu
- Stack e ferramentas usadas
- Métricas reais (latência, accuracy, tempo economizado, custo) — só se existirem nos dados
- Aprendizado não-óbvio

**Se o dia teve nada de relevante técnico:** avisa "Dia sem material shareable. Pulando." e encerra.

# Passo 4 — Carregar style guide

Lê `C:/Users/olive_/.claude/style-guide-x.md` completo. Segue rigorosamente.

# Passo 5 — Gerar conteúdo

## SEMPRE (todo dia): 3 short posts candidatos

Cada short post:
- **1-3 tweets** (pode ser tweet único ou par)
- ≤ 250 chars por tweet
- Categoria: build update, lesson, observação técnica, gotcha
- Tom direto, sem hype, sem emoji spam
- Cada um deve funcionar sozinho — sem depender de contexto da thread
- Baseado em fatos concretos do dia (sem inventar métrica)

**Ângulos a explorar nos 3 candidatos:**
- Candidato 1: algo que foi FEITO (build update com resultado)
- Candidato 2: algo que foi APRENDIDO ou DESCOBERTO (gotcha, insight técnico)
- Candidato 3: algo que FOI DIFÍCIL / levou tempo inesperado (relatable)

## DIA DE THREAD (Seg / Qua): também gera 1 thread completa

Thread pra postar HOJE:
- 4-7 tweets
- Ângulo mais rico do dia ou da semana
- Segue estrutura completa do style guide (hook → corpo → CTA soft)
- Anonimiza cliente/empregador

## DIA DE SHORT POST (outros dias): thread vai pro banco

Gera 1 thread candidata mas marca como `[BANCO — não postar hoje]`. Ela vai pra seção separada no Notion.

# Passo 6 — Escrever no Notion

Usa Notion MCP.

## 6a. Página diária

1. Busca página `📤 Fila X — Drafts diários` (ID: 34f5a07b-66eb-811e-aafb-f8fe4d2ad993)
2. Cria sub-página `📤 {DATA}` com estrutura:

```
# 📤 {DATA} — {dia da semana} — {THREAD DAY / SHORT POST DAY}

## Short Posts (postar hoje ou amanhã)

### Candidato 1 — {categoria}
**Tweet:** {conteúdo}
[se tiver 2 tweets: Tweet 2 também]

### Candidato 2 — {categoria}
...

### Candidato 3 — {categoria}
...

---

## Thread Candidata — {título ângulo}
{DIA DE THREAD: "Postar HOJE" | DIA DE SHORT POST: "[BANCO — aguardando dia de thread]"}

**Tweet 1:** {hook}
**Tweet 2:** ...
...
**Tweet N:** {CTA}

---

## 📋 Notas internas (NÃO publicar)

### Resumo do dia técnico
{prosa, ~5-10 linhas}

### Sessões processadas
- {projeto} — {1 linha}

### Commits
- {repo}: {N commits}

### Tasks Todoist completadas
- {task}

### Métricas reais disponíveis (preencher antes de postar se quiser fortalecer)
{lista de métricas presentes nos dados que podem enriquecer os posts}
```

## 6b. Banco de Threads (apenas em dias de SHORT POST)

1. Busca ou cria página `📥 Banco de Threads` dentro de `📤 Fila X — Drafts diários`
2. Adiciona a thread candidata do dia com título `[{DATA}] {título da thread}`
3. Banco é usado nas segundas e quartas para escolher a melhor thread da semana

# Passo 7 — Output no terminal

```
📅 {data} — {dia da semana} — {THREAD DAY / SHORT POST DAY}

✅ Conteúdo gerado e salvo em Notion → 📤 Fila X → 📤 {data}

Resumo:
- Sessões processadas: {N}
- Commits: {N}
- Tasks completadas: {N}

Short posts gerados: 3 candidatos
Thread: {título} ({DIA DE THREAD: "pra postar hoje" | "salva no banco"})

Próxima ação: abrir Notion, revisar short posts, escolher 1-2 pra postar hoje.
```

# Regras de privacidade

- NUNCA publicar nome de cliente, empresa, funcionário, código proprietário literal
- Métricas genéricas OK (latência, accuracy, custo unitário)
- Se dúvida: omite. Usuário revisa antes de postar.

# Regras de execução

- Notion MCP com erro → instrui `/mcp` pro usuário
- Todoist down → continua sem ele
- Sem sessões do dia → avisa e gera só com commits + Todoist
- `--dry-run` → mostra no terminal, não escreve no Notion

# Argumentos

`$ARGUMENTS`:
- `YYYY-MM-DD` → processa data específica
- `--dry-run` → sem Notion, só terminal
- (vazio) → hoje, escreve no Notion
