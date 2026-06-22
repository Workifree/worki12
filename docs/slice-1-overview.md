# Slice 1 — Loop Relacional (MVP) — Resumo de Mudanças

**Lançamento:** Slice 1 da operação de freelancer (v1, piloto)  
**Período:** Slice 2026-06-22 (MVP)  
**Foco:** Fechar o loop de contratação: equipe → convite → aceite → turno → avaliação

---

## O que mudou para o usuário?

### Para Empresa

#### Página "Minha Equipe" (novo)
- **Rota:** `/company/team`
- **O que faz:** Mostra seus freelancers confirmados e os aguardando resposta
- **Como adicionar freelancer:**
  1. Por **link de convite** (compartilhe via WhatsApp/SMS/e-mail)
  2. Por **Worki ID** (quando você já sabe o ID do freelancer)
  3. Por **QR scanner** (v1.1) — futuramente, aponte a câmera pro QR do perfil

#### Briefing em Turnos (novo)
- **Onde:** Ao criar novo turno (`/company/create-job`)
- **Campo novo:** "Briefing do Turno"
- **O que é:** Regras da casa, dress code, cardápio, procedimentos
- **Quem vê:** Freelancer vê no convite que recebe

#### Convidar Turno (mudança)
- **Antes:** Vagas iam para um feed, freelancers se candidatavam
- **Agora:** Você convida direto um freelancer da sua equipe
- **Onde:** Na página do turno criado → "Convidar da Equipe"

#### Acompanhamento de Convites (novo)
- Na página do turno, veja quem aceitou, recusou ou ainda não respondeu
- Convites expiram em 48h se não respondido
- Se recusar, slot reabre para convidar outro

#### Avaliar Freelancer (novo)
- Após turno concluído, você avalia o freelancer
- Nota 1-5 ⭐ + comentário opcional
- Freelancer também avalia você

### Para Freelancer

#### QR de Identidade (novo)
- **Onde:** Meu Perfil (`/profile`) → ícone QR (canto superior)
- **O que é:** Código QR único que mostra seu Worki ID
- **Para quê:** Empresas podem escanear (em v1.1) ou usar seu ID para te adicionar à equipe
- **Seguro?** Sim, mostra só seu Worki ID (não dados pessoais)

#### Aceitar Convite de Equipe (novo)
- Você recebe um **link de convite** da empresa
- Ao clicar, vai para `/convite/:token`
- Você vê quem te convidou e clica "Aceitar"
- Assim a empresa aparece em "Minhas Lojas" (você trabalha com ela)

#### Aba "Convites" em "Meus Jobs" (novo)
- **Onde:** /my-jobs → primeira aba = "Convites"
- **O que mostra:** Todos os turnos que empresas convidaram você
- **Cada convite tem:**
  - Empresa (logo + nome)
  - Título do turno
  - Data, horário, valor
  - **Briefing** (regras/dress code)
  - Local
  - Status ("Novo convite")

#### Responder Convite (novo)
- **Aceitar:** Confirma que vai. Turno vai para sua agenda e empresa é notificada.
- **Recusar:** Passa o turno para outro freelancer. É neutro — sua reputação não cai.
- **Prazo:** Você tem 48h para responder. Depois expira e reabre para a empresa convidar outro.

#### Avaliar Empresa (novo)
- Após turno concluído, você avalia a empresa
- Nota 1-5 ⭐ + comentário opcional
- Empresa também avalia você

---

## Fluxo Canônico (Slice 1)

```
[0] Empresa adiciona freelancer à equipe
       ├─ Link: freelancer clica link → /convite/:token → aceita → equipe
       └─ ID: empresa cola Worki ID do freelancer → aceita → equipe

[1] Empresa cria turno
       └─ Novo campo: Briefing (regras/dress code)

[2] Empresa convida freelancer da equipe
       └─ Convite dispara → app + e-mail

[3] Freelancer vê em "Convites" (aba nova em Meus Jobs)
       └─ Mostra turno + empresa + briefing + valor

[4] Freelancer responde (48h)
       ├─ Aceita → turno na agenda
       └─ Recusa → slot reabre (sem penalidade)

[5] Turno acontece (v1 = confirmação manual; v1.5 = check-in/out)

[6] Avaliação mútua
       ├─ Empresa avalia freelancer
       └─ Freelancer avalia empresa
```

---

## O Que NÃO Mudou (Slice 2+)

- **Depósito antecipado:** Slice 1 é só o loop. Pagamento postpago entra em Slice 2.
- **Escrow:** Ainda não ativa. Reserve/release entra em Slice 2.
- **Check-in/out por QR:** v1.5 — Slice 1 é confirmação manual.
- **BI / Teto / Alertas:** Slice 2 (inteligência financeira).
- **Parcelamento / Crédito:** Fora do MVP.

---

## Próximas Mudanças (Slice 2+)

- Pagamento postpago (cobra no fim do turno)
- Escrow (reserva ao aceitar, libera ao concluir)
- WhatsApp para convites + alertas
- Check-in/out por QR
- BI financeiro (gasto/horas, teto, alertas)

---

## Referência Rápida

| Persona | Nova Página | Novo Campo | Nova Ação |
|---|---|---|---|
| **Empresa** | `/company/team` | Briefing em turno | Convidar freelancer direto |
| **Freelancer** | `/convite/:token` | — | Aceitar/recusar convite; ver QR de identidade |
| **Ambos** | — | — | Avaliar mutuamente (direção explícita) |

---

## Documentação Completa

- **Para Empresa:** `docs/features-empresa.md`
- **Para Freelancer:** `docs/features-worker.md`
- **Spec Técnica:** `.harness/spec/v1-operacao-freelancer/spec.md`
