#!/usr/bin/env bash
# scripts/gemini-dispatch.sh — Worki dispatcher para o Gemini CLI
#
# Gemini 3 é usado EXCLUSIVAMENTE para construção de frontend (UI React/TSX) — é o melhor
# nisso e foi o que construiu o frontend do Worki até agora. Todo o resto do harness roda em
# Claude. Este script é chamado pelo subagent `harness-frontend-builder`.
#
# CHAVE: este script NÃO contém a API key em plaintext. Ele lê GEMINI_API_KEY do ambiente.
# Configure de UMA destas formas (a primeira encontrada vence):
#   1. export GEMINI_API_KEY="..."                         (shell / CI)
#   2. arquivo scripts/.gemini-key  com a chave numa linha  (gitignored — ver .gitignore)
#   3. arquivo .env na raiz com  GEMINI_API_KEY=...
# Gere a chave em https://aistudio.google.com/apikey
#
# Uso:
#   bash scripts/gemini-dispatch.sh "prompt único"
#   echo "input" | bash scripts/gemini-dispatch.sh "prompt"          # stdin vira contexto
#   MODEL=gemini-3-pro-preview bash scripts/gemini-dispatch.sh "..."  # override do modelo
#
# Modelo (env MODEL): default = gemini-3-pro-preview. Ajuste o slug conforme o modelo Gemini 3
# disponível na sua conta (ex.: gemini-3-pro-preview, gemini-3.1-pro-preview).

set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

# --- gemini CLI obrigatório ---
if ! command -v gemini >/dev/null 2>&1; then
  echo "[ERROR] gemini CLI não encontrado. Instale com:" >&2
  echo "  npm install -g @google/gemini-cli" >&2
  exit 127
fi

# --- GEMINI_API_KEY é OPCIONAL ---
# O Gemini CLI pode estar autenticado via login Google (OAuth) — nesse caso NÃO precisa de API key.
# Só resolvemos/exportamos a chave se ela existir; caso contrário, deixamos o CLI usar a própria auth.
if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  if [[ -f scripts/.gemini-key ]]; then
    GEMINI_API_KEY="$(head -n1 scripts/.gemini-key | tr -d '[:space:]')"
  elif [[ -f .env ]] && grep -q '^GEMINI_API_KEY=' .env; then
    GEMINI_API_KEY="$(grep '^GEMINI_API_KEY=' .env | head -n1 | cut -d= -f2- | tr -d '"'\''[:space:]')"
  fi
fi
[[ -n "${GEMINI_API_KEY:-}" ]] && export GEMINI_API_KEY

MODEL="${MODEL:-gemini-3-pro-preview}"

# --- montar prompt (arg + stdin) ---
if [[ ! -t 0 ]]; then STDIN_BUF="$(cat)"; else STDIN_BUF=""; fi
PROMPT="${1:-}"

if [[ -z "$PROMPT" && -z "$STDIN_BUF" ]]; then
  echo "[ERROR] precisa de prompt como arg ou via stdin" >&2
  exit 2
fi

if [[ -n "$STDIN_BUF" && -n "$PROMPT" ]]; then
  FULL="${PROMPT}"$'\n\n---CONTEXT---\n'"${STDIN_BUF}"
elif [[ -n "$STDIN_BUF" ]]; then
  FULL="$STDIN_BUF"
else
  FULL="$PROMPT"
fi

# Headless OBRIGATÓRIO: sem -p o gemini abre modo interativo e trava.
# --approval-mode plan = read-only: o Gemini NÃO escreve no repo (quem grava é o harness-frontend-builder);
#   também evita travar pedindo aprovação de tool em modo headless.
# O prompt completo vai via stdin; o -p adiciona a diretiva final de formato (é "appended to stdin").
printf '%s' "$FULL" | gemini -m "$MODEL" -o text --approval-mode plan \
  -p "Responda seguindo EXATAMENTE o formato pedido acima (cada arquivo como // FILE: <path> seguido do bloco de código completo). Apenas os arquivos, sem comentários extras."
