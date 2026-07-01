---
name: reference-supabase-logs-management-api
description: Como puxar logs reais de edge function da Momma sem o MCP (Management API + token do Windows Credential Manager)
metadata: 
  node_type: memory
  type: reference
  originSessionId: dec447be-d0a9-4350-8379-40cb7187cd6c
---

O supabase-mcp-server descrito no system prompt **nem sempre está conectado** (em várias sessões só o MCP do Todoist aparece). Para ler logs reais de edge function sem o MCP:

1. **Token de Management API**: o supabase CLINão expõe em env. Está no Windows Credential Manager, target `Supabase CLI:access-token` (blob UTF-8, formato `sbp_…`, 44 chars). Ler via P/Invoke `advapi32!CredRead` em PowerShell (decodificar como UTF-8, NÃO UTF-16). `cmdkey /list | Select-String supabase` mostra os targets.
2. **Logs**: `GET https://api.supabase.com/v1/projects/{ref}/analytics/endpoints/logs.all?sql=<urlenc>&iso_timestamp_start=…&iso_timestamp_end=…` com `Authorization: Bearer <token>`. A janela default é minúscula (~minutos) — sempre passar iso_timestamp_start/end.
3. **Fontes (FROM da SQL, estilo BigQuery)**: `function_edge_logs` = boundary HTTP (METHOD|STATUS|URL, `metadata.request[].url`, `metadata.response[].status_code`, `execution_time_ms`); `function_logs` = **saída de console do Deno** (console.log/warn/error, ex.: linhas `[AI] {...}`); `edge_logs` = gateway PostgREST. console.log de função fica em `function_logs`, NÃO em function_edge_logs.

Refs: PROD mommabot=`jaumyfyeueayibbxunxc`, STG mommaerp-staging=`ofgjllzbxrydhkrfnhan` (o `supabase/.temp/project-ref` aponta pro linkado=stg). CLI binário em `~/.supabase-cli/supabase.exe` (ver [[reference_supabase_cli_windows]]). Pega quente para [[project_requisicao_manual_streaming_landmine]] e [[project_openrouter_model_slugs_deprecate]].
