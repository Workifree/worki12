#!/usr/bin/env bash
# .harness/init.sh — Worki: bootstrap/smoke do ambiente de desenvolvimento do harness
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "=== Worki harness — init ==="

echo "[1/4] Instalando dependências do frontend..."
( cd frontend && npm install )

echo "[2/4] Verificando Gemini (usado só pelo harness-frontend-builder)..."
if command -v gemini >/dev/null 2>&1; then
  if [ -n "${GEMINI_API_KEY:-}" ] || [ -f scripts/.gemini-key ] || ( [ -f .env ] && grep -q '^GEMINI_API_KEY=' .env ); then
    echo "  OK — CLI gemini presente + chave configurada."
  else
    echo "  AVISO — chave Gemini ausente. Configure GEMINI_API_KEY / scripts/.gemini-key / .env."
    echo "          Sem ela o harness-frontend-builder cai no fallback Claude."
  fi
else
  echo "  AVISO — CLI 'gemini' não encontrado (npm install -g @google/gemini-cli)."
  echo "          Sem ele o harness-frontend-builder cai no fallback Claude."
fi

echo "[3/4] Smoke de lint..."
( cd frontend && npm run lint --silent ) || echo "  (lint reportou problemas — revisar)"

echo "[4/4] Smoke de build (type-check)..."
( cd frontend && npm run build ) && echo "  build OK" || echo "  (build falhou — revisar antes de desenvolver)"

echo
echo "=== init concluído ==="
echo "Dev server: cd frontend && npm run dev   (porta 5173)"
echo "Pipeline:   peça uma feature/fix/refactor ao Claude Code (ver CLAUDE.md)"
