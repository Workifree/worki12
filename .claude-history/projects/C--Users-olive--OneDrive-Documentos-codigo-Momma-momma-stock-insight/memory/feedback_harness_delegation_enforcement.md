---
name: feedback-harness-delegation-enforcement
description: "Harness agents were not being called — Claude was doing UI work inline instead of delegating to harness-frontend-builder and harness-builder. Language \"default = delegar\" was too soft; carve-out was abused."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: b08dcb6f-4c13-4a31-a62a-e2575f87bda2
---

Harness delegation was NOT happening in practice even after setup. Claude was implementing UI redesigns directly without calling harness-frontend-builder (Gemini Pro) or other agents.

**Why:** The word "default = delegar" is a preference, not a hard rule. Claude's helpful instinct overrides soft suggestions when it thinks it can "just fix it quickly."

**Fix applied (2026-06-09):** Added to CLAUDE.md:
1. PROIBIÇÕES ABSOLUTAS table — binary rules, no wiggle room
2. Mandatory declaration: "DELEGANDO: <agent> — <reason>" before every agent call
3. Decision tree (binary yes/no per task type)
4. Carve-out tightened: no UI element can ever be a carve-out

**Why:** agent did TV dashboard redesign entirely inline, no frontend-builder called, broke design system patterns, made direct code edits that should have gone through harness-builder + frontend-reviewer.

**How to apply:** If Claude starts editing UI files directly without first declaring "DELEGANDO: harness-frontend-builder", it's violating the harness. Challenge it immediately.
