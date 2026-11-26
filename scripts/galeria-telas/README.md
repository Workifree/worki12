# Galeria de estados do Worki

Fotografa as telas do app em cada estado, inclusive os de uma vez só, **sem tocar o banco real**.
Inventário: `.harness/spec/revisao-design/inventario-de-telas.md`.

## Rodar

```bash
cd scripts/galeria-telas
npm install                      # só na primeira vez (playwright-core; usa o Chrome instalado)
node run.mjs                     # tudo, nos 3 tamanhos (390x844, 320x640, 1440x900)
node run.mjs --so=onboarding     # um grupo ou trecho de id (separe por vírgula)
node run.mjs --vp=390            # só um tamanho (390, 320, 1440)
node run.mjs --saida=C:/tmp/antes    # pasta de saída (padrão: ./saida); use outra para o "depois"
node run.mjs --lista             # lista os cenários sem abrir o navegador
```

Outros argumentos: `--paralelo=4`, `--porta=5180`. Requer `frontend/node_modules` instalado.

Saída: `<id>__<largura>.png` (`-fim.png` = diálogo rolado até o fim), `index.html`, `index.md`,
`resultados.json`, `lacunas-de-fixture.json`. Rodar com `--so` na mesma pasta atualiza só aqueles
cenários e mantém o resto do índice.

## Travas (fail-closed)

1. Vite próprio na porta 5180, com `envDir` numa pasta vazia: nenhum `.env*` do repo é lido.
   `VITE_SUPABASE_URL=https://galeria.invalid` e chave falsa. Se o módulo servido não tiver o host
   falso, ou tiver URL ou chave real, a execução aborta antes de abrir o navegador.
2. No navegador, só localhost passa. O host falso é respondido por `lib/mock.mjs`; todo o resto é
   abortado e listado. Service worker bloqueado. WebSocket do host falso fica mudo.
3. O Chrome (headless, perfil temporário) sobe sem resolução de nomes fora do localhost.
4. No fim é impresso `Requisições externas que SAÍRAM: N`, medido pelo IP de cada resposta.
   Se N > 0, o processo sai com código 2.

Sessão falsa vai direto no `localStorage`. Não há credencial real em lugar nenhum.

## Declarar um cenário

Em `cenarios/*.mjs`:

```js
const c = grupoDe('empresa-turnos');
c('lista-vazia', 'empresa', '/company/jobs', 'nenhum turno', {
  prep: (m) => { m.vazio('jobs'); },            // muda o mundo fictício
  passos: [{ clicar: 'Adicionar' }],            // clicar, css, preencher, selecionar, marcar, avaliar, esperar, offline, falhar
  espera: 'Nenhum turno',                       // fonte de regex: prova que o estado foi alcançado
});
```

- Papéis: `anon`, `freela`, `empresa`, `encarregado`, `admin` (`fixtures/world.mjs`).
- Falhas: `m.falhas['rest:jobs'] = 'erro' | 'rede' | 'pendura' | { status, body }` (também `rpc:`, `auth:`, `fn:`).
- Relógio do navegador congelado em 25/11/2026 13h (Brasília).
- Opções extras: `erroEsperado`, `carregandoEsperado`, `ua`, `local`, `session`, `init`, `convitePwa`, `viewports`, `pausa`.

## Como ler o resultado

- **Estado não confirmado**: o texto esperado não apareceu ou um passo falhou. Pode ser rótulo que
  mudou no app (ajuste o cenário), lacuna de fixture ou defeito. Veja a foto.
- **Lacunas**: consulta ou RPC sem fixture. Corrija em `fixtures/world.mjs` antes de culpar o app.
- O falso Supabase **não executa RLS, triggers nem RPCs**. Só há uma imitação mínima (o freela lê os
  próprios pagamentos). A galeria serve para revisar tela, não para validar regra de banco.
- **Alvos < 44px**: medidos em 390 e 320; links no meio de frase ficam de fora. Com diálogo aberto,
  só conta o que está dentro dele.
- **Erros de console** incluem os esperados em cenários de falha simulada (HTTP 500 e rede).
- A foto de página inteira é feita aumentando a altura da janela, para a navegação fixa ficar no fim.
