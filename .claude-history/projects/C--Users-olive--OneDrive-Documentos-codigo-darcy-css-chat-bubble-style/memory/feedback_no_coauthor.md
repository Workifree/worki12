---
name: feedback_no_coauthor
description: Never add Co-Authored-By or any co-author line to git commits
type: feedback
---

Never add Co-Authored-By lines to git commits. Just a clean commit message, nothing else.

**Why:** User explicitly requested this — they don't want any co-author attribution in commits.

**How to apply:** On every git commit, use only the commit message. No Co-Authored-By, no trailers of any kind.
