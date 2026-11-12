# Spec — UI: fundação de componentes + copy/navegação (Fases A+B)

Branch: `refactor/ui-fundacao-botoes-copy` · Origem: feedback de usuários + pedido do dono (11/11/2026).

## Context
O app parece amador: 354 `<button>` com classes soltas (sem componente `Button`), tamanhos/raios/pesos
desiguais, passos demais, copy inconsistente. Decisões do dono:
- **Direção visual:** manter neo-brutalista (Article 13 INTACTO), com acabamento mais fino, "luxo" Apple/SpaceX:
  mais espaço em branco, hierarquia clara, tipografia mais contida, sombras offset menores, menos CAIXA-ALTA gritante.
- **Escopo desta entrega:** só Fases A e B. Sem banco, sem migration, sem funcionalidade nova.
- Fase D (fora): QR check-in com validação real, link de convite ao elenco com texto curto p/ WhatsApp/Telegram,
  tempo de aceite, busca de endereço, push.

## Requirements
### A — Primitivos (`frontend/src/components/ui/`)
- R1 `Button`: variantes `primary` (verde worker) · `dark` (preto empresa) · `secondary` (borda) · `ghost` · `danger`;
  tamanhos `sm` (h-9) · `md` (h-11 — alvo de toque mínimo 44px) · `lg` (h-12); estado `loading`; `fullWidth`; `disabled`.
  Mesmo raio (`rounded-xl`), mesmo peso (`font-bold`, não `font-black` em tudo), foco visível.
- R2 `Card`, `PageHeader` (título + subtítulo + ação primária única), `Field` (label + input + erro) com escala fixa.
- R3 Testes de unidade dos primitivos (Vitest).
- R4 Atualizar `.harness/memory-bank/design-system.md` com a escala refinada (botões, espaçamento, tipografia).
### B — Copy e navegação
- R5 "Cliente(s)" → "Empresa(s)" na visão do freela (Sidebar, BottomNav, CarteiraClientes, Dashboard, Help, Onboarding).
  Rota `/carteira` NÃO muda (links existentes). Nome de componente/arquivo NÃO muda.
- R6 Rótulos do `BottomNav` sem abreviações feias ("Msgs", "Receb.") quando couber; Sidebar e BottomNav coerentes.
- R7 Link de perfil do freela (copiar) visível no topo do Perfil e na Carteira, com uma frase explicando "link" vs "Worki ID".
- R8 Link do elenco da empresa em local visível (Elenco), não só dentro de Perfil Empresa.
### Adoção
- R9 Migrar para os primitivos: Sidebar, BottomNav, CarteiraClientes, Dashboard, CompanyDashboard, CompanyTeam.
  Demais telas ficam para PRs seguintes (auditoria tela a tela).

## Acceptance
- A1 `cd frontend && npm run build` e `npm run lint` verdes (0 erros); `npm test` sem regressão.
- A2 Nenhuma rota/RLS/RPC/migration alterada. Nenhum texto "cliente" visível ao freela (exceto "cliente" no sentido técnico em comentários).
- A3 Todo botão migrado tem alvo de toque ≥ 44px no mobile (390px).
- A4 Comportamento preservado: testes existentes das telas tocadas passam (ajustar só asserts de copy).
- A5 Article 13 respeitado: bordas pretas e sombra offset continuam, apenas mais finas/contidas.
