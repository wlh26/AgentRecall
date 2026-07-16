# Terminal Title Synchronization Design

## Goal

Keep the external terminal window or tab title aligned with the session name shown in Agent-Session-Search.

When a user renames a session:

- an already-running local session should update its owning terminal title immediately when the terminal exposes a safe targeting API;
- a session opened later through Resume should start with the saved display title;
- saving the session name must remain successful even when terminal synchronization is unavailable or fails.

The title being synchronized is the saved `displayTitle`: a non-empty custom title, or the existing original-title/first-question fallback after a custom title is cleared.

## Current Behavior

The renderer calls `setCustomTitle`, and the main-process `title:set` handler only writes `custom_title` through `SessionStore`. Resume of an already-live session uses the live PID to focus its terminal, but does not alter the terminal title.

The existing live-session path already provides the important correlation data:

1. match the indexed session to a live session by source family and raw id;
2. inspect the live process and its parent chain;
3. identify the terminal application;
4. on macOS, read the process TTY and use it to target Terminal or iTerm.

The new behavior should reuse this boundary instead of teaching the renderer about operating-system processes.

## Scope

### Included

- local sessions that are currently live;
- sessions opened by the default Resume action and the explicit iTerm Resume action;
- macOS Terminal and iTerm exact live-title synchronization by TTY;
- launch-time title setup for supported macOS, Windows, and POSIX shell paths;
- best-effort adapters for terminals with a documented command or control-sequence path;
- safe title normalization and shell/AppleScript escaping;
- automated tests for live-session matching, title scripts, launch arguments, fallback behavior, and rename persistence.

### Not included

- changing the Agent-Session-Search Electron window title;
- changing terminal profile configuration or shell startup files;
- synchronizing titles for remote sessions that are already running outside the local process snapshot;
- injecting keystrokes or commands into an active agent process or shell;
- guaranteeing that a terminal or CLI will never overwrite a title after the synchronization attempt;
- adding a user-facing terminal-title setting in the first version.

## Design

### 1. Title normalization

Create one shared title-normalization path for persistence-to-terminal synchronization:

- trim surrounding whitespace;
- replace line breaks and other non-display control characters with spaces or remove them;
- preserve normal Unicode characters;
- cap the terminal title at a conservative display length without changing the stored session title;
- escape the normalized value separately for AppleScript, PowerShell, cmd, and POSIX shell contexts.

The stored session title remains governed by the existing `setCustomTitle` behavior. Normalization is only for the external terminal command or script.

### 2. Rename IPC flow

Make the main-process `title:set` handler asynchronous:

1. read the session before the update so a missing session remains a no-op;
2. persist the requested custom title;
3. read the updated session to obtain the final `displayTitle` fallback;
4. ask the cached live-session loader for the matching local PID;
5. attempt terminal-title synchronization for that PID;
6. swallow and log synchronization failures without rolling back the database update.

The renderer API remains a single rename operation. It does not receive process IDs, TTYs, terminal names, or platform-specific errors.

### 3. Live-session terminal adapters

Extend the existing process/TTY discovery boundary with a title operation that does not focus or activate the terminal unless the terminal API requires it.

#### macOS Terminal

Use the process TTY to find the matching Terminal tab and set its custom title. The script must target only the matching tab and must not send text to the active shell.

#### macOS iTerm

Use the process TTY to find the matching iTerm session and set its session/tab title through iTerm's scripting interface. iTerm documents both AppleScript support and TTY/session metadata for scripting.

#### WezTerm

Use `wezterm cli set-tab-title` when a pane ID can be safely associated with the live process. If the pane cannot be identified or the CLI is unavailable, report an unsupported/best-effort result and leave the persisted title unchanged. The official CLI accepts an explicit pane or tab ID.

#### Ghostty, Warp, and unsupported Windows live sessions

Do not inject input into the running shell or agent. If no safe external targeting API is available, skip the immediate live update and keep the title synchronized on the next Resume launch.

This is intentional: a failed live-title update must never risk sending control text to the user's active coding session.

### 4. New terminal launch titles

Pass the normalized title through the existing terminal launch functions.

- Terminal/iTerm use their session/tab creation APIs when possible, then set the title on the returned target.
- Windows Terminal receives a title at launch and suppresses application-title overwrites when the launch path supports that flag. PowerShell and cmd fallback commands set their own shell title before starting the resume command.
- POSIX shell paths use the standard OSC title sequence before the resume command.
- Ghostty, WezTerm, and Warp use their existing launch path with the safest available title mechanism; unsupported launch-time title control remains best effort.

The title must be applied without changing the resume command's session ID, working directory, SSH arguments, permission flags, or environment behavior.

Windows Terminal documents both shell-level title commands and the distinction between accepting application title changes and suppressing them. POSIX title setup follows the same OSC mechanism documented by Microsoft for bash. WezTerm exposes explicit tab-title and pane-targeting commands.

References:

- [iTerm2 scripting](https://iterm2.com/documentation-scripting.html)
- [iTerm2 session variables](https://iterm2.com/documentation-variables.html)
- [WezTerm set-tab-title](https://wezterm.org/cli/cli/set-tab-title.html)
- [Windows Terminal tab titles](https://learn.microsoft.com/en-us/windows/terminal/tutorials/tab-title)
- [Windows Terminal command-line arguments](https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments)

## Error Handling and Compatibility

- A missing session, missing live PID, unsupported terminal, unavailable terminal CLI, or failed AppleScript is a non-fatal synchronization miss.
- The session rename is persisted even if synchronization fails.
- No active shell receives an injected command as part of live synchronization.
- Logs contain the terminal adapter and failure reason, but not raw credentials or shell environment values.
- Existing Resume routing, focus behavior, SSH handling, and remote-session preflight remain unchanged.
- Clearing a custom title resets the external terminal to the resulting fallback title rather than leaving the old custom title in place.

## Testing

### Core title and adapter tests

- normalize whitespace, control characters, Unicode, and long titles;
- escape quotes, backslashes, dollar signs, percent signs, cmd metacharacters, and AppleScript text;
- target Terminal/iTerm scripts by TTY and do not emit shell input commands;
- return a safe no-op for unsupported adapters;
- preserve errors from discovery separately from errors from the title adapter.

### Launch-plan tests

- include the title in Terminal/iTerm launch scripts;
- include title setup in Windows Terminal, PowerShell, cmd, and POSIX launch paths;
- preserve existing resume command quoting and arguments;
- verify titles containing spaces, quotes, Unicode, and shell metacharacters cannot alter the resume command.

### IPC and regression tests

- persist a renamed title and attempt synchronization for a matching live session;
- persist successfully when synchronization fails;
- use the fallback display title when a custom title is cleared;
- skip live synchronization for remote or unmatched sessions;
- keep existing focus and resume routing tests passing.

Verification commands:

```text
npm test
npm run typecheck
npm run build
npm run release-note:check
```

## Release Note

The implementation branch will add exactly one user-facing release note at `.release-notes/feat-sync-terminal-title.md`. It will describe that renaming a session also updates the related terminal title, without mentioning implementation details or unsupported-terminal internals.
