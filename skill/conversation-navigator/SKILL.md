---
name: conversation-navigator
description: Use when the user wants to browse or search local VS Code or Codex CLI conversation history by user message, open a clickable message outline, filter conversations by source, or locate an earlier Codex prompt in the current project.
---

# Conversation Navigator

Open a local, read-only browser companion for Codex conversations associated with the current working directory.

## Launch

1. Resolve this skill's absolute directory from the loaded `SKILL.md` path, then assign it to `$skillDirectory` in PowerShell or `$skill_directory` on POSIX.
2. On native Windows PowerShell, launch the detached background service with the exact project directory:

   ```powershell
   node "$skillDirectory\scripts\launch.mjs" --cwd "$((Get-Location).Path)"
   ```

   The launcher returns the complete URL and process ID promptly; the service continues in the background, opens the browser unless `--no-open` is supplied, and stops after 30 minutes without activity. Do not keep a long-running Windows terminal open. If the terminal wrapper prints no output, do not launch again. Read the fallback in a separate PowerShell command:

   ```powershell
   $statePath = Join-Path ([IO.Path]::GetTempPath()) 'codex-conversation-navigator\last-launch.json'
   $state = Get-Content -Raw $statePath | ConvertFrom-Json
   $state.status; $state.cwd; $state.url; $state.pid
   ```

   Check `status` and `cwd`, then use the recorded `url` and `pid`.
3. On Linux, macOS, or WSL, run the server in a long-running terminal:

   ```bash
   node "$skill_directory/scripts/server.mjs" --cwd "$PWD"
   ```

   Keep that terminal running and give the user the complete `Conversation Navigator` URL printed by the command. Stop it when the user asks, or let it stop after 30 minutes without a request.
4. For startup diagnostics, run `server.mjs` directly in the foreground with the same `--cwd` value.

Use `--no-open` only when automatic browser opening is unwanted.

If `codex` cannot be found, check `Get-Command codex` in PowerShell or `command -v codex` on POSIX, fix PATH, and start a new terminal. Windows starts the fixed `codex.cmd app-server` shim through `%ComSpec%`; POSIX starts `codex app-server` directly.

## Behavior and Boundaries

- Treat the viewer as read-only. It calls Codex App Server only to list and read threads.
- Filter to VS Code and Codex CLI threads whose stored working directory exactly matches the launch directory.
- Let the user filter the thread list between all sources, VS Code, and Codex CLI.
- Show the exact launch working directory in the status bar.
- Open local file links in a read-only code viewer backed by an endpoint limited to regular files below the exact launch directory; show line numbers, target linked lines, and extension-aware syntax highlighting with a plain-text fallback.
- Explain an empty result in terms of that exact-directory filter and suggest relaunching with the appropriate `--cwd` value.
- Warn that the server has no access control, so any process on the same machine can read its conversation API while it is running.
- Do not claim this can scroll or alter the official Codex panel. Clicking a user message navigates within the companion page.
- Preserve the running POSIX/WSL terminal while the user is using the navigator; Windows uses the detached launcher instead.
