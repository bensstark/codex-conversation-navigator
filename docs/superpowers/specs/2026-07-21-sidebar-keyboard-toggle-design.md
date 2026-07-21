# Sidebar Keyboard Toggle Design

## Goal

Let users press `s` while reading Conversation Navigator to hide or show the user-message sidebar without adding a visible control.

## Confirmed Behavior

- Pressing `s` or `S` outside editable controls toggles the sidebar.
- The shortcut does not run from `input`, `textarea`, `select`, or content-editable elements.
- The shortcut ignores events with `Ctrl`, `Alt`, or `Meta`, and ignores key-repeat events.
- Hiding the sidebar immediately expands the conversation panel to the full available width.
- The hidden state is not persisted. Reloading the page restores the sidebar.
- No button, status message, or other new UI is added.

## Selected Approach

Add a document-level `keydown` listener that delegates shortcut recognition to an exported, testable helper. When the helper accepts the event, toggle a `sidebar-hidden` class on `document.body`.

CSS tied to that class will hide `.outline-panel` and change the main grid to one column. This keeps keyboard policy in JavaScript and visual state in CSS, avoids inline-style mutation, and removes the hidden sidebar from layout and interaction.

## Components

### Shortcut recognition

An exported helper decides whether a keyboard event is the sidebar shortcut. It accepts `s` case-insensitively and rejects modified, repeated, or editable-target events.

### Sidebar state transition

An exported helper toggles `sidebar-hidden` on the provided document body. It holds no persistent state; the DOM class is the current state.

### Layout

The existing two-column layout remains the default. Under `body.sidebar-hidden`, the outline panel is not displayed and `main` uses a single full-width column. The rule also applies under the existing narrow-screen media query.

## Event Flow

1. The document receives `keydown`.
2. Shortcut recognition checks the key, modifiers, repeat state, and event target.
3. Rejected events continue normally.
4. An accepted event toggles `body.sidebar-hidden`.
5. CSS immediately hides or restores the outline and recalculates the conversation width.

## Testing

- Unit-test that bare `s` and `S` are accepted.
- Unit-test rejection for other keys, `Ctrl`/`Alt`/`Meta` combinations, repeat events, and editable targets.
- Use jsdom to verify two successive toggles hide and restore the sidebar class.
- Add static asset assertions for the sidebar-hidden CSS rules and the absence of a new button.
- Run the complete Node test suite and the Conversation Navigator skill validator.

## Completion Criteria

- Bare `s` toggles the sidebar while reading.
- Typing in existing controls is unaffected.
- Hidden mode gives the conversation panel the full content width on desktop and narrow screens.
- Reloading begins with the sidebar visible.
- Existing navigation, search, Markdown rendering, polling, authentication, and read-only behavior remain unchanged.
