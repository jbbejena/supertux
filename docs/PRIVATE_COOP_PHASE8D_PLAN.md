# Phase 8D plan: replay, lobby and bounded room lifetime

Plan updated: 2026-10-12 UTC. This is a follow-on implementation plan, not a
claim that replay or longer rooms are available.

The user subsequently requested room lifetime first, then the failing CI check.
[PRIVATE_COOP_ROOM_LIFETIME.md](PRIVATE_COOP_ROOM_LIFETIME.md) records that
implementation on PR #19; the replay/lobby section below remains planned work.
Existing private staging remains on the previous runtime until tested publication.

## Starting point

Phase 8C is merged through [PR #18](https://github.com/jbbejena/supertux/pull/18)
at `a1b238334fdfdc8bc2fe8f731d2cf9b327808d1b` on `mobile-web-audit`.
The separate private preview publishes its tested candidate
`69576512df6e4f22b209fa2dd1748808dd2d673c`, whose source tree matches that merge,
through [38110972906](https://github.com/jbbejena/supertux/actions/runs/38110972906).
Delivery and 30 checks in each of hosted Chromium and Linux WebKit passed.
Normal Mobile Web Deploy updates the other, single-player Worker.

The user reports successful first-level phone play and an occasional Safari
Copy/Paste popup while pressing Jump. The accompanying touch patch disables
selection and Apple touch callouts on play surfaces, while retaining host
invitation copy/paste. Confirm it on an actual iPhone after publishing the tested
candidate; Linux WebKit cannot certify the native iOS popup is gone.

Host/Join, artwork retry, shared camera, neutral pause/Resume, bounded heartbeat
recovery and save-preserving title restart already exist. Do not rebuild those
features as Phase 8D. Welcome to Antarctica remains the one supported level.

The merge's [focused validation](https://github.com/jbbejena/supertux/actions/runs/38111533753)
failed in Release WebKit's intermediate-geometry assertion after building
successfully; Chromium shared-view and lobby checks passed. The moving sample
ended as soon as the player moved 30px, without waiting for two repaints in one
snapshot interval. The accompanying test correction gives the same geometry
condition a bounded five-second observation window before releasing movement.
It retains the original assertion and fails if the condition never occurs;
the failure evidence remains recorded. This does not change gameplay or certify
physical-phone performance.

## Player outcome

After finishing the level, the host can choose **Replay** or **Return to lobby**.
Player 2 sees the same result and waiting/loading state. A connected pair can
play another round without exchanging another invitation. A paused or active
room no longer silently ends at the invitation's 15-minute deadline. Permanent
connection loss still uses the existing title/fresh-invitation recovery path.

## First PR: completion and another round

1. Represent explicit waiting, loading, playing, paused, interrupted, complete
   and lobby states in the host UI, with a matching guest message. Keep native
   session/epoch/generation authoritative; one `started` boolean currently keeps
   the ordinary Start button hidden after the first round.
2. Retain the existing result message's session/epoch/generation checks. Show
   the final shared image and result with controls neutral. Only the host can
   choose Replay or Return to lobby; repeated clicks cannot start two rounds.
3. Add a narrow host-only native transition at the normal input/screen boundary.
   The present start command only works from TitleScreen, and normal completion
   can return to the world map. Do not fake replay by invoking the title-only
   command from an active or fading GameSession. Flush earned host progression
   before leaving the completed session; failed saving keeps it open with retry.
4. Keep the authenticated room and remote ownership when it is still valid.
   Enter the next round with a new session/epoch and neutral input generation.
   Clear the old queue, interpolation history and readiness acknowledgment;
   simulation waits for Player 2's matching new baseline. Already validated art
   can be reused; socket readiness alone cannot acknowledge the new scene.
5. Return to lobby shows both participants and lets the host start the supported
   level again. This lobby does not expose unsupported world-map gameplay or
   permit a third participant, mid-level join, guest level choice or guest saves.
6. Permanent loss continues to require the save-preserving title restart and a
   fresh invitation. Never reuse a retired connection or auto-resume a phone
   after backgrounding. Replay must preserve trusted Start/Resume audio rules.

Acceptance: real supported-level completion and ordinary replay/lobby controls;
multiple rounds; duplicate clicks; stale result/input/view-ready from the previous
round; late artwork completion; guest loss while choosing/loading; host pause
and trusted neutral Resume; failed-save retry; reload of earned host progression.
Keep diagnostic completion/placement fixtures labelled separately from an
unassisted physical-phone completion.

## Second PR: invitation and session deadlines

The current Worker has one `ROOM_MS = 15 minutes`: creation, socket admission,
message processing and the Durable Object alarm all enforce that deadline.
Changing only the visible countdown or only the alarm would leave inconsistent
expiry behavior.

Keep the 15-minute unclaimed invitation window. Start a separate finite session
deadline when both participants are authenticated and ready, and expire abandoned
lobbies/long pauses with a separate idle budget. Measure ordinary level duration
and recovery pauses before selecting final active/idle values; **60 minutes
active and 10 minutes idle are provisional test budgets**, not measured needs or
already implemented limits. Replay cannot reset the absolute session deadline.

- Persist deadlines and state in the Durable Object so hibernation/recreation
  preserves them. Admission, every relevant message and alarms must use the same
  policy. Separate lease activity from the existing 2.5-second heartbeat freeze
  and 15-second bounded socket recovery; keep those safety checks.
- Heartbeats/`seen`, movement packets and repeated acknowledgments cannot extend
  a room forever. Use acknowledged phase changes for active/idle state, a finite
  idle deadline, and an absolute session cap. A disconnected guest cannot reclaim
  live gameplay under the existing title-only ownership rule.
- Send bounded authoritative deadline notices to both clients, including an
  actionable warning before expiry. On expiry release input, pause safely and
  offer Return to title/fresh-room recovery; never discard unsaved host progress.
  Treat client clocks/countdowns as presentation, not expiry authority.
- Preserve exact build identity, origin-bound credentials, two-client limits and
  bounded queues. Version/validate any new messages explicitly, with a defined
  old-room behavior during Worker updates. Keep credentials out of status/logs.
- Update both guest help and the host panel's 15-minute wording together. Keep
  the current wording until the server behavior changes.

Acceptance: fake-clock Worker tests for invitation boundary, active play beyond
the old 15-minute deadline, idle pause/lobby, repeated Replay, heartbeat-only
traffic, hard cap, warning, hibernation, reconnect/admission and old packets after
expiry. Browser tests must exercise the real relay and safe input/save behavior.

## Validation and release gates

Each implementation PR starts from the latest reconciled `mobile-web-audit` on
an isolated branch. Completion/native input changes require Release and Debug
WASM, representative Linux, focused tests and existing Chromium/WebKit shared-view,
lobby, touch, audio, save and cache suites. Pure Worker policy changes receive
focused relay tests and the affected browser suites. Required checks must report;
do not weaken existing assertions or expand the routine full native matrix.

Use the exact successful non-PR Release/Debug source/artifact procedure for
private HTTPS publication in [PRIVATE_COOP_PHONE_ACCEPTANCE.md](PRIVATE_COOP_PHONE_ACCEPTANCE.md).
Verify source, manifest, all startup/deferred/guest payloads and hosted browsers.
Merging into `mobile-web-audit` runs the normal game deployment; it does not
publish the private co-op Worker automatically.

## What follows 8D

**8E — physical phones:** two actual phones, iPhone Safari and Android Chrome,
both host/guest roles, Wi-Fi/cellular, ordinary first-level completion. Include
repeated/held Jump without selection UI, independent finger releases, shared
camera, pickups/contact, checkpoints, Replay/lobby, rotation, lock/app switch,
connection loss, expiry warning and earned host save persistence. Record model,
OS/browser, networks and exact runtime. Present user feedback is useful initial
evidence, not completion of this checklist.

**8F — one additional level:** inventory new objects/scripts/drawing/transitions,
extend verified guest art/loading and the supported-content matrix, then complete
that level on two devices. Keep other worlds available to the host; expose only
verified levels to the shared guest. More levels follow this same bounded cycle.

Public matchmaking, accounts, more players, host migration, guest physics, save
merging and new camera rules remain deferred. Both players continue using the
native shared camera.
