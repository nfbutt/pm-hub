# Hands free, easy, and together

What the research and the code say about making pm-hub usable without a keyboard, without a mouse, and with other people — and what to build, in what order.

The research is in `research_notes/Hands free and collaborative/`: *voice first design* (voice interfaces, eyes-free design, accessibility), *collaborative planning* (how teams actually plan together, and what AI does to a room), and *command surfaces* (command palettes, natural-language actions, pointing costs, recovery). The code assessment below is from reading the app.

## The six findings that matter

**1. A voice loop is a conversation, not a dictation box.** The tools that work (VS Code's voice mode, Vox, Kiro) are full-duplex: you speak a turn, the app answers *out loud*, and you can interrupt it. The ones that fail are dictation boxes. The pattern that separates them is **mixing modalities per turn**: speak one turn, type the next, and keep the transcript editable. Cursor 2.0's voice is the canonical failure report — no way to patch a misheard word, 70–80% empty submissions on custom submit keywords, a shortcut that collides. pm-hub's microphone today is one-way dictation into a text field, and `speak()` in `src/ai/voice.ts` is **dead code**: the app has never said a word.

**2. Spoken confirmations do not work; directive prompts do.** In the speech-acts literature, people ignore "yes/no?" questions. What works is telling them what to say: *"Say cancel, send, or review."* And confirm only what cannot be undone — some irreversibility should be designed, not masked.

**3. Measure slots, not words.** Word error rate is the wrong metric: slot error rate runs 6–12 points above it and compounds (three slots at 85% each is 61% success). The mitigations that work are contextual biasing, a confidence-thresholded verbal confirmation, transcript cleanup, an always-visible transcript, a typed fallback for the next turn, and undo. **Recovery is driven by feedback, not by confidence.**

**4. Tools converge on "one author, comments, a status ritual" — not shared editing.** Real-time co-editing exists only in *document* layers (Notion pages, Linear documents). Every structured plan tool — Jira, Linear, Asana, monday, GitHub Projects, Plane — is last-writer-wins on fields. Linear's own house style is "the project lead writes the spec; others collaborate on the brief". **Building co-editing into a plan tool would be building the wrong thing.** What pays, per the team research, is a *shared mental model* (r = .44) and a legible record — a "meeting bridge" between the synchronous and the asynchronous. And when an AI is in the room it changes the group: AI exposure measurably shifts shared language, attention and cohesion, and people show lower mutual responsivity. The pattern that survives is **AI proposes, a named human disposes, the diff is visible, the decision is recorded**.

**5. One surface beats two.** A command palette has no controlled evidence of its own, but two things recur: a *global* top result that section grouping never demotes, and scoping chips instead of modes. And the strongest number in the command-surface research is a warning: **LLM command execution tops out near 0.73 success, with "wrong argument" and "missing argument" as the dominant errors.** So the routing has to be deterministic wherever it can be — the model should fill in what a grammar cannot, not decide the whole intent.

**6. Voice is not accessible on its own.** Consumer ASR is far worse for dysfluent speech (23.8% utterance truncation against a 9.9% tuned baseline), and 37% of people who stutter refuse voice for privacy and effort. WCAG 2.5.6 requires concurrent mechanisms, not voice alone. Eyes-free design research adds: an ambiguous spoken alert needs a visual or haptic pair, and only one spoken alert at a time — speech costs working memory that the visual channel does not.

## What the code says

Read against the findings, the app's gaps are specific:

| Area | What is missing |
|---|---|
| **Voice** | `speak()` and `stopSpeaking()` exist and are never called. The microphone is click-only, one-way, gated on the *Epic Map* checkbox rather than the speech server, with no intent parsing, no target resolution, no confirmation and no spoken feedback. |
| **Targets** | The command menu resolves a target by **exact key equality on the mouse selection** (`src/ui/CommandMenu.tsx:32`). There is no keyboard way to *select* an item, so every selection-scoped command is mouse-only. The fuzzy machinery exists and is not wired to anything: `src/model/epicmap/text.ts` (tokenise, stem, cosine), `analyze()`'s `ownSim`/`best`, the embeddings, `evidenceFound`. `Picker.tsx`'s filter is a substring match living inside a React component. |
| **Intentions** | `src/model/edits.ts` is a rich vocabulary of 20 pure helpers and the Epic Map gives move/merge/split/gap as `Op[]`. Missing: a **named-epic merge**, **archive / park / reorder** helpers, and any **relative-date expression** — "two weeks later" has no parser at all. |
| **Reachability** | Everything except `Ctrl+K` is dead while typing (the input guard at `ProjectScreen.tsx:83`). No hotkey for Review, Apply or Dry run; Review is not even in the command menu. |
| **Accessibility** | `Drawer` and `Modal` do no focus management: no focus-in, no focus trap, no restore — and a Modal stacked on a Drawer closes both on one Escape. There is **one** live region in the whole app (the toast). The Gantt and the Epic Map are `role="img"`: their meaning is invisible to a screen reader. The picker has no `aria-activedescendant`. |
| **Collaboration** | The *draft* and every scenario are one per-browser IndexedDB blob (`changes:<owner>/<number>`) — no lock, no version, no merge, no presence. Only the *history* is shared, as append-only files. pm-hub **cannot read a colleague's issue comment or project status update** — the `ITEM` fragment has no `comments` connection and there is no status-update query. So the only channel from a colleague back in is the project data itself. |
| **One race** | The apply reuses the snapshot taken during the check instead of re-reading immediately before writing, and the writes are unconditional. pm-hub's re-read gate is stronger than any mainstream tool ships — and it has a hole in the last second. |

## The design

### One surface that takes speech, keys or typing

A single command bar, always one keystroke away, that resolves a *target* and an *action* and turns them into ordinary ops. Three inputs, one parser:

```
"move the API epic two weeks later"     →  intent {action: "shift", target: "API epic", days: +14}
"put the invoice screen in Release 2"    →  intent {action: "release", target: "invoice screen", value: "Release 2"}
"what's blocking the platform epic?"    →  answer, read out loud
```

The routing is **deterministic first, model second**:

1. **Target resolution** — a pure `findTargets(project, mapping, phrase)`. Type-aware ("the API *epic*" means an epic), number-aware ("#123"), release-aware ("in the March release"), and fuzzy over titles with the existing text machinery. One match, use it; several, ask — *as a list you can answer with a word or a number*.
2. **Intent parsing** — a grammar for the actions that exist (shift, move, set, close, block, merge, create, undo), with a slot-filling model call only for what the grammar cannot parse. Every slot is validated: a date that parses, a target that exists, a release that exists. **A missing or wrong argument is the dominant failure mode, so the parser never invents one** — it asks.
3. **Turning it into ops** — the existing helpers in `src/model/edits.ts`, plus the few that are missing (named merge, archive, relative dates). Nothing new reaches GitHub: a spoken command produces the same `Op[]` a mouse click does, so it undoes the same way and is reviewed the same way.

### A real voice loop

- **Push to talk** on a key handled *before* the input guard, so it works while typing.
- **The app answers out loud** — `speak()` wired at last — and you can interrupt it (`stopSpeaking()`).
- **Directive prompts, not questions**: "Say cancel, send, or review", never "did you mean yes?".
- **The transcript is always visible and always editable** — that is the mixing of modalities, and it is the mitigation for the mishearing rate.
- **Confirm only what cannot be undone.** Closing an issue, removing a blocker, archiving an item: those get a spoken confirmation. Moving a date, changing a release: they do not.
- **Every spoken answer also lands somewhere visible** (the toast, the live region) — the eyes-free rule: one spoken alert at a time, and never a spoken alert that is not also shown.

### Together, without building co-editing

The research is clear that structured plans are not co-edited, so pm-hub should not try. What it can do is the thing that actually pays:

- **Let pm-hub read what colleagues said.** Issue comments and project status updates are the missing channel. With them, pm-hub can show "Ana commented: the API slips a week" next to the thing it affects.
- **Publish a draft as a proposal** in the shared history folder — append-only, as the folder already is. A colleague opens it, sees the diff, and applies it. One author, a legible proposal, a named disposer.
- **Name who disposed of what.** The change record already has the author and the per-step reasons; it should also say who accepted each suggestion, because "AI proposes, a named human disposes" is the pattern that survives a room.
- **Close the last-second race**: re-read the affected items immediately before writing, and refuse to write against something that changed underneath.
- **Keep the meeting bridge.** A dated, readable record of what was decided and why is what lets somebody who was not in the room pick the plan up.

### And the easy part

- **Focus management** in the drawer and the modal: focus in, focus trapped, focus restored.
- **One live region** that announces what changed, for everybody.
- **A keyboard way to select** items, so the command surface and `[`/`]` stop being mouse-only.
- **A text alternative for the charts**: the Plan table already is one; the Gantt and the Epic Map should point at it rather than being `role="img"` with the meaning inside the picture.
- **Hotkeys for the things you do every time**: review, apply, dry run.

## The phases

### Phase 15: one command surface — done

`src/model/command/` with `findTargets` (type-aware, number-aware, fuzzy), `parseIntent` (a grammar first, then the model for the rest), `intentOps` (routing to the edits helpers, plus the named-merge and archive the app was missing) and `dates` ("to the 15th", "next Friday", "end of the month").

The sentence is a pinned entry in the command menu, with a preview of what it will do; when it does not say which item it meant, it asks. A model fills in what the grammar cannot, and only what passes the checks: an action that is one of ours, a target that is in the project.

### Phase 16: the voice loop — done

Push to talk on `Ctrl+Shift+Space` (read before the "you are typing in a field" rule, so it works anywhere). The app answers out loud — what it did, and what it needs to know next — with directive prompts rather than yes/no questions.

### Phase 17: together — done

A **proposal**: put your changes up in the shared plan history instead of applying them, and whoever picks one up gets exactly what was drafted and reviews it before anything is written. **What the team has said**: pm-hub now reads the comments on the plan's own issues, which were the one channel a colleague had that pm-hub could not see. **The last-second race** is closed: the review screen re-reads the affected items immediately before writing, and anything that moved underneath is left out rather than overwritten. The person who disposed of a suggestion was already recorded.

### Phase 18: easy for everyone — mostly done

Done: focus management in the drawer and the modal (focus in, trapped, restored), one live region for the review screen's progress and result, unique ids and `aria-activedescendant` in the picker, roles on the progress bars, tab panels for the Workload tabs, a keyboard way to select a row (space), "Go to Review" in the command menu, and the chart views saying where the same information can be read as text.

Still to do: a text equivalent of the Gantt and the Epic Map for screen readers (the Plan table and the Epic Map's panel are the nearest), and the Epic Map's live region, which mounts with its text already in it and so may not be announced.

## What not to do

- **Do not build co-editing.** Every structured plan tool is last-writer-wins, and the evidence says the payoff is a legible record and a shared mental model, not a merge algorithm.
- **Do not build a wake word.** Push to talk on a key is more reliable, more private, and does not record anything when you are not talking.
- **Do not let the model decide the whole intent.** LLM command execution tops out near 0.73, and the errors are missing and wrong arguments. Parse deterministically, ask when a slot is missing, and never invent one.
- **Do not make voice the only way in.** It is worse for dysfluent speech, worse in noise, and worse for privacy. Voice is a second front door to a surface that must also work by keyboard.
- **Do not confirm everything out loud.** Confirm only what cannot be undone, and never with a yes/no question.
