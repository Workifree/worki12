---
name: project_minmax_motor_setor_produtos
description: Motor de mínimo de estoque agora é escopo dinâmico (setor PRODUTOS) e grava só o mínimo; máximo ficou dormente (2026-06-25)
metadata: 
  node_type: memory
  type: project
  originSessionId: 84967186-0f46-4073-949f-4d95c74653f1
---

A função `recalcular_minmax_estoque()` (cron diário `minmax_recalculo_diario`, 05:05 BRT) foi alterada em 2026-06-25 (migration `20260625120000_minmax_min_setor_produtos.sql`):

- **Escopo deixou de ser a lista fixa** `minmax_escopo_produtos` (15 produtos) e virou **dinâmico**: todo produto ativo com `setor='PRODUTOS'` que vendeu no Degust nos últimos 56 dias, nos pares (produto×loja) que de fato venderam. ~66 produtos / 286 pares / 229 com linha de estoque. Produto novo que começa a vender entra sozinho. A tabela `minmax_escopo_produtos` ficou **dormente** (não é mais lida; mantida como gancho de override futuro).
- **Grava SÓ `estoque.quantidade_minima`.** `quantidade_maxima` ficou **INTOCADO** por decisão explícita do CTO ("esqueça o max agora"). A máquina de máximo (ABC/Z/σ/fds) continua computada na CTE `final` mas o resultado **não é escrito** — pra reativar o max basta restaurar `quantidade_maxima = greatest(f.maximo, f.minimo)` no `UPDATE`.

**Consequência importante:** o invariante `mínimo ≤ máximo` **não é mais garantido na escrita** (o min sobe na sexta — janela sex+sáb+dom — sobre um max congelado). Inofensivo hoje (0 inversões; e o status `baixo` é avaliado antes de `completo` em `inventory-alerts.ts`), mas vigiar quando reativar o max.

Resto da lógica **idêntico** (mantido a pedido — "seguindo a lógica que já temos hoje"): janela dinâmica por dia da semana (viagens seg/qua/sex; sexta cobre 3 dias), mínimo = demanda pura por dia-da-semana até a próxima viagem (`ceil(dem_janela)`, sem Z), trava de validade `least(janela, dias_validade)`, correção de demanda censurada (alertas `sem_estoque`), cold-start por proxy de rede.

Higiene pendente (fora do escopo desta mudança): `produtos_master.dias_validade` está NULL em ~90 dos 116 produtos que vendem — pro mínimo não importa (janela 1-3d ≤ shelf life), mas é um backfill que ajudaria a trava de validade. Ver [[project_momma_business_validade]]. Metodologia completa em [[project_minmax_estoque_metodologia]]. ADR: `.harness/memory-bank/decisions/ADR-20260625-minmax-escopo-dinamico-so-minimo.md`.

## Consulta de Mínimo por Período (camada de visualização, 2026-06-25)

Tela read-only de planejamento adicionada como aba em `/produtos?tab=minimo-periodo` (commit `3ee1b6c9`). O CTO informa "a requisição sai no dia X e tem que durar N dias" (espelha a config do agente repa / `AutoRequisitionWizard`) e vê numa **matriz produto × loja** o mínimo que cada loja precisa pra cobrir esse período, com destaque de loja abaixo do necessário.

- Backend: RPC `simular_minimo_periodo(p_dia_inicio int /*dow 0-6*/, p_dias_cobertura int /*1-7*/)` (migration `20260625130000`), `language sql stable security definer`, **READ-ONLY** — reusa a MESMA matemática do motor (janela parametrizada em vez do CASE fixo seg/qua/sex). Propriedade: chamar com (dia=hoje, cobertura=janela do dia) reproduz exatamente o `quantidade_minima` gravado.
- **Não toca** estoque, mínimo diário automático nem cron — é só consulta. O mínimo do dia-a-dia segue na lista normal.
- `grant execute to authenticated` SEM gate de role no servidor → qualquer logado vê dados de todas as lojas via REST. **Decisão explícita do CTO**: aceito por design (dado operacional interno, sem PII/financeiro, mono-tenant; planejamento de rede). Se quiser restringir depois = gate de role no corpo (cuidado com o landmine `operações` acentuado de [[project_role_operacoes_duplicada]]).
- Frontend: `MinimoPorPeriodo.tsx` + hook `useSimularMinimoPeriodo.ts` (+ test) em `src/features/produtos/`. NÃO reconfigurou o calendário de viagens persistente (era a outra opção; ficou pra depois).
