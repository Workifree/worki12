# Copiloto agêntico: teste real na tela (25/11/2026)

Estado: **em andamento**. Atualizado ao longo da execução.

## Montagem do teste
- Vite próprio em `http://localhost:5190`, `VITE_COPILOT_ENABLED=true` só no processo.
- Chrome visível (playwright-core), script em `scratchpad\cop-real\`. O agente toca; o script faz só o papel da pessoa.
- Função publicada `copilot-llm` v1, Supabase de produção, contas de teste.
- **Única adaptação:** a função publicada só aceita as origens da Vercel e `localhost:5173` (5190 recebe 403
  `origin_not_allowed`). Nas chamadas à `copilot-llm`, e só nelas, o script reescreve o cabeçalho `Origin` para 5173.
  Secrets e função não foram alterados.

## Pontos de partida (banco)
- Empresa de teste: 400/400 chamadas hoje. Freela de teste: 0.

## Resultados
(a preencher)
