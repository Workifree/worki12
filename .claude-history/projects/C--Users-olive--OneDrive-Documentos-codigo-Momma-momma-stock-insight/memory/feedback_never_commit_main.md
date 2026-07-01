---
name: Never commit directly to main
description: All code changes must go through feature branches and PRs — NEVER commit to main directly
type: feedback
---

NEVER commit directly to main. Every code change must go through a feature branch + PR.

**Why:** User explicitly corrected this — committing directly to main bypasses the entire review/QA/security pipeline, making those agents useless. It's unprofessional and defeats the purpose of having a pipeline at all.

**How to apply:**
- Dev-agent MUST create `feat/ISSUE-N-desc` branch before writing any code
- Dev-agent MUST create a PR via `gh pr create` after implementation
- Code-reviewer, QA, and security-auditor all operate on the PR branch
- Security-auditor APPROVES PRs and moves to stage:done — does NOT merge
- HUMAN owner reviews stage:done PRs and merges manually: `gh pr merge N --squash --delete-branch`
- 1 task = 1 branch = 1 PR — no exceptions, no bundling
