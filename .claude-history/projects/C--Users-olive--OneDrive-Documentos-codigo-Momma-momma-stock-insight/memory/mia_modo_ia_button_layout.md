---
name: mia-modo-ia-button-layout
description: "UX do botão \"Modo IA\" — sidebar desktop + ao lado seletor loja mobile. Toggle persistente. Layout split (ERP esquerda funcional, MIA direita chat+watch log). Mobile bottom sheet com TTS. FAB descartado."
metadata: 
  node_type: memory
  type: project
  originSessionId: e27996f5-78ef-495a-aac7-de467ac1af35
---

# UX "Modo IA" — botão + layout glass-box

## Botão localização
- **Desktop**: `AppSidebar.tsx` — item dedicado no sidebar (NÃO item de menu, NÃO FAB)
- **Mobile**: ao lado do `StoreSelector` (header) — botão visível sempre
- **Toggle persistente** (não one-shot — fica ligado até user desligar)
- **OFF = MIA totalmente desligada** (sem FAB residual, sem nada visível)

**FAB foi descartado.** Botão "Modo IA" é o único toggle.

## Layout glass-box (quando intent=act + pane abre)

**Desktop:**
```
┌──────────────────────────────┬──────────────────┐
│  ERP (funcional, clicável)   │  MIA             │
│  - DOM highlights amarelos   │  - Chat          │
│  - Cursor avatar MIA visível │  - Watch log     │
│  - Form fills animados       │  - Confidence    │
│  - User pode clicar manual   │  - Pausar/Assumir│
└──────────────────────────────┴──────────────────┘
   ~2/3 da tela                   ~1/3 da tela
```

**Mobile:**
- SEM split (tela não comporta)
- **Bottom sheet** sobe 40% da tela quando MIA executa
- TTS narra ações ("Lançando entrada de 10 brigadeiros...")
- Botão grande "Pausar" (mãos sujas, chão de loja)
- Tap-to-expand mostra log completo

## Quando pane abre (regras [[mia-glass-box-architecture]])
- intent=act multi-step
- Operação envolve dinheiro/alta-stake
- User pediu `/agir` ou `/mostra`
- Sem L0 disponível → fallback auto
- Verbos visuais ("mostra", "vê", "olha") inferem glass-box

## Quando pane NÃO abre
- intent=conversational
- intent=data (read simples, write atômico via L0)
- Resposta cabe em chat

## Watch log (componentes visuais)
- **Scrolling micro-ops**: "Buscando estoque AC..." / "Calculando saldo..." / "Pronto"
- **Confidence badge** per step (92%, 78%)
- **DOM highlights**: borda amarela + label "MIA tocou aqui" no elemento
- **Cursor avatar MIA**: pequeno avatar visível durante navegação
- **Botões sempre visíveis**: Pausar / Assumir / Cancelar

## Modos autonomia (configurável user/role)
- **Cuidadoso**: confirma cada ação destrutiva E navegação importante
- **Assistido (default)**: só destrutivas (pagamento, delete, edit financeiro)
- **Live**: só início do plano, executa tudo, user interrompe
- **Off**: MIA desligada (botão Modo IA OFF)

## Confidence + segurança
- Badge per step (92%)
- Abaixo threshold (default 80%) → confirma auto mesmo em modo Live
- **Audit log obrigatório**: `actor=mia, on_behalf_of=user_X, plan_id=Y, step=Z`
- Permissões: MIA herda RLS do user logado — nunca acessa mais que user poderia
- Savepoint pra fluxos críticos (pagamento, lançamento) com botão undo no fim

## Como user invoca MIA quando pane fechado
1. **Chat direto** no painel direito sempre disponível (mesmo sem pane glass-box aberto)
2. **Voz** push-to-talk (fase mês 3 — vertical 1)
3. **Click-direito num elemento**: "Pede pra MIA fazer X com isso" (context-aware, padrão Microsoft Copilot)
4. **Repetir gravado**: macros salvas → "MIA, fechamento AC" → executa

**Why:** separa visualmente "conversar" (chat só) de "ver MIA fazer" (split pane). Mantém ERP usável manual sempre. Botão "Modo IA" único elimina confusão com FAB legacy.

**How to apply:** implementar em `MiaContext.tsx` (estado modo IA + intent atual), `MiaGlassBoxPane.tsx` (NOVO — substitui/coexiste com `MiaChatPanel.tsx`), `AppSidebar.tsx` (botão desktop), `StoreSelector` mobile (botão mobile). `MiaFab.tsx` deprecado.
