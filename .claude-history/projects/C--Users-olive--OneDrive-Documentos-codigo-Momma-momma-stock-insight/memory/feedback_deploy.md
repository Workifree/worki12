---
name: Deploy MIA always with --no-verify-jwt
description: MIA edge function MUST be deployed with --no-verify-jwt flag because Telegram webhooks don't send JWT tokens
type: feedback
---

Always deploy MIA with `--no-verify-jwt` flag:
```
npx supabase functions deploy mia --project-ref jaumyfyeueayibbxunxc --no-verify-jwt
```

**Why:** The Telegram webhook sends POST requests without an Authorization header. Without `--no-verify-jwt`, Supabase returns 401 and the bot doesn't respond. The web channel still works because the frontend sends the JWT via the Authorization header.

**How to apply:** Every time you deploy the MIA edge function, append `--no-verify-jwt` to the deploy command. Same for `mia-alerts`.
