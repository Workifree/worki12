# Teste rodada 1 — ui-fundacao-botoes-copy (SEM SESSÃO)

Ambiente: http://localhost:4173, bundle `assets/index-yMNb38LL.js` (confere com `/` no-store), Supabase prod. 2026-11-12. Janela 9222 (página 5), emulate 390x844 mobile; demais viewports via iframes same-origin (390/360/844x390/1366x800). Sem login, sem criar conta.
Offline real via `emulate` NÃO funcionou ("Network throttling is not supported when network blocking is configured"); na tela de login simulei falha sobrescrevendo `window.fetch` (simulação, declarada).

## Defeitos

### D-1 · MÉDIO · Token de convite inexistente fixa /login em modo "empresa" pela sessão inteira
- Oráculo: expectativa do usuário / inconsistência interna.
- Passos: 1) abrir `/convite-gerente/00000000-nao-existe` (ou `/convite/...`) -> vai para /login. 2) Navegar para `/login` direto (ou outra aba/rota pública e voltar).
- Obtido: h1 "Contratar Talentos" e botão "Entrar" preto, mesmo sem convite válido; `sessionStorage` guarda `pending_manager_invite_token` e `pending_invite_token`. Após `sessionStorage.clear()` + reload: h1 "Começar a Trabalhar", botão verde rgb(0,136,64).
- Esperado: token que não existe/expirou não deve alterar o papel do login depois; ou limpar o token ao detectar inválido.
- Suspeita: Login.tsx / inviteToken.ts / managerInviteToken.ts (leitura de sessionStorage sem validar).

### D-2 · BAIXO · Copy sem acento: "Forca: Fraca/Media"
- Cadastro (/login > Cadastre-se), medidor de senha: texto "Forca: Fraca", "Forca: Media".
- Origem: `frontend/src/pages/Login.tsx:309`, `frontend/src/pages/company/CompanyProfile.tsx:838` ("Forca"), `frontend/src/lib/validation.ts:101` ("Media"). Testes em validation.test.ts / ResetPassword.test.tsx assertam "Fraca" (ok), cuidado ao mudar "Media".

### D-3 · BAIXO · handleSubmit do login sem trava de reentrada
- 3x `form.requestSubmit()` síncrono em /login -> 3 POST `auth/v1/token` (delta 3). Duplo clique real: 1 POST (botão fica disabled/busy). Enter x3 em chamadas separadas: 3 POST (cada um resolveu antes).
- Impacto baixo (login idempotente), mas o mesmo padrão em telas que gravam seria duplicação. Suspeita: Login.tsx:103 sem `if (loading) return`.

### D-4 · MÉDIO · Alvos de toque <44px (zona do polegar, mobile)
- Botão "Voltar" 91x36 (/login, /esqueci-senha, /termos etc.); "Mostrar senhas" 155x36 (/redefinir-senha); link/logo "Worki" 69x32 em /sobre; links "Termos" 42x44 e "Ajuda" 33x44 no rodapé do /login (largura <44); links inline de e-mail/Política nos Termos/Privacidade 16px de altura (inline em texto — exceção WCAG 2.5.8, só nota).
- Oráculo: design-system "Escala refinada" alvo >=44px.

### D-5 · BAIXO · Inputs com fonte 14px (login)
- Email/Senha `font-size:14px` -> iOS Safari dá zoom automático ao focar (<16px). Altura 44 ok.

### D-6 · BAIXO · Erro de rede genérico no login
- Falha de fetch (simulada): alerta "Erro ao fazer login. Tente novamente." — em português, botão reabilita, sem sucesso falso; mas não diz que é conexão.

### D-7 · BAIXO · Vocabulário da landing varia
- "Para freelancers", "Cadastrar como Trabalhador", "Quero trabalhar" convivem com "freela/freelas" (glossário). Sem ocorrência de "cliente" em nenhuma rota pública.

## Suspeitas
- Banner "Nova versão disponível / Atualizar / Depois" apareceu em `/` com bundle idêntico ao no ar e `registration.waiting=false`; após reload (1 tentativa) não reapareceu. Pode ser troca de SW legítima da 1ª carga; não reproduzi (1 de 2).
- Anon (anon key do bundle) em `rest/v1`: `notifications` e `wallets` respondem 200 com 0 linhas (SELECT concedido a anon, RLS filtrando); demais tabelas 401/42501. Sem vazamento observado; GRANT desnecessário a anon = defesa em profundidade (não verificado se há linhas por trás).
- Título da aba fica "Worki — Trabalho freela..." por instantes após reload em /login antes de virar "Entrar — Worki".

## Sinais de saúde
- Zero rolagem horizontal (scrollWidth==clientWidth) em 11 rotas x 4 viewports. Zero botão/link/input sem nome. 1 h1 por página; hierarquia h1>h2>h3 ok. Sem `{{placeholder}}`.
- 404 correta ("Página não encontrada"); /wallet, /company/financeiro, /company/elenco = 404 (removidas, ok).
- Login: validação nativa pt-BR (vazio, e-mail sem @, senha <8), erro "Email ou senha incorretos." (400) em português, senha vai no corpo (URL só `grant_type=password`). Botão busy/disabled no duplo clique (1 POST).
- Tab: Voltar > Email > Senha > Entrar > Esqueci minha senha; foco visível via box-shadow 2px+4px. Link Ajuda navega por SPA (marcador `window.__m` sobreviveu; voltar retorna a /login).
- Intruso: /dashboard, /my-jobs, /company/dashboard, /company/jobs/<uuid>/candidates, /recibo/<uuid>, /admin, /recebimentos, /messages, /profile -> `/` (landing), 0 chamadas Supabase, sem conteúdo.
- PWA: manifest ok (standalone, start/scope "/", pt-BR, 2 shortcuts), 3 ícones 200 image/png (incl. maskable), SW `/sw.js` activated + controlando, `/offline.html` 200 e em cache; caches: worki-core, worki-assets, worki-static com 0 URLs *.supabase.co. Nenhum convite de instalação em `/`, `/login`, `/convite/*`, `/sobre` (texto "instal" ausente). Console: só info "Banner not shown: beforeinstallpromptevent.preventDefault()".
- Contraste: branco sobre verde #008840 (botão Entrar worker) = 4.57:1 (ok AA); branco sobre #00A651 seria 3.19 (falharia) — não usado nos botões medidos. Branco sobre #2563EB 5.17.

## Não testado
- Todas as rotas autenticadas (freela e empresa), fluxos bilaterais, modais, BottomNav, recibo real, link de elenco, aceite de convite com token VÁLIDO (token inexistente só redireciona ao login, sem tela de "convite inválido" visível sem sessão).
- Offline real do SW (casca/offline.html com rede cortada): emulate bloqueado. Banner de atualização forçado. Standalone/PWA instalado.
- Cadastro efetivo (não criei conta), reset de senha com link real (/redefinir-senha só renderizado), envio de /esqueci-senha (enviaria e-mail).
- Hover grudado (ambiente touch emulado), recarregar durante envio.
- Janela 9222 contém outras páginas de outro app (Yiews/5180); não toquei.

## Linhas da matriz que mudariam
Rotas públicas (/, /login, /termos, /privacidade, /ajuda, /sobre, /esqueci-senha, /redefinir-senha, 404) e Intruso-sem-sessão: para cobertas (🔶 -> ✅ nos 4 viewports); PWA sem-sessão coberto, offline real permanece ⬜.
