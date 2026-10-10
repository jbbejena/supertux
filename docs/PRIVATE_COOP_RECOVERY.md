# Private co-op interruption recovery

This work follows merged Phase 8B (PR #16) on `mobile-web-audit` at
`0a240fc3445efd08610b9d66bf6b647a512fbfca`. It addresses the interruption
failures measured in [PRIVATE_COOP_SMOOTHING.md](PRIVATE_COOP_SMOOTHING.md).
It does not claim to finish the phone Host/Join flow or physical-device acceptance.

The implementation is under review in [PR #17](https://github.com/jbbejena/supertux/pull/17).
Final runtime `0cfbc3038b80ab3d57dd0918bd987dce30b60f51` is validating in
[focused PR checks](https://github.com/jbbejena/supertux/actions/runs/38015352041)
and [exact-source non-PR WebAssembly checks](https://github.com/jbbejena/supertux/actions/runs/38015347968).
Earlier failed runs are retained below. They are not passing recovery tests.
The private HTTPS Worker has not been updated with this runtime.

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
gate's loading timeout. If loading exceeds its active 15-second deadline,
the closing callback returns false and permanent loss keeps every later loading
query blocked until Return to title. The former timeout return could release
physics in the same update that closed and paused the room.

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
Long invitations remain scrollable inside short phone viewports.

## Script-scheduler correction

An exact-source Release run failed normal touch entry with a Squirrel error in
`intro.nut`'s `shake_bush()` while skipping the story. Review found that the
scheduler removed its heap entry **after** waking the script. That callback can
schedule additional threads and reorder the heap, causing the newly scheduled
entry to be removed and the old one to run again. This ordering bug is independent
of the co-op transport.

The entry now retires before waking the script, with its reference held through
the callback. A regression using the actual Squirrel VM schedules a second,
earlier-wake thread from inside the first callback. It fails before the fix and
passes after it, asserting that the second thread runs and the first waits until
its requested later deadline. The native representative suite and both WASM
configurations run this regression. The final normal-entry browser checks still
reject script errors; no console error is ignored to pass CI.

## Frame-pacing experiment and diagnosis

The final implementation retains the existing frame pacing. The web main loop
uses `requestAnimationFrame` and its early-frame branch calls `SDL_Delay`.
Emscripten 6.0.11 implements that sleep as clock polling in this build without
pthreads/Asyncify. An experiment omitted that call while retaining the physics
accumulator. It reduced sampled clock work, but did not pass Release acceptance
and completed fewer repeated trials. It was rolled back before final publication.
A future pacing change needs its own measured validation; no threading, Asyncify
or physics-rate change is introduced here.

A diagnostic Chromium constrained-profile trial reproduced a 2,478 ms host
long task and a 4,754 ms animation-callback gap. Both peers remained authenticated
with neutral controls and the host stayed paused after recovery. The trial failed
at sample 5 settling; its four partial response samples are not counted as a
completed result. The 28.77-second CPU profile included 2.72 seconds sampled in
clock functions and 2.93 seconds in `vertexAttribPointer`.

The 4-CPU cloud quota was throttled in 787 of 1,048 periods during the wider
106.9-second diagnostic window, using an average 3.34 CPU cores. Process command
roles were not observable, so the process sample does not identify GPU versus
renderer activity. Clock polling is an avoidable cost; this evidence does not
isolate every driver/scheduling stall or establish physical-phone performance.

An equivalent after-change diagnostic profile lasted 27.97 seconds and failed
at sample 5 first draw. Clock functions accounted for 34.8 ms of sampled self
time, compared with 2,719.9 ms in the 28.77-second before profile. This confirms the experiment reduced that sampled cost, but does not justify
shipping it without reliable browser acceptance. Graphics calls remained prominent; it does not establish
that the remaining graphics stalls are fixed. The after diagnostic's wider
115.4-second window averaged 3.37 CPU cores and throttled in 816 of 1,143 periods.
These CPU-quota windows include setup and are longer than the sampling profiles.

Requests to limit SwiftShader through `SwiftShader.ini`, including a GPU
launcher with an explicit working directory, still produced five worker
threads. Those probes do not establish an effective driver configuration.

## Repeated measurements of the rejected experiment

The “before” column below is the recovery runtime `9ebad10f`, not the merged
Phase 8B baseline. The experiment is `df1fb8f` and was **rolled back**. These
numbers do not describe a final-runtime speed improvement. Complete machine-readable
conditions, trial counts, timings, network counters and failures are in
[the measurement record](measurements/private-coop-recovery-2026-10-10.json).

| Linux browser / transport | Before: complete / requested | Before input-to-draw median / p95 / max, ms | Experiment: complete / requested | Experiment median / p95 / max, ms |
| --- | --- | --- | --- | --- |
| Chromium loopback | 2 / 3 | 173.7 / 245.5 / 531.2 | 1 / 3 | 169.4 / 767.5 / 767.5 |
| Chromium constrained | 0 / 3 | No completed result | 0 / 3 | No completed result |
| WebKit loopback | 3 / 3 | 143 / 235 / 302 | 1 / 3 | 141.5 / 170 / 170 |
| WebKit constrained | 3 / 3 | 420 / 496 / 499 | 3 / 3 | 431 / 504 / 508 |

Each independent trial requested ten response samples. Aggregates contain only
complete trials; failures and partial samples remain recorded, with no automatic
Resume. Chromium 151.0.7922.34 uses SwiftShader, Linux WebKit is 26.5,
Playwright is 1.62.0, and the viewport is 844 × 390 at DPR 1 with touch enabled.
Two independent browser processes share a four-CPU quota. The constrained profile
shapes only the ordered local WebSocket stream: nominal 150 ms RTT, 30 ms jitter
and 5 Mb/s per direction. HTTP assets remain unshaped. This is not cellular,
separate-network or physical-device testing. The endpoint is the authoritative
state drawn by Canvas2D, not photon timing.

| Completed-trial startup medians, seconds | Before host cold / warm | Experiment host cold / warm | Before guest cold / warm | Experiment guest cold / warm |
| --- | --- | --- | --- | --- |
| Chromium loopback | 4.917 / 11.137 | 4.252 / 12.301 | 10.674 / 6.970 | 9.397 / 9.008 |
| WebKit loopback | 9.015 / 3.339 | 54.301 / 3.788 | 16.826 / 13.745 | 43.004 / 15.071 |
| WebKit constrained | 7.517 / 3.595 | 8.035 / 3.709 | 17.822 / 12.951 | 17.976 / 15.584 |

The large WebKit cold outliers are retained. Different completion counts and
these outliers prevent a balanced, statistically reliable speed comparison.
Each trial starts with a fresh persistent browser profile; warm uses a new page
in that same profile. Host HTTP caching is disabled by its diagnostic HTML route,
while its persistent asset store remains. Guest HTTP caching remains enabled.
This tests same-profile reuse, not reopening a fully restarted browser.

All eight completed before trials and five completed experimental trials show
backend startup transfers of two requests / **137,499,041 response-body bytes**
on the cold host and **zero** startup-package requests/bytes on the warm host.
The cold guest fetches 1,049 artwork objects / **18,637,169 body bytes**; the warm
guest fetches no artwork bodies from the backend. WebKit's browser counters still
show header/revalidation traffic, so this is not zero total HTTP traffic.
The unchanged raw startup DATA is **176,669,514 bytes**, with **150,011,881 bytes**
of deferred music. This recovery PR changes neither packaging nor soundtrack
membership; it makes no new startup-byte reduction claim.

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

Browser correctness uses all existing interaction assertions and timeout limits.
An optional bounded lifecycle trace records relay notifications, native gaps and
long tasks. Failed console fixtures preserve the trace and current shell/input
states, including failures before the command executes. No unexpected pause is
automatically resumed to make a test pass.

The rejected scheduling experiment used
`df1fb8f121f1823abd4368bfd12638941f3dfb3a`, Release and Debug,
Emscripten 6.0.11 with pinned vcpkg
`c748cb44f2a435fcf015c35225c9d5545fe0021c`. Both complete local artifacts verify
their source, configuration and full manifest. Release WebKit and Debug Chromium
pass all 23 compiled shared-view checks. Release and Debug Chromium each pass
12 single-player/browser checks and 10 touch checks. Local GCC 14 Debug passes
four native tests; the representative GitHub Linux Release build passes.
Five pre-existing Debug sanitizer sites remain explicitly annotated; new sites
fail. Loader/relay/shell tests pass 84 checks and Python packaging/workflow tests
pass 22 checks.

The preceding recovery runtime at `9ebad10f32c039281b8b1db8779a5411673ee35a`
passed all 23 shared-view checks in Release Chromium, Release WebKit and Debug
Chromium. The experiment's Release Chromium attempts and exact-source GitHub Release
checks failed; earlier passing results were not substituted for them. The
restored-pacing runtime is `87d24f9f5b32b702d8108770a0e907cafa78e904`.
Its product source matches the earlier recovery runtime. Local Release Chromium
and Debug Chromium passed all 23 checks at this source; Release WebKit failed
its observed same-snapshot intermediate-geometry assertion. The exact-source
manual run failed Release's touch entry (the intro script error above) and Debug's
remote jump assertion. The later `0cfbc3038b80ab3d57dd0918bd987dce30b60f51`
adds the loading-timeout fence and script-scheduler fix. WASM unit programs use
a scoped Node linker configuration, separate from the game HTML loader; both
Release and Debug pass the scheduler regression locally. Its complete artifacts
and browser validation are tracked separately.

Both complete local Release/Debug previews verify source
`0cfbc3038b80ab3d57dd0918bd987dce30b60f51`, configuration and complete payloads.
All five C++ unit programs pass through Node in each WASM configuration; the
native GCC 14 Debug suite also passes all five, including the scheduler regression.
The compiled browser suite is still running; use the linked exact-source CI
results for final acceptance. Staging publication remains gated on both successful
non-PR configurations and hosted readiness/browser validation.

One diagnostic overlapped a lifecycle test during queue rearrangement. That pair
and a loopback trial started during its cleanup remain in `invalid-overlap-*`
evidence directories and are excluded from passing counts and comparisons.
The resulting measurements use one sequential runner. Builds, correctness
tests, diagnostic profiling and repeated benchmark profiles run separately.

CI keeps six needed jobs for this significant runtime change: selection, lint
and focused tests, Release WASM, Debug WASM, representative Linux, and the
required aggregate gate. Unaffected platform jobs intentionally skip. The gate
fails when needed validation fails; it has not been weakened. Full platform
manual/weekly/tag access, validation cancellation and separate uncancelled
deployment serialization remain unchanged. Live rulesets were empty and the
integration branch reported `protected: false`; classic branch-protection
inspection returned HTTP 403. Repository rules/settings were not changed.

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
