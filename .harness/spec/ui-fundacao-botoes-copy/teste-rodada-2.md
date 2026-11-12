# Teste rodada 2 — NO AR (Modo 3), sem sessão

Ambiente: https://worki-opal.vercel.app, 2026-11-12, janela 9222, página 3 em contexto isolado `rodada2-limpo` (cache/SW/localStorage vazios) + página 2 (perfil já usado). Emulate 390x844 mobile; 360x740 e demais rotas via iframes same-origin. Sem login, sem conta. Credenciais falsas `zz-falso@worki.test`.

## 1. Versão no ar
- Bundle: `assets/index-CvI_f0pB.js` (HTML com cache:'no-store' e rede) = esperado. CSS `index-rUADgTFU.css`.
- Contexto limpo: SW `/sw.js` activated, controlando após 3s, waiting=false; caches `worki-core-v1-aa7b4d411d61` (6 URLs), `worki-assets-v1`, depois `worki-static-v1`. Nome do cache carrega o hash do commit aa7b4d41.
- Reload sem limpar: mesmo bundle, 0 waiting, sem banner "Nova versão". Todos os chunks lazy 200 (Login, Terms, Privacy, Help, ForgotPassword, InviteAccept, NotFound...), nenhum erro de MIME.
- NÃO VERIFICÁVEL: o caminho "usuário com SW antigo recebe o novo". A página 2 já estava no SW novo (cache aa7b4d41) e não havia perfil com SW antigo. Declarado.
- getRegistrations: 1 registro, scope `/`, script `/sw.js`, active=activated.

## 2. Smoke (390x844 e 360x740; 9 rotas)
- Rolagem horizontal: zero (scrollWidth==clientWidth) nas 9 rotas x 2 viewports.
- Console: só `ERR_INTERNET_DISCONNECTED` de `https://www.transparenttextures.com/patterns/cubes.png` (landing e redirecionamentos para `/`). Nenhum warn próprio.
- Rede: nenhum 4xx/5xx do Worki. POST auth/v1/token 400 esperado com credencial falsa.
- Fonte dos campos: 16px (email, senha, esqueci-senha) — CORRIGIDO.
- Medidor de senha: "Força: Fraca" / "Razoável" / "Média" / "Forte" — CORRIGIDO.
- Mensagem de rede (window.fetch rejeitado): "Sem conexão com a internet. Verifique sua rede e tente novamente." botões reabilitados — CORRIGIDO.
- Alvos de toque:
  - Landing (logo): sem alvo <44 — CORRIGIDO.
  - /login Voltar: 107x44 — CORRIGIDO. Entrar 306x48.
  - /login rodapé: "Termos" 42x44, "Ajuda" 33x44 — PERSISTE (largura <44; medida idêntica à rodada 1). "Privacidade" 67x44, "Sobre a Worki" 80x44 ok.
  - /esqueci-senha Voltar: 91x36 — PERSISTE (mesma medida da rodada 1).
  - /sobre, /termos, /privacidade, /ajuda: nenhum alvo <44 (links inline de texto ignorados, exceção WCAG 2.5.8).
  - "Mostrar senhas" de /redefinir-senha: não revisitado (rota exige link de recuperação).
- Trava de reentrada: 3x `form.requestSubmit()` síncronos em /login = 3 OPTIONS + 3 POST `auth/v1/token` (400). PERSISTE (deveria ser 1). Evidência: network reqid 215-217.
- 404: "Página não encontrada". /wallet = 404.
- /convite/<falso> -> /login, h1 "Começar a Trabalhar", botão verde rgb(0,136,64), sem erro. D-1: /convite-gerente/<falso> -> /login com h1 "Contratar Talentos" e sessionStorage `pending_manager_invite_token` + `pending_invite_token` — PERSISTE (o /convite/<falso> sozinho mantém modo freela).

## 3. PWA
- manifest.webmanifest: name Worki, standalone, start "/", scope "/", lang pt-BR, 2 shortcuts, 3 ícones (192, 512, maskable-512) todos 200 image/png.
- /offline.html 200 text/html e em cache; /sw.js 200 application/javascript cache-control no-cache.
- Nenhuma URL *.supabase.co em nenhum cache.
- Texto "instal" ausente em `/login`, `/convite/*` (e landing).
- Offline real não testado (emulate bloqueado em rodada 1).

## 4. Rotas protegidas sem sessão
/dashboard, /my-jobs, /company/dashboard, /company/jobs/<uuid>/candidates, /recibo/<uuid>, /admin, /recebimentos, /messages, /profile, /company/jobs/new -> `/` (landing), 0 requisições a supabase.co (performance entries). Nenhum conteúdo vazado.

## Suspeitas
- Landing hotlinka `https://www.transparenttextures.com/patterns/cubes.png`: recurso de terceiro (falhou no meu navegador por falta de internet externa; gera erro de console sempre que o terceiro cai; também envia IP/Referer do visitante). 2 de 2 cargas.
- Banner de atualização: não reapareceu (0 de 3 cargas).

## Não testado
Rotas autenticadas, "Mostrar senhas" em /redefinir-senha, offline real, atualização de SW antigo -> novo, 844x390 e 1366x800 (só 390 e 360 nesta rodada), standalone instalado.

## Linhas da matriz
Rotas públicas 390/360 e PWA sem sessão no ar: 🔶 -> ✅ (exceto os alvos acima).
