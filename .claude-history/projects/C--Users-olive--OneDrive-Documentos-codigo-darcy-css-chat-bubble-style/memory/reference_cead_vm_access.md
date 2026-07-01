---
name: cead-vm-access-layout
description: "Como acessar o VM cead (host self-hosted do Darcy) e como o stack está montado lá — SSH em porta não-padrão, deploy atual, exposição via Tailscale"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 66c95ba9-d202-4168-9a7a-c5293a041c9a
---

O **cead** é o VM Linux onde roda o Darcy self-hosted (o destino do `darcy-local`).

**Acesso SSH (descoberto 2026-05-29):** o sshd NÃO está na 22 (recusa) — está na **porta 13508**.
```
ssh -p 13508 -i <repo>/darcy-local/darcy_vm_key darcy@100.91.60.71
```
- Tailscale IP: `100.91.60.71` (device "cead", Ubuntu 22.04.1, kernel 5.15).
- Usuário **`darcy`**: está no grupo **docker** (gerencia containers sem sudo), mas **sudo PEDE SENHA** (login é só por chave; não temos a senha do darcy).
- Chave: `darcy-local/darcy_vm_key` (no repo, gitignored). `~/.ssh/config` do Windows tem um **BOM na linha 1** que quebra o ssh — use `-F /dev/null` ou conserte o BOM.

**Stack atual (ANTIGO):** Supabase CLI local em Docker, projeto **`darcy-test`** em **`/home/darcy/darcy-test`** (NÃO é repo git). 11 containers `supabase_*_darcy-test`. Tem o conjunto VELHO de functions (Lovable: check-subscription/create-checkout/customer-portal/generate-*/darcy-chat-web) e só 9 migrations; `project_id` ainda aponta pro ref cloud. Supabase CLI **v2.48.3** em /usr/local/bin; Node v20.

**Exposição pública (como o Moodle/dashboard chegam):** **Tailscale Funnel/Serve**, não cloudflared:
`sudo tailscale serve --https=443 http://localhost:54321` (kong/API) e `--https=8443 http://localhost:54323` (Studio). Por isso o 443 do cead é TLS (não SSH).

**Canal alternativo de exec (sem shell):** Postgres superuser `supabase_admin`/`postgres` em `100.91.60.71:54322` → `COPY FROM PROGRAM` roda comandos DENTRO do container do banco (uid 101, sem docker.sock, isolado do host). Útil só pra DB.

**Atalho SSH (2026-05-29):** `~/.ssh/config` já tem `Host cead` (HostName 100.91.60.71, Port 13508, User darcy, IdentityFile ~/.ssh/darcy_vm_key) — o BOM que quebrava o ssh foi removido. Então basta `ssh cead`.

**MCP Desktop Commander (2026-05-29):** instalado no cead em `~/.npm-global/lib/node_modules/@wonderwhy-er/desktop-commander/dist/index.js` e registrado no Claude Code como **`cead-commander`** (`ssh cead node <path>`), status Connected. Para futuros acessos a cead via MCP. (Ao rodar `claude mcp add` do git-bash, use `MSYS_NO_PATHCONV=1` senão ele mangla o /home/... pra C:/Program Files/Git/...).

**DEPLOY FEITO (2026-05-29):** o darcy-local NOVO substituiu 100% o antigo. Stack `darcy-local` no ar (9 containers; realtime/analytics/vector DESLIGADOS no config.toml p/ leveza). Antigo `darcy-test` removido (backup em `~/_backup_old`: db 306M + dir 57M). Funnel segue `https://cead.taild0c94.ts.net` → kong 54321. widget.js rebuildado com a URL do Funnel e no bucket `ativos`. Secrets no edge-runtime OK.
Dois bugs de migration corrigidos no repo (precisam de push): `20251001000000_base_pii_tables.sql` (cria users/chat_sessions/messages/etc. ANTES — senão fresh DB falha) e renomeação dos 5 `20260526_*` p/ versões únicas `20260526000001..5` (colisão de pkey schema_migrations).

**RESOLVIDO (2026-05-29):** Darcy responde ponta a ponta pelo Funnel (`https://cead.taild0c94.ts.net/functions/v1/darcy-chat` → resposta real, model nvidia/nemotron-3-nano-30b-a3b:free). A key antiga estava revogada; o usuário forneceu uma key OpenRouter NOVA (de TESTE, "deletaremos depois") que está em `~/darcy-local/supabase/functions/.env`. ATENÇÃO: por ser de teste e SEM créditos, (a) será deletada → vai voltar a dar 401, e (b) os modelos :free têm rate-limit baixo sem ≥US$10 de crédito. Para produção: key permanente + créditos. Para trocar a key: editar functions/.env, `set -a; . functions/.env; set +a`, e RECRIAR o edge-runtime — `docker restart` NÃO basta (env é fixado na criação); o jeito que funcionou foi `npx supabase@2.101 stop && start` (um `start` com o stack já no ar NÃO recria container removido). Ver [[darcy-local-self-hosted-mirror]].

**Cuidado operacional:** `supabase start` via npx 2.101 com TODOS os serviços já derrubou o cead 1x (instável no pico de subida apesar de 17GB RAM). Mantenha o config enxuto. (Update: a queda de rede foi REBOOT manual, não OOM — cead tem 17GB livres.)

**TOPOLOGIA DE REDE (2026-06-01):** cead é uma **VM** (interface `192.168.122.57/24` = libvirt/KVM) atrás do **gateway UnB `164.41.168.25`** (egress NAT `164.41.168.7`). O DNS público **`darcy.cead.unb.br` → A `164.41.168.25`**. O gateway faz **port-forward** pro cead: **13508 (SSH) e 80 já encaminhados; 443 NÃO** (UnB precisa adicionar). DÁ PRA ENTRAR NO CEAD PELO IP PÚBLICO: `ssh -p 13508 darcy@164.41.168.25` (mesma chave) — útil quando o Tailscale dele cai. Supabase só escuta local/tailscale (54321/54323 não expostos publicamente). `sudo` do darcy PEDE SENHA (não temos) — mas darcy está no grupo **docker**.

**NO AR EM PRODUÇÃO (2026-06-09):** domínio público final = **`https://tutordarcy.cead.unb.br`** (NÃO mais darcy.cead.unb.br — esse morreu). 443 liberada pela UnB. Verificado de fora ponta a ponta: widget-loader 200 (cert válido), darcy-chat responde com LLM, avatar 200; bloqueados Studio/rest/dashboard-api/ = 404; http→301→https. Apache vhost ServerName+cert = tutordarcy (cert em /etc/letsencrypt/live/tutordarcy.cead.unb.br/, criado pela UnB). Widget rebuildado p/ tutordarcy, WIDGET_VERSION=20260609-v29-tutordarcy. Snippet Moodle: `<script src="https://tutordarcy.cead.unb.br/functions/v1/widget-loader" async defer></script>`.
TODOS os 9 containers agora têm `restart=unless-stopped` (docker update) — sobrevivem reboot. ARMADILHA RESOLVIDA: após um reboot da VM, o edge-runtime ficava EXITED 137 e NÃO voltava (restart=no) → widget-loader/darcy-chat davam 500 ("early termination/wall clock" no log). Fix imediato: `docker start supabase_edge_runtime_darcy-local`. SUPABASE_URL interno do edge = http://kong:8000 (correto, não mexer).

**(histórico) ARQUITETURA PÚBLICA — FEITA (Caminho A, 2026-06-01):** proxy Apache no cead em `https://darcy.cead.unb.br` (443/SSL Let's Encrypt) com ALLOWLIST funcionando (testado): liberados widget-loader/darcy-chat/analytics/chat-sessions/darcy-controls/darcy-voice + /storage/v1/object/public/ (200); bloqueados Studio /project, /rest, /auth, dashboard-api, / (404). Vhost ativo `/etc/apache2/sites-enabled/darcy-public.conf` (fonte: `~/deploy/darcy-public.conf` e repo `darcy-local/deploy/cead/`). Tailscale Funnel DESLIGADO (`tailscale serve reset`) — ele expunha TODO o :54321 publicamente (furava a allowlist) e ocupava a 443; admin agora é só pela MESH do Tailscale (Studio = http://100.91.60.71:54323). Widget rebuildado p/ darcy.cead.unb.br, no Storage, WIDGET_VERSION=20260601-v28-cead-domain. **SÓ FALTA (UnB, já pedido): encaminhar 443 público (164.41.168.25)→cead:443.** A 80 já valida o cert (renovação automática via certbot.timer + webroot). SEM SUDO: tudo feito via Docker-as-root → `docker run --rm --privileged --pid=host --net=host -v /:/host --entrypoint chroot public.ecr.aws/supabase/vector:0.53.0-alpine /host /bin/bash -c '<cmd root no host>'` (estou no grupo docker). Apache NÃO aceita comentário inline (#) na mesma linha de diretiva.

**(histórico) ARQUITETURA PÚBLICA (Caminho A, em montagem 2026-06-01):** só widget+chat público via `https://darcy.cead.unb.br` (Apache proxy 443/SSL → kong 54321, allowlist); Studio/dashboard/REST/auth ficam SÓ via Tailscale. PROBLEMA ACHADO: o Apache atual (`/etc/apache2/sites-enabled/supabase.conf`) proxava `darcy.cead.unb.br:80 → Studio:54323` = **Studio exposto publicamente** (corrigir!). Preparei em `~/deploy/` do cead (e no repo `darcy-local/deploy/cead/`): `darcy-public.conf` (vhost allowlist: widget-loader/darcy-chat/analytics/chat-sessions/darcy-controls/darcy-voice + /storage/v1/object/public/; resto→404) e `setup-public-proxy.sh` (habilita mods, certbot webroot, troca o vhost). FALTA (handoff): (1) rodar `sudo bash ~/deploy/setup-public-proxy.sh` como root, (2) UnB encaminhar 443 público→cead:443 no gateway. Cutover do widget (rebuild p/ darcy.cead.unb.br) só DEPOIS do 443 vivo — até lá segue no Funnel `cead.taild0c94.ts.net`.
