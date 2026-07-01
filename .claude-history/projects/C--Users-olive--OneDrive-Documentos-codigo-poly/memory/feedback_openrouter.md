---
name: LLM Provider Choice
description: User wants OpenRouter with paid models instead of Ollama for news analysis (Signal B)
type: feedback
---

Use OpenRouter (not Ollama) for LLM inference in Poly-Intel. User already has an account and knows how to use it.

**Why:** Ollama requires local setup and limits to running on user's PC. OpenRouter gives access to paid models with better quality and runs in the cloud.
**How to apply:** Replace Ollama integration with OpenRouter API (OpenAI-compatible format). Use env var `OPENROUTER_API_KEY`. Default model should be cost-effective but good for classification (e.g. google/gemini-flash-1.5 or similar).
