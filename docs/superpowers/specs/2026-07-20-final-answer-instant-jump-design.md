# Final-Answer Transcript and Instant Jump Design

## Goal

Change Conversation Navigator so the transcript shows only each completed turn's final Codex answer and clicking a user-message outline entry moves to it immediately.

## Confirmed Behavior

- Continue showing every user message and using it as the navigation anchor.
- Show an `agentMessage` only when its App Server `phase` is exactly `final_answer`.
- Never send `commentary` messages to the browser.
- Do not substitute the latest commentary message when a turn is still running. Until a `final_answer` arrives, that turn shows only its user message.
- Keep reasoning, command, tool, and other non-message items hidden as before.
- Preserve search, active-message highlighting, polling, scroll-position preservation during refresh, and all existing privacy controls.

## Selected Approach

Filter assistant messages in the server-side thread projection. This keeps process messages out of the HTTP response entirely and gives every UI consumer the same behavior.

This is preferred over choosing the last assistant message in a turn because a running turn's last message can still be commentary. It is also preferred over filtering in the browser because that would unnecessarily transmit process messages and duplicate the rule in a less trusted layer.

For navigation, keep `scrollIntoView` but request non-animated behavior and remove the transcript's CSS smooth-scrolling rule. The target remains aligned to the start of the transcript viewport and the selected outline entry remains highlighted.

## Data Projection

For each turn:

1. Convert every `userMessage` into a transcript message and navigation entry.
2. Ignore all `agentMessage` items whose `phase` is not `final_answer`.
3. Convert `agentMessage` items with `phase: "final_answer"` into assistant transcript messages.
4. Keep the turn when it contains at least one visible message.

The filter is strict. Legacy or incomplete agent messages without a `final_answer` phase are not displayed.

## Instant Navigation

When an outline button is clicked:

1. Find the corresponding user-message element.
2. Call `scrollIntoView` with immediate behavior and start alignment.
3. Update the active outline state.

The transcript stylesheet must not set `scroll-behavior: smooth`, so the browser cannot animate the jump through inherited container behavior.

## Testing

- Add a projection test containing commentary and final-answer items; assert only the user message and final answer remain.
- Add a projection test for an unfinished turn; assert its commentary is hidden and its user message remains.
- Add a frontend helper test that verifies navigation requests immediate start-aligned movement.
- Add an asset check ensuring the transcript stylesheet does not enable smooth scrolling.
- Run the complete Node test suite, skill validator, and a live App Server smoke test against a local conversation containing both phases.

## Completion Criteria

- No `commentary` text appears in the projected API response or browser transcript.
- A completed turn shows its `final_answer` content.
- An incomplete turn shows its user message but no Codex process message.
- Clicking an outline item changes position without animated scrolling.
- Existing search, highlighting, polling, authentication, and read-only behavior continue to pass their tests.
