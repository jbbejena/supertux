# Private co-op interruption recovery

This work follows merged Phase 8B (PR #16) on `mobile-web-audit` at
`0a240fc3445efd08610b9d66bf6b647a512fbfca`. It addresses the interruption
failures measured in [PRIVATE_COOP_SMOOTHING.md](PRIVATE_COOP_SMOOTHING.md).
It does not claim to finish the phone Host/Join flow or physical-device acceptance.

## Failure and resulting behavior

Previously an active host missing its 2.5-second heartbeat permanently destroyed
the room. A guest disconnect neutralized Player 2 but left the host simulation
running. The native input watchdog measured arrival time *after* delayed browser
callbacks, so buffered input could appear fresh after a blocked main thread.

The native frame boundary now checks elapsed time before consuming input or
advancing physics. A gap of 750 ms retires held controls and queued edges through
the existing reset API. A gap of 2.5 seconds pauses the browser shell. Receiving
an input before that native boundary applies the same checks. The guest must
release and press its controls again after the generation changes.

The relay freezes input on a missed active heartbeat, keeps the authenticated
sockets for a bounded recovery window, and notifies both browsers. Returning
messages also check heartbeat age; an alarm arriving late cannot forward stale
input. Recovery requires both peers to be recently responsive and a new neutral
native input generation. A changed generation with input still enabled is
insufficient. Connection notifications occupy one coalesced latest-state slot,
so backpressure cannot replay an older recovered status after a new interruption.
The existing 32-message window, input queue, payload limits and role validation
remain in force.

The game stays paused after the connection recovers. The host presses the existing
trusted **Resume** button, preserving browser audio activation. Welcome to
Antarctica obtains a fresh complete baseline acknowledgment for the current input
generation before simulation resumes. An acknowledgment for an older generation,
including one arriving between native reset and its next status callback, does
not release the loading gate. Deliberate shell pauses do not consume that
gate's loading timeout.

A permanently disconnected guest or host socket pauses the host and blocks
Resume. **Return to title** flushes the existing save/settings store and reloads
the host. Create a new room, share its new guest invitation and restart the level.
Mid-level reconnection and host migration remain unsupported. Guest backgrounding
still ends its socket rather than silently accepting input from a hidden page.
Opening a new invitation in the same guest tab clears controls, closes the old
room and reloads the new credentials. Fragment-only navigation previously kept
the old client's room identity and could prevent joining after a title restart.
The co-op panel shares the game overlay's stacking context, so an expanded panel
cannot cover Resume or Return to title while paused. The restart button uses the
same minimum 44-pixel target as the other activation controls.

## Bounds and scope

| Boundary | Limit / behavior |
| --- | --- |
| Native held-input age / main-thread hitch | 750 ms; retire controls and generation |
| Active heartbeat gap | 2.5 seconds; input barrier and shared interruption |
| Host without an active input session | Up to 15 seconds of startup/loading grace |
| Recovery / unresponsive authenticated socket | 15 seconds; permanent disconnect |
| Unauthenticated socket | 5 seconds |
| Entire private room | Existing 15-minute hard expiry; never extended by heartbeats |

Invitation and active-session expiry UX, expiry warnings, seamless reconnection,
additional supported campaign levels and Phase 8C Host/Join polish are separate
work. The shared camera remains the native local co-op camera. The guest displays
both players and the authoritative camera; this change introduces no camera rule.

## Validation and diagnostics

The focused tests cover returning-message/alarm races, stale generations, required
neutral recovery, bounded hard expiry, coalesced notification ordering, held-key
release and blocked trusted Resume. Compiled browser coverage deliberately blocks
the host for 3.2 seconds while the guest holds movement, then verifies that both
sockets survive, simulation is paused, held controls are gone, and trusted Resume
receives a new baseline. Disconnect coverage verifies the pause and save-preserving
title restart instead of expecting the game to continue without Player 2.

`coop_benchmark.py --profile-host` records a Chromium sampling profile and a
compact self-time summary. This is an optional diagnostic mode, not comparable
to an unprofiled run. Bounded host long-task observations accompany normal
benchmarks where the browser supports them. Failed trials remain failed and retain
their partial measurements. A safe pause is not counted as uninterrupted play.

Physical iPhone Safari, Android phones and separate-network acceptance remain
unverified. Follow [PRIVATE_COOP_PHONE_ACCEPTANCE.md](PRIVATE_COOP_PHONE_ACCEPTANCE.md),
swap host/guest roles, and include interruption during held touch input and music,
explicit Resume, permanent guest loss and saved-game preservation.

## Try the complete local preview

Build with the pinned Emscripten 6.0.11/vcpkg toolchain and assemble the complete
artifact with `tools/web/package_assets.py assemble`. Then run:

```sh
npm ci --prefix tools/web/coop --ignore-scripts
node tools/web/coop/preview.mjs /path/to/complete/preview 0
```

Open the printed host URL, tap Start, expand Private co-op and create a room.
Open its Guest shared view invitation in another browser, wait for Player 2 to
join, then select Play Welcome to Antarctica. The loopback server is a local
preview; phones need the separately verified private HTTPS staging Worker.

Private staging publication must reuse an explicit successful non-PR Release
validation artifact for the exact source SHA. Use `Mobile Web Preview` from the
web integration workflow, with that full SHA as `ref`, its `validation_run_id`
and `publish_coop=true`. A build-only preview or the normal mobile deployment
does not enable private rooms. Do not substitute an unverified latest artifact.
