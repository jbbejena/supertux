# Remote-input CI recovery check

The [PR #19 first validation](https://github.com/jbbejena/supertux/actions/runs/38317882524)
on `fb7df19ab3639171159f38b02bdaa61bdccf69cc` built successfully, then failed in
Chromium's diagnostic remote-input suite at `before-host-pause`. Player 2's
Right control stayed neutral after the fixture deliberately disabled input
refresh and caused the native watchdog to reset. The recorded host was active,
connected and focused, at generation 14 with accepted sequence 71. The failed
run did not record the guest's generation/history, so it cannot prove the exact
packet ordering retrospectively. The original failure remains recorded.

The test waited for the host generation to change but immediately sent another
press without waiting for the guest to consume that reset. A delayed session
notification clears held keys and fingers intentionally; a press belonging to
the retired generation must never be replayed into the new one. Host reset and
guest readiness are separate events.

The correction waits for both sides to report the same enabled generation and
for the native controller to accept a fresh packet. In the timeout scenario it
also requires neutral guest input and a generation different from the retired
one before sending a fresh key edge. It retains the ordinary movement,
pause/resume, disconnect, death/checkpoint, door/sector and save assertions.
No native watchdog, neutral reset or gameplay safety rule is weakened.

A deterministic browser fixture now delays reset notifications after stopping
refresh. It presses Right before delivery, confirms the guest still owns the
old generation and the host remains neutral, then delivers the notification,
waits for a fresh neutral handshake and verifies a new press reaches the native
controller. This reproduces the old test's unsafe ordering without depending on
CI speed or introducing an arbitrary retry. The compiled Chromium check passes
with generation 10 → 11 on the room-lifetime runtime
`87114523ae6f7e86853b950c62fc984bb3f7bbaf` plus the revised test driver.
Final committed-source CI results are recorded in PR #19.

The first local Debug run on `ec9387484b6bc81d1bd6fb75028767f44d73ad53`
passes that reset scenario but fails later when the checkpoint observer's console
fixture command is not submitted. Its original console log is retained. The
fixture previously used 100/150 ms key presses and checked only the last 20 log
lines. It now observes a native input update after each dispatched down/up edge,
waits for menu transitions and the actual echoed command, and waits for a fresh
post-restart remote generation before reinstalling the observer. The ordinary
checkpoint/input assertions remain unchanged; no game input API is bypassed.
The input-frame hook is reinstated after the suite's deliberate title reload,
so the later fresh-room/rejoin scenario observes the new native instance.

Future failures capture both owners, the last 16 session notifications and the
latest native sample before screenshot readback, so an actual recovery defect
can be distinguished from an observation race. Reports contain no room URLs or
credentials. The required validation gate continues to fail when a needed
browser job fails; no check is removed or converted into a warning.

This complements the separately retained WebKit geometry observation correction
and the [room lifetime implementation](PRIVATE_COOP_ROOM_LIFETIME.md). Local
Chromium/Linux WebKit evidence does not establish physical-phone acceptance.


## Initial lobby input after a painted baseline

On the second-level candidate `77ffcad5f09bcd0351ce6f4f2248fcca0c271289`,
[validation 38347771049](https://github.com/jbbejena/supertux/actions/runs/38347771049)
passes Release (both campaign levels in Chromium/WebKit), Linux and lint. Debug
passes its existing local/remote and shared-view suites, then fails the lobby's
first Right movement assertion. The old report records picture readiness and
the active-room notice, but no input-owner state; the exact historical packet
and frame ordering cannot be reconstructed.

A painted native baseline is sent before the host compositor completes that
frame. A startup stall can legitimately retire a press under the existing
750 ms input safety rule. The lobby and second-level drivers now observe the
same displayed/native generation, neutral guest input and two successive native
receipts before their next ordinary key edge. The second receipt observes a
completed host frame. Resets restart this observation with neutral input and
never replay a retired press. No timeout, watchdog or movement assertion is
relaxed.

The lobby adds a controlled 1.1-second host stall after initial readiness. A
console event signals entry before the guest presses Right; it confirms the
fixture is still running, sees the old held press become neutral after a
generation reset, then waits for the fresh handshake and verifies ordinary
movement/Jump. This reproduces the unsafe startup ordering deterministically
without proving the historical runner's exact schedule. All original ten
lobby checks remain, plus this eleventh check. Chromium Debug and Linux WebKit
pass on the compiled `77ffcad5f0` runtime with the revised driver.

Future lobby failures archive both owners, the latest guest baseline and console
output. Required validation correctly fails on the original Debug failure.
Final committed-source CI remains the review gate, recorded in PR #20.


## Action after the console/death fixture

[Validation 38352227280](https://github.com/jbbejena/supertux/actions/runs/38352227280)
on `910103c1a8e4ef04bad0ec8e460f365f2fb81624` passes Debug, including the new
lobby handshake/stall and second-level suites. Release passes its Chromium
suites, then the existing WebKit diagnostic input proof fails at `coop-respawn`.
Its failure records connected, enabled owners at generation 23, accepted
sequence 114 and neutral input on both sides while Player 2 remains down. The
native respawn implementation requires a fresh pressed Action edge, which the
recorded failure never observes.

The console helper observed the native menu closing, but did not wait for the
guest to consume the resumed input generation. Observe fresh matching owners
and successive native receipts after paused console fixtures and immediately
before the respawn Action. Record each key edge's before/after guest state and
native state, and require the current guest to accept the Action bit before
waiting for the original native respawn-position assertion. These observations
do not force respawn, replay retired input or relax the gameplay assertion.
The original failure did not retain edge history, so it cannot establish the
exact scheduling at the lost press.

The compiled `910103c1a8` runtime with this driver passes all 19 Linux WebKit
remote-input checks, including the retained delayed-reset fixture, ordinary
Action respawn, checkpoint, transition, title/rejoin and saves. Final-source CI
results remain recorded in PR #20. The original failed runs are preserved.
