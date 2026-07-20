# Conversation Navigator Design

## Goal

Create a personal Codex skill that starts a local, read-only conversation viewer. The viewer lists user messages in a left-hand outline and scrolls the transcript to the selected turn. It complements the official Codex VS Code surface without modifying or controlling that surface.

## Assumptions

- The user runs Codex locally or through VS Code/WSL with `codex` available on `PATH`.
- The installed Codex version supports `codex app-server`, `thread/list`, and `thread/read` with `includeTurns`.
- Exact scrolling inside the official Codex panel is out of scope because no public reveal-turn API exists.
- The current working directory is the primary signal for selecting relevant VS Code threads.

## Selected Approach

Build a dependency-free Node.js service bundled in a personal Codex skill. The service spawns `codex app-server` over stdio, reads structured thread data, and serves a vanilla HTML/CSS/JavaScript viewer on a random loopback port.

This approach was selected over:

- A Codex plugin, because plugins are not an IDE UI extension mechanism.
- A VS Code extension, because the user explicitly prefers a Codex-side workflow.
- Patching the official Codex extension, because updates would overwrite a fragile private-DOM integration.
- Reading rollout JSONL directly, because App Server is the supported structured interface.

## Project and Installation Layout

Develop in `/home/user/codex-conversation-navigator` and keep the installable skill isolated under `skill/conversation-navigator/`:

```text
codex-conversation-navigator/
├── docs/superpowers/specs/
├── package.json
├── tests/
└── skill/conversation-navigator/
    ├── SKILL.md
    ├── agents/openai.yaml
    ├── scripts/
    └── assets/web/
```

Install by symlinking the skill directory to `~/.codex/skills/conversation-navigator`. This keeps the development checkout testable while making changes immediately visible to Codex.

## Components

### Skill Instructions

Trigger on requests to browse, search, or navigate local Codex conversation history. Instruct Codex to launch the bundled server for the current working directory, report the local URL, and keep the server process running in the background. Do not edit or delete session data.

### App Server Client

- Spawn `codex app-server` using stdio.
- Send `initialize`, then the `initialized` notification.
- Correlate JSON-RPC responses by request ID.
- Surface process exits, malformed responses, and protocol errors as explicit failures.
- Call `thread/list` with:

```json
{
  "cwd": "<current-directory>",
  "sourceKinds": ["vscode"],
  "sortKey": "updated_at",
  "sortDirection": "desc"
}
```

- Call `thread/read` with `includeTurns: true` for the selected thread.

### Local HTTP Server

- Bind only to `127.0.0.1` on an OS-assigned port.
- Generate a random access token and require it on API requests.
- Serve static UI assets and JSON endpoints for thread listing and thread reading.
- Print the viewer URL and make a best-effort attempt to open it in the default browser.
- Shut down the App Server child on process exit.
- Exit after an idle timeout when no browser has requested data.

### Browser UI

- Show a thread selector when multiple matching conversations exist.
- Show a searchable left outline containing numbered user-message excerpts.
- Show a right transcript grouped by turn.
- Render every user message and only `final_answer` agent messages as sanitized Markdown; represent non-text user input with compact labels.
- Jump immediately to a turn when its outline entry is clicked.
- Highlight the visible turn using `IntersectionObserver`.
- Poll the selected thread every two seconds and append changed content without forcing the user's scroll position.
- Keep command executions, reasoning, and tool details out of the first version.

## Data Flow

1. Codex runs the launcher with the current working directory.
2. The launcher starts the loopback HTTP server and App Server client.
3. The browser requests matching threads.
4. The service selects the most recently updated VS Code thread by default.
5. The browser requests that thread with turns included.
6. The UI derives one navigation entry from each turn's `userMessage` item.
7. Clicking an entry calls `scrollIntoView` on the corresponding turn element.
8. Polling refreshes the same structured thread response for live updates.

## Security and Privacy

- Never read Codex authentication files.
- Never expose the HTTP server beyond loopback.
- Never send transcript data to an external service.
- Never expose mutation endpoints.
- Use a random token so unrelated browser pages cannot casually call the local API.
- Treat all transcript text as untrusted and render it as text or as a DOMPurify-sanitized `DocumentFragment`, never as unsanitized HTML.

## Error Handling

- Missing `codex`: print a direct installation/PATH error.
- App Server handshake failure: stop the HTTP server and report the protocol error.
- No matching VS Code thread: show an empty state with the requested working directory.
- Thread read failure: retain the last successful transcript and show a non-destructive status banner.
- Browser disconnected: continue until the idle timeout, then exit cleanly.

## Testing

Use Node's built-in test runner with no third-party dependencies.

- Unit-test JSON-RPC request correlation, protocol errors, and child-process exit handling.
- Unit-test extraction of user-message navigation entries and transcript text.
- Unit-test HTTP authentication and loopback API responses with a mocked App Server client.
- Test UI transformation functions independently where practical.
- Run the skill validator against the final skill directory.
- Perform a live smoke test against the local Codex App Server and verify that a current VS Code conversation renders and can be navigated.

## Completion Criteria

- `$conversation-navigator` is discoverable as a personal Codex skill.
- Launching it starts a loopback-only viewer for the current working directory.
- The most recent matching VS Code thread loads by default.
- Every text user message appears in the outline.
- Clicking an outline entry scrolls to the correct turn.
- Search and two-second refresh work without changing Codex session data.
- Automated tests and skill validation pass.
