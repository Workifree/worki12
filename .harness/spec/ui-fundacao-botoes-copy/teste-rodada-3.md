# Teste rodada 3 — RETESTE em produção (sem sessão)

Ambiente: https://worki-opal.vercel.app, 2026-11-12, janela 9222, aba nova em contexto isolado `rodada3`. Viewport efetivo: innerWidth=500 (a janela não desceu a 390; resize_page 390x844 aplicou-se só à altura). Credencial falsa `zz-falso@worki.test`.

## Versão
Bundle no ar: `assets/index-6iP0Ki0U.js` (diferente de index-CvI_f0pB.js). CSS `index-Wb0j3rtZ.css`.

## D-3 trava de reentrada — CORRIGIDO
Contagem por `window.fetch` instrumentado e conferida por `performance.getEntriesByType('resource')` (auth/v1/token), ambas iguais.
- 3x `form.requestSubmit()` no mesmo tick: 1 POST. Erro "Email ou senha incorretos."; botão "Entrar" reabilitado (disabled=false).
- Nova tentativa após o erro: +1 POST (trava não ficou presa).
- 3x `button.click()` no mesmo tick (proxy extra): 1 POST; reabilitou.
- 3 Enter reais (press_key): 3 POSTs em t=29043, 29442, 29680 ms; durações 135/77/79 ms, ou seja, cada Enter veio depois do fim da requisição anterior. São tentativas legítimas sequenciais, NÃO prova de Enter no mesmo tick (o MCP não consegue enviar 3 teclas no mesmo tick). O caso same-tick está coberto por requestSubmit/click.

## D-4 alvos de toque — CORRIGIDO (medido a innerWidth 500)
- /login: Termos 44x44, Ajuda 44x44, Privacidade 67.4x44, Sobre a Worki 80.5x44, Voltar 106.6x44.
- /esqueci-senha: Voltar 106.6x44 (antes 91x36).
- Ressalva: não medi a 390/360 reais. As larguras de Termos/Ajuda estão no mínimo de 44, o que sugere min-width fixo, mas não provei no viewport estreito.

## Suspeita transparenttextures — CORRIGIDO
Landing /: 12 requisições, só worki-opal.vercel.app (hosts externos: nenhum); HTML sem a string; nenhum background-image externo; console vazio (0 mensagens).

## Vizinhança — sem regressão
- /login vazio: requestSubmit = 0 POST, validação nativa "Preencha este campo." nos dois campos.
- Cadastre-se: "Força: Fraca" (abc) / "Razoável" (abcdef12) / "Média" (Abcdef12) / "Forte" (Abcdef12!@#xyz); fonte do campo 16px.
- Ajuda: clique em /login navegou para /ajuda sem recarregar (marcador de window preservado), h1 "Ajuda".
- /esqueci-senha: h1 "Esqueci a Senha", campo 16px, botão desabilitado com e-mail vazio, sem rolagem horizontal; screenshot visualmente íntegro.

## Não testado
360x740, 844x390, 1366x800 reais; Enter simultâneo real; rotas autenticadas; D-1 (/convite-gerente/<falso>) fora do escopo.
