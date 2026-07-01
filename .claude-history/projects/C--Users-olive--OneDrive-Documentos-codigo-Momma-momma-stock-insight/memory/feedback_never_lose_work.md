---
name: Never lose uncommitted work
description: Always commit or preserve local changes before pulling/resetting. Never assume uncommitted work exists elsewhere.
type: feedback
---

Never drop stash or reset --hard without confirming the user is OK losing those changes.
If changes are uncommitted, they DON'T exist anywhere else — treat them as precious.

**Why:** User had significant uncommitted changes (4500+ lines across 25 files) that were stashed during a pull. Almost lost them by dropping the stash.

**How to apply:** Before any destructive git operation (reset, stash drop, checkout --), always check what's being lost and ask the user. If there are conflicts, resolve them file by file instead of discarding.
