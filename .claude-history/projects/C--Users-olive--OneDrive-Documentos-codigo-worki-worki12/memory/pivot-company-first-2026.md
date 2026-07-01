---
name: pivot-company-first-2026
description: Worki pivotou de marketplace para infra de operação de freelancer centrada na empresa (pagamento postpago); docs canônicos no .harness
metadata: 
  node_type: memory
  type: project
  originSessionId: 9a8d7dff-3ee5-4432-b2f6-239007aa9c0d
---

Worki **pivotou** (jun/2026, decisão do owner) de "marketplace de freelance" para **infraestrutura de operação de freelancer centrada na empresa**. A empresa monta uma equipe de freelas que já conhece e os **convida direto** pra turnos (modelo **push**, não candidatura aberta). 

- **Wedge** = valor pra empresa (centralizar contratar + pagar + registrar + controlar). **Moat** = reputação portátil do freela. Marketplace/diretório aberto de estranhos = **Fase 2** (não agora).
- **GTM**: entrar via 1-3 empresas (começando pela MOMMA, onde o owner é embedded); a empresa força o freela a adotar; take 0 no início; régua de fricção = ser mais fácil que WhatsApp.
- **Pagamento = postpago** (cartão on-file + captura na conclusão via Asaas, sem depósito antecipado) — substitui o prepago/escrow legado no caminho novo. O fluxo pull/escrow legado segue existindo. Asaas suporta nativamente (tokenizeCreditCard + authorizeOnly + captureAuthorizedPayment); falta habilitar tokenização/pré-auth em **produção** com o gerente de contas Asaas.
- **NÃO é "CLT privada"** — Worki é conector/registro, nunca empregador. Sem gate jurídico pro MVP (decisão do owner).

Docs canônicos versionados no repo: tese em `.harness/thesis.md`; spec/plan/ADRs em `.harness/spec/v1-operacao-freelancer/`. Pipeline de dev = agentes `harness-*` (ver CLAUDE.md).

Entrega: **Slice 1 (loop relacional)** — minha equipe, convite push, avaliação bidirecional — feito via pipeline harness completa, **PR #195** (branch `feat/v1-loop-relacional`). Próximo: **Slice 2** (pagamento postpago), depois Slice 3 (inteligência financeira: teto/BI/ratio) e Slice 4 (WhatsApp). Isso atualiza o modelo descrito em "Payment Flow" do MEMORY.md (que descreve só o prepago legado).
