---
name: version-json-single-writer
description: "Circuito version.json/__APP_VERSION__ — único escritor é generate-version.js; vite.config só LÊ, senão banner Atualizar nunca some"
metadata: 
  node_type: memory
  type: project
  originSessionId: 23498de2-200e-4343-a910-4aa5b33c4d17
---

O banner "Atualizar" do `VersionUpdater.tsx` some quando `__APP_VERSION__` (baked no bundle) === `/version.json` servido. O circuito tem regra de **único escritor**: `scripts/generate-version.js` (roda no início de `npm run build`) é quem grava `public/version.json`; o `vite.config.ts` apenas **lê** o valor e o baka em `__APP_VERSION__`.

**Why:** em 2026-06-05 prod tinha bundle `1780673868269` e version.json `1780673927612` (59s de diferença) — o vite.config gravava `Date.now()` a cada load do config, e um load concorrente (dev server em outro terminal) reescrevia o arquivo no meio do build; a cópia `public/ → dist/` acontece no FIM do build e levava o valor errado. Mismatch permanente → banner voltava após cada "Atualizar". Histórico: commit `479137e3` ("botão não aparecia") foi fix de sintoma que plantou esse modelo gravador. Fix definitivo em `b492f448`.

**How to apply:** nunca reintroduzir escrita de `public/version.json` no `vite.config.ts` (só o fallback `dev-` quando o arquivo não existe). Unicidade por deploy vem do sufixo timestamp em `generate-version.js` (`v1.0.0-<hash>-<ts36>`). Pra diagnosticar mismatch em prod: comparar `momma-xi.vercel.app/version.json` com o literal baked no `assets/index-*.js`. Bug só morre em prod após redeploy (`npm run deploy:prod`).
