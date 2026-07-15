# Unified Session and Skill Sync UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fragmented local/cloud sync UI with comparable session cards and a unified Skill list whose detail pane exposes Local, Remote, and Diff views.

**Architecture:** Keep existing sync/storage models and Supabase security rules. Add pure renderer view-model helpers for unified Skill entries, a core Skill content-diff model exposed through one IPC call, and explicit overlay navigation for remote-session previews. Use one operation-status source per batch action so running text is always replaced by a terminal result.

**Tech Stack:** TypeScript, Electron IPC, React 19, Vitest, CSS, existing Supabase REST/Storage clients.

## Global Constraints

- Use the current `codex/stabilize-sync-experience` development branch and keep the existing single release note.
- Do not access or mutate real user sessions, Skills, Supabase data, npm prefixes, or Electron runtimes in tests.
- Do not change Supabase schema or broaden existing grants/RLS policies.
- Preserve six sync states and never select an overwrite direction from modification time alone.
- Plugin, System, and Project Skills remain managed by their owning system and never receive unsafe cloud actions.

---

### Task 1: Remote Preview Navigation and Batch Upload Status

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/detail-panel.tsx`
- Modify: `src/renderer/src/components/skills-dialog.tsx`
- Modify: `src/renderer/src/styles.css`
- Create: `src/renderer/src/sync-navigation-ui.test.ts`

**Interfaces:**
- Adds optional `backdropClassName?: string` to `DetailPanel`.
- Remote preview keeps `remoteSessionsOpen === true`; `closeRemoteDetail()` clears the preview before the list can close.
- `SkillsDialog.uploadSelected()` uses App-owned `feedback` for upload progress and does not leave a second local running banner.

- [ ] **Step 1: Write failing navigation and progress source-contract tests**

Assert that `openRemoteDetail` does not call `setRemoteSessionsOpen(false)`, remote detail uses `backdropClassName="remote-detail-backdrop"`, Escape handles `remoteDetail` before `remoteSessionsOpen`, and the upload-selected function does not assign `Uploading ... Skills` to local `batchFeedback`.

- [ ] **Step 2: Run `npx vitest run src/renderer/src/sync-navigation-ui.test.ts` and verify RED**

Expected: failures show the list is closed before preview and local batch text remains terminally stale.

- [ ] **Step 3: Implement overlay navigation and one upload status source**

Keep the list mounted, give the remote detail backdrop a higher z-index, close detail before list on Escape, and remove the duplicate local upload progress assignment while retaining `batchBusy` and App feedback.

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run src/renderer/src/sync-navigation-ui.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/detail-panel.tsx src/renderer/src/components/skills-dialog.tsx src/renderer/src/styles.css src/renderer/src/sync-navigation-ui.test.ts
git commit -m "fix: preserve sync navigation state"
```

### Task 2: Comparable Remote Session Cards

**Files:**
- Modify: `src/renderer/src/components/remote-sessions-dialog.tsx`
- Modify: `src/renderer/src/styles.css`
- Create: `src/renderer/src/remote-session-card.test.ts`

**Interfaces:**
- Produces pure helpers `sessionCopySummary(item, side)` and `primarySessionAction(item)` for the six states.
- Each row renders `.remote-session-comparison` with `.local` and `.remote` copies and one `.remote-session-primary-action`.

- [ ] **Step 1: Write failing pure/state and source-contract tests**

Test all six states:

```ts
expect(primarySessionAction(localOnly)).toBe("upload");
expect(primarySessionAction(localNewer)).toBe("upload");
expect(primarySessionAction(synced)).toBe("view");
expect(primarySessionAction(remoteNewer)).toBe("restore");
expect(primarySessionAction(remoteOnly)).toBe("restore");
expect(primarySessionAction(conflict)).toBe("resolve");
```

Assert each side uses its own timestamp/message count, missing sides say `Not uploaded` or `No local copy`, and source contains a two-column comparison plus a secondary `MoreHorizontal` menu.

- [ ] **Step 2: Run `npx vitest run src/renderer/src/remote-session-card.test.ts` and verify RED**

Expected: helpers and comparison markup do not exist.

- [ ] **Step 3: Implement the comparison card and state-based primary action**

Use neutral local/cloud headers, one semantic sync-state badge, one primary action, and a `…` menu for View, restore-to-source, and delete. Conflict primary action opens a two-choice dialog for force-upload or restoring a new local copy.

- [ ] **Step 4: Run test and typecheck**

Run: `npx vitest run src/renderer/src/remote-session-card.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/renderer/src/components/remote-sessions-dialog.tsx src/renderer/src/styles.css src/renderer/src/remote-session-card.test.ts
git commit -m "feat: compare local and cloud sessions"
```

### Task 3: Unified Skill Entry and Content Diff Models

**Files:**
- Create: `src/renderer/src/skill-sync-view-model.ts`
- Create: `src/renderer/src/skill-sync-view-model.test.ts`
- Create: `src/core/skill-diff.ts`
- Create: `src/core/skill-diff.test.ts`

**Interfaces:**
- Produces `UnifiedSkillEntry` with `id`, `identity`, `name`, `source`, `local`, `remote`, `relation`, `state`, and `syncable`.
- Produces `buildUnifiedSkillEntries(installed, sync): UnifiedSkillEntry[]`.
- Produces `SkillDiffSnapshot` and `buildSkillDiffSnapshot(local, remote)` with file statuses `added | removed | modified | unchanged`.

- [ ] **Step 1: Write failing unified-entry tests**

Cover matched local/remote identity, local-only, remote-only, same-name/different-identity, legacy records, unhealthy Supabase with local entries, and non-syncable Plugin/System/Project entries.

- [ ] **Step 2: Run `npx vitest run src/renderer/src/skill-sync-view-model.test.ts` and verify RED**

Expected: module does not exist.

- [ ] **Step 3: Implement the pure unified-entry builder**

Merge only through `SkillSyncRelation.localSkillPath` and `remoteFingerprint`; never merge by display name. Append remaining local and remote records with stable prefixed ids.

- [ ] **Step 4: Run unified-entry tests and verify GREEN**

Run: `npx vitest run src/renderer/src/skill-sync-view-model.test.ts`

- [ ] **Step 5: Write failing Skill diff tests**

Cover identical files, added/removed/modified text, binary changes, SKILL.md default ordering, and local-only/remote-only snapshots. Assert text diffs use `-` and `+` lines while binary files expose sizes/hashes only.

- [ ] **Step 6: Run `npx vitest run src/core/skill-diff.test.ts` and verify RED**

Expected: module does not exist.

- [ ] **Step 7: Implement bounded line diff and file comparison**

Decode synthetic base64 snapshots, classify binary content, use a bounded LCS for text files, and cap rendered diff input to avoid unbounded UI work.

- [ ] **Step 8: Run both model tests and verify GREEN**

Run: `npx vitest run src/core/skill-diff.test.ts src/renderer/src/skill-sync-view-model.test.ts`

- [ ] **Step 9: Commit Task 3**

```bash
git add src/core/skill-diff.ts src/core/skill-diff.test.ts src/renderer/src/skill-sync-view-model.ts src/renderer/src/skill-sync-view-model.test.ts
git commit -m "feat: model unified skill sync details"
```

### Task 4: Skill Diff IPC

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/skill-sync-ipc.test.ts`

**Interfaces:**
- Adds renderer API `getSyncedSkillDiff(localSkillPath: string | null, remoteSkillId: string | null): Promise<SkillDiffSnapshot>`.
- Adds IPC channel `skills:sync-diff`.

- [ ] **Step 1: Add failing IPC contract assertions**

Assert main registers `skills:sync-diff` and preload exposes `getSyncedSkillDiff` with nullable local/remote arguments.

- [ ] **Step 2: Run `npx vitest run src/main/skill-sync-ipc.test.ts` and verify RED**

- [ ] **Step 3: Implement the IPC handler**

Resolve the local Skill only from the installed snapshot, fetch the requested remote version through the existing authenticated client, convert both sides to content snapshots, and call `buildSkillDiffSnapshot`. Reject paths not present in the installed Skill list.

- [ ] **Step 4: Run IPC/model tests and typecheck**

Run: `npx vitest run src/main/skill-sync-ipc.test.ts src/core/skill-diff.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/main/index.ts src/preload/index.ts src/main/skill-sync-ipc.test.ts
git commit -m "feat: expose skill content differences"
```

### Task 5: Unified Skills List and Local/Remote/Diff Detail

**Files:**
- Modify: `src/renderer/src/components/skills-dialog.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/skills-dialog-actions.test.ts`
- Modify: `src/renderer/src/supabase-setup-guide.test.ts`

**Interfaces:**
- Replaces list-level `syncView` with `detailView: "local" | "remote" | "diff"`.
- Consumes `buildUnifiedSkillEntries()` and `getSyncedSkillDiff()`.
- Keeps Remote detail selectable even when sync status is unconfigured or unhealthy.

- [ ] **Step 1: Write failing unified-dialog source contracts**

Assert no top-level `skills-view-tabs` remain; list mapping uses unified entries; name and source badge share `.unified-skill-title`; detail tabs contain Local/Remote/Diff; Remote renders `SupabaseSetupGuide` only after selection; Diff renders file statuses and selected text diff.

- [ ] **Step 2: Run renderer tests and verify RED**

Run: `npx vitest run src/renderer/src/skills-dialog-actions.test.ts src/renderer/src/supabase-setup-guide.test.ts`

- [ ] **Step 3: Implement unified selection, filters, and title layout**

Render one row per `UnifiedSkillEntry`, place the source badge immediately after an ellipsized name, display one sync-state label, and keep managed-skill descriptions without cloud checkboxes.

- [ ] **Step 4: Implement Local/Remote/Diff detail tabs**

Local shows installed metadata/content or not-installed state. Remote shows setup/config guidance, version history, content, and safe actions. Diff loads lazily for the selected local/remote version and shows the file summary plus selected text diff.

- [ ] **Step 5: Implement contextual bulk actions and terminal feedback**

Show Upload, Update local, and Delete cloud counts only when selected entries support them. Keep failed/conflicting entries selected and replace running text with the structured result.

- [ ] **Step 6: Run renderer/model tests and typecheck**

Run: `npx vitest run src/renderer/src/skills-dialog-actions.test.ts src/renderer/src/supabase-setup-guide.test.ts src/renderer/src/skill-sync-view-model.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/renderer/src/components/skills-dialog.tsx src/renderer/src/styles.css src/renderer/src/skills-dialog-actions.test.ts src/renderer/src/supabase-setup-guide.test.ts
git commit -m "feat: unify local and remote skills"
```

### Task 6: Release Note and Full Verification

**Files:**
- Modify: `.release-notes/stabilize-sync-experience.md`

- [ ] **Step 1: Update the existing user-facing bullets**

Describe the comparable session cards, preview return behavior, unified Skill details/diff, and completed batch feedback without mentioning implementation details.

- [ ] **Step 2: Run complete verification**

```bash
git diff --check
npm run release-note:check
npm test
npm run typecheck
npm run build
```

Expected: all checks pass with no leftover Electron process or generated test fixture.

- [ ] **Step 3: Commit release note**

```bash
git add .release-notes/stabilize-sync-experience.md
git commit -m "docs: update unified sync release notes"
```
