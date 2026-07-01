---
name: Lab Momma — acesso remoto via MCP
description: PC Windows do lab (DESKTOP-HSGG8QB) é acessível por MCP HTTP/SSE pelo IP Tailscale 100.108.44.6, e via SSH pela mesma rede com chave ed25519
type: reference
originSessionId: 75772afc-6f32-4ef0-af65-31a021ab5d64
---
**Máquina alvo**: DESKTOP-HSGG8QB (Windows 10 22H2)
**Conta**: `lab. inovação momma` (admin local, com acentos no sAMAccountName)
**Rede**: Tailscale — IP do lab = `100.108.44.6`. Olive_ é `100.103.218.103`

## SSH (fallback / debug)
- Chave: `C:\Users\olive_\.ssh\lab_momma_ed25519`
- Pubkey instalada em `C:\ProgramData\ssh\administrators_authorized_keys` (conta admin)
- Alias em `~/.ssh/config`: `ssh lab-momma`
- Quoting de username com acento exige usar `ssh.exe` do OpenSSH (`C:\Windows\System32\OpenSSH\ssh.exe`); plink 0.83 corrompe UTF-8 do username

## MCPs remotos (canal preferido)
Configurados no Claude Code do olive_ (user scope):
- `windows-mcp-lab`: `http://100.108.44.6:8000/mcp` — transport HTTP (streamable-http). Windows-MCP v3.2.4. GUI control + UI Automation
- `desktop-commander-lab`: `http://100.108.44.6:8765/sse` — transport SSE. Desktop Commander wrappado por mcp-proxy. Filesystem + terminal

## Como o lab roda os servidores
- Scheduled Tasks (`schtasks` ONLOGON, RunLevel HIGHEST):
  - `MCP-WindowsMCP` → `C:\ProgramData\mcp\start-windows-mcp.ps1`
  - `MCP-DesktopCommander` → `C:\ProgramData\mcp\start-desktop-commander.ps1`
- Logs: `C:\ProgramData\mcp\*.log`
- Firewall rule: `MCP-Lab-Inbound` libera TCP 8000+8765 inbound em qualquer profile
- Stack instalada: `uv` (em `~/.local/bin`), Python 3.13.13, `mcp-proxy 0.11`, `@wonderwhy-er/desktop-commander` (npm global)

## Caveats
- Servidores rodam só com user logado (UI Automation precisa do desktop)
- DC baixa Chromium na 1a execução (~minutos)
- `$env:USERDOMAIN` retorna WORKGROUP, não o COMPUTERNAME — usar `$env:COMPUTERNAME\$env:USERNAME` se precisar do user qualificado
- PATH em sessão SSH é mínimo — chamar System32 utils via path absoluto ou setar `$env:Path`
- Sem auth nos MCPs (Tailscale single-user). Adicionar bearer token se compartilhar tailnet
