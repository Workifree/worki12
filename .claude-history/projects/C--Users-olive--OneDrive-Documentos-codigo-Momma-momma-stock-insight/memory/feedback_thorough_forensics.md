---
name: Thorough forensics required
description: User expects exhaustive investigation before making fixes — check deployed version, all menus, all routes, dead code, and verify against working state
type: feedback
---

When investigating code issues after a bad merge/refactor, do NOT just check git diffs and assume things are fine.

**Why:** User was frustrated because I declared "everything correct" when the production menu was missing from sidebar, transfer notes button was gone, and there was dead code everywhere. I checked the router file but missed that menu items weren't added.

**How to apply:**
- Always check the DEPLOYED/WORKING version first (Vercel URL or screenshots)
- Check ALL integration points: router, sidebar menu, barrel exports, component rendering
- Don't assume "file exists = feature works" — verify the full chain from menu → route → import → render
- When user says "many things broken", take that seriously and be more thorough
- Dead code must be identified and cleaned up, not ignored
- Follow FSD patterns consistently
