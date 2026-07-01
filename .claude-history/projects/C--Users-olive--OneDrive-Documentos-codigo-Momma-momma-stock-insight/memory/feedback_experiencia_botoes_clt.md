---
name: Experiência — só prorrogar na 1ª, só efetivar ao fim da 2ª
description: Gating CLT dos botões do /funcionarios/experiencia. Encerrar sempre disponível.
type: feedback
originSessionId: 711be082-f67c-4d25-804b-d1c1f3a06ab9
---
Na tela `/funcionarios/experiencia` (e em qualquer lugar que ofereça decisão sobre contrato de experiência):

- **Durante a 1ª experiência** (`prorrogacao_count === 0`): apenas **Prorrogar** habilitado. Efetivar bloqueado.
- **Durante a 2ª experiência** (`prorrogacao_count >= 1`): apenas **Efetivar** habilitado. Prorrogar bloqueado (já gastou a única prorrogação permitida).
- **Encerrar**: sempre disponível (pode demitir a qualquer momento durante experiência).

**Why:** CLT Art. 445 + 451 + Súmula 188 TST — contrato de experiência dura até 90d e admite no máximo uma prorrogação. Efetivar antes do fim da 2ª etapa pula a fase de avaliação prevista; efetivar direto da 1ª desconfigura o instituto da experiência.

**How to apply:** Em qualquer UI de decisão sobre experiência (DecisionDialog atual, futuras telas, MIA actions, banner de dashboard), aplicar esse gating. Tooltip explicativo no botão desabilitado. Backend `experiencia_decisoes` tabela continua aceitando os 3 tipos (efetivar/prorrogar/encerrar) — o gate é só de UX.
