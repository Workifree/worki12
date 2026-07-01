---
name: NEVER use Playwright scripts - interactive only
description: User HATES automated scripts. Use Bash one-liners with node -e for each individual Playwright action. ONE action per tool call.
type: feedback
---

NEVER write .mjs/.js script files for Playwright. User gets furious.

**Why:** User wants to see each step happening individually so they can interrupt, redirect, and understand what's happening. Scripts are a black box.

**How to apply:**
- Use `node -e "..."` one-liners in Bash for EACH Playwright action
- One navigation/click per Bash call
- Read the screenshot immediately after
- Analyze what you see
- Then decide next action
- NEVER create .mjs or .js files for Playwright
