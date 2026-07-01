---
name: Playwright must be interactive AI-driven, not scripts
description: User wants AI to navigate manually step-by-step with screenshots, not automated scripts. Each step must have analysis.
type: feedback
---

Never write automated Playwright scripts for auditing. Instead, use Playwright interactively:
1. Take one action at a time (navigate, click, scroll)
2. Take screenshot after each action
3. Read and analyze the screenshot visually
4. Decide next action based on what was seen
5. Build understanding incrementally

**Why:** User was frustrated because automated scripts couldn't handle edge cases (auth flow, dynamic content) and produced empty results. The AI needs to SEE and REASON about each page, not blindly scrape.

**How to apply:** Write minimal Playwright Node.js snippets that do ONE thing, read the screenshot, then decide next step. Like a human QA tester.
