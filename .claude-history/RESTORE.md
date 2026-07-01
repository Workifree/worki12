# Backup do histórico do Claude Code

Backup de `~/.claude` (deste PC) para migrar para o PC novo — inclui o
histórico de conversas de **TODOS os projetos** (para o `/resume`) + config.

**NÃO** contém credenciais (`.credentials.json`, `*.dpapi`) nem caches —
essas você refaz logando de novo no PC novo (`claude` → login).

## O que tem aqui

| Pasta/arquivo | O que é |
|---|---|
| `projects/` | **O principal.** Transcripts `.jsonl` de cada sessão = o que o `/resume` lê. Uma subpasta por projeto. |
| `sessions/` | Índice/metadados das sessões. |
| `history.jsonl` | Histórico de prompts digitados. |
| `commands/`, `skills/` | Slash-commands e skills customizados. |
| `plans/`, `tasks/` | Planos e tasks salvos. |
| `settings.json`, `settings.local.json` | Config do Claude Code (permissões etc). |

## Como restaurar no PC novo

1. Instale o Claude Code e faça login (`claude` → ele cria `~/.claude` e as credenciais).
2. Copie o conteúdo daqui para `~/.claude`:
   - `projects/` → `~/.claude/projects/`
   - `sessions/` → `~/.claude/sessions/`
   - `history.jsonl`, `settings*.json` → `~/.claude/`
   - `commands/`, `skills/` → `~/.claude/`

   PowerShell (assumindo o repo clonado em `$repo`):
   ```powershell
   $h = "$env:USERPROFILE\.claude"
   robocopy "$repo\.claude-history\projects" "$h\projects" /E
   robocopy "$repo\.claude-history\sessions" "$h\sessions" /E
   Copy-Item "$repo\.claude-history\history.jsonl"  $h -Force
   Copy-Item "$repo\.claude-history\settings*.json" $h -Force
   robocopy "$repo\.claude-history\commands" "$h\commands" /E
   robocopy "$repo\.claude-history\skills"   "$h\skills"   /E
   ```

## ⚠️ IMPORTANTE: caminhos diferentes = renomear as pastas de `projects/`

O `/resume` só acha as sessões se o **nome da pasta** dentro de `projects/`
bater com o **caminho absoluto** do projeto no PC novo.

**Regra de codificação:** o Claude pega o caminho absoluto e troca **todo
caractere que não seja letra/número por `-`**.

Exemplo (este PC):
```
Caminho:  C:\Users\olive_\OneDrive\Documentos\codigo\worki\worki12
Pasta:    C--Users-olive--OneDrive-Documentos-codigo-worki-worki12
          ^^      ^     ^^
          C: -> C-   \ -> -   _ -> -
```

No PC novo, se o projeto ficar noutro caminho (ex.:
`C:\Users\NOVO\Documentos\codigo\worki\worki12`), **renomeie a pasta**
correspondente em `~/.claude/projects/` para o novo código
(`C--Users-NOVO-Documentos-codigo-worki-worki12`). Aí o `/resume` funciona.

> Dica pra descobrir o código certo no PC novo: abra o Claude dentro do
> projeto uma vez — ele cria a pasta com o nome/código correto em
> `~/.claude/projects/`. Copie os `.jsonl` deste backup para dentro dela.
