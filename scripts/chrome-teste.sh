#!/usr/bin/env bash
# Abre DOIS Chromes de teste com porta de depuracao, um por papel (o simulador de usuario dirige os dois).
#   9222 = EMPRESA  (perfil chrome-teste-empresa)   9223 = FREELA (perfil chrome-teste-freela)
# Perfis separados e sem conta pessoal: a sessao do Supabase fica no localStorage, entao um perfil = um papel.
# Uso: scripts/chrome-teste.sh [URL]   (padrao: o app em producao; passe http://localhost:4173 p/ preview local)
set -euo pipefail
URL="${1:-https://worki-opal.vercel.app/login}"
CHROME="${CHROME_BIN:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
BASE="${LOCALAPPDATA:-$HOME/.cache}/Worki"
mkdir -p "$BASE/chrome-teste-empresa" "$BASE/chrome-teste-freela"
abrir() { # porta perfil
  "$CHROME" --remote-debugging-port="$1" --user-data-dir="$(cygpath -w "$BASE/$2" 2>/dev/null || echo "$BASE/$2")" \
    --no-first-run --no-default-browser-check --window-size=430,900 "$URL" >/dev/null 2>&1 &
}
abrir 9222 chrome-teste-empresa
abrir 9223 chrome-teste-freela
sleep 4
for p in 9222 9223; do
  curl -s "http://127.0.0.1:$p/json/version" >/dev/null && echo "porta $p: OK" || echo "porta $p: NAO RESPONDEU"
done
echo "Faca login: janela 9222 -> e2e-empresa@worki.test ; janela 9223 -> e2e-worker@worki.test"
