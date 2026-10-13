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

Future failures capture both owners, the last 16 session notifications and the
latest native sample before screenshot readback, so an actual recovery defect
can be distinguished from an observation race. Reports contain no room URLs or
credentials. The required validation gate continues to fail when a needed
browser job fails; no check is removed or converted into a warning.

This complements the separately retained WebKit geometry observation correction
and the [room lifetime implementation](PRIVATE_COOP_ROOM_LIFETIME.md). Local
Chromium/Linux WebKit evidence does not establish physical-phone acceptance.
