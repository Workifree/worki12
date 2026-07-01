---
name: reference_supabase_cli_windows
description: "Supabase CLI no Windows — binário em ~/.supabase-cli, npm não funciona, rede IPv6 flaky"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 1caae7ba-bddb-499e-8cef-6c8d1e2b7b73
---

Supabase CLI neste Windows: binário em `C:\Users\olive_\.supabase-cli\supabase.exe` (v2.102.0+). O pacote npm `supabase` NÃO funciona no Windows ("No matching Supabase CLI binary package found for win32-x64"). Baixado direto de `github.com/supabase/cli/releases/latest/download/supabase_windows_amd64.tar.gz`, extraído com tar.

Projeto `mommabot` (jaumyfyeueayibbxunxc) já está LINKADO e autenticado (token de conta presente, login OK).

**Comandos úteis:**
- `supabase db query --file <path.sql> --linked` — roda SQL no banco remoto (Management API)
- `supabase db query "<sql>" --linked --output json` — query inline
- `supabase functions deploy <fn> --project-ref jaumyfyeueayibbxunxc [--no-verify-jwt]`
- `supabase projects api-keys --project-ref jaumyfyeueayibbxunxc` — pega anon/service_role keys

**CRÍTICO — rede IPv6 flaky:** chamadas à Management API (api.supabase.com via IPv6 → Cloudflare) falham com "An existing connection was forcibly closed by the remote host" (wsasend/wsarecv) de forma intermitente. SEMPRE envolver deploy/query num loop de retry (5-6 tentativas, sleep 3-4s). Falha não é do comando — é transiente. Detectar com regex `forcibly closed|wsasend|wsarecv|failed to initialise`.

Edge functions chamadas via PowerShell mostram warnings "RemoteException"/"Loading config override" no stderr — isso é só o stderr sendo capturado, NÃO é erro. Sucesso = output contém "Deployed Functions".
