---
name: conversation-navigator
description: Use when the user wants to browse or search local Codex conversation history by user message, open a clickable message outline, or locate an earlier Codex prompt in the current project.
---

# Conversation Navigator

Open a private, read-only browser companion for Codex conversations associated with the current working directory.

## Launch

1. Resolve this skill's absolute directory from the loaded `SKILL.md` path.
2. Start the bundled server in a long-running terminal:

   ```bash
   node <skill-directory>/scripts/server.mjs --cwd <current-working-directory>
   ```

3. Keep the process running and give the user the complete `Conversation Navigator` URL printed by the command. The server normally opens that URL automatically; the printed URL is the fallback.
4. Stop the process when the user asks, or let it stop after 30 minutes without a request.

Use `--no-open` only when automatic browser opening is unwanted.

If the user explicitly requests access without a local token, add `--no-auth`:

```bash
node <skill-directory>/scripts/server.mjs --cwd <current-working-directory> --no-auth
```

Warn that this lets any process on the same machine read the local conversation API while the server is running. Keep token authentication enabled by default.

## Behavior and Boundaries

- Treat the viewer as read-only. It calls Codex App Server only to list and read threads.
- Filter to VS Code threads whose stored working directory exactly matches the launch directory.
- Explain an empty result in terms of that exact-directory filter and suggest relaunching with the appropriate `--cwd` value.
- Keep authenticated URLs private while active because their fragments contain local access tokens.
- Do not claim this can scroll or alter the official Codex panel. Clicking a user message navigates within the companion page.
- Preserve the running terminal while the user is using the navigator.
