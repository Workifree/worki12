---
name: vercel-deploy-setup
description: How to deploy the Worki frontend to production on Vercel (which project/dir/command)
metadata: 
  node_type: memory
  type: reference
  originSessionId: 98060c87-966d-4ef2-bc2b-dd2df5248486
---

Deploy the Worki frontend to production with:
`npx vercel --prod --cwd frontend --yes` (run from repo root; logged in as oliveira9138).

Gotcha: there are TWO linked Vercel projects.
- `frontend/.vercel` → project **"worki"** — this is the REAL production app, aliased to **https://worki-opal.vercel.app**. Deploy from here.
- root `.vercel` → project "worki12" — secondary/stray, do NOT use for the live site.

The Vite app + `vercel.json` (SPA rewrites) live in `frontend/`. Env vars (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) are configured in the Vercel "worki" project. The Asaas edge-function CORS allowlist must include `https://worki-opal.vercel.app` (see [[agentic_infrastructure]] context / `supabase/functions/_shared/asaas.ts`).
