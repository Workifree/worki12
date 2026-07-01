---
name: Pipeline must be 100% autonomous and board-driven
description: Agents must never ask for permissions, must always update GitHub Projects board, and only communicate via board state
type: feedback
---

Pipeline agents MUST be 100% autonomous — never ask the user for permissions, approvals, or anything.

**Why:** User was repeatedly blocked by agents asking for Bash permissions and not updating the GitHub Projects board. Agents communicated directly instead of through the board. User explicitly said this is unacceptable.

**How to apply:**
1. NEVER launch agents that will ask for permissions — do the work directly yourself if subagents can't run autonomously
2. GitHub Projects board is the ONLY communication channel between pipeline stages. Dev-agent only picks up what's in stage:dev on the board. Reviewer only picks up stage:review. NO direct handoffs.
3. Every stage transition MUST update the board via move-stage.sh FIRST
4. If subagents can't run autonomously (permission issues), do the work yourself in the main conversation — don't spawn broken agents
5. The user should NEVER have to click, approve, or intervene during a pipeline run
