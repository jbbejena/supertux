# Private co-op room lifetime

Implementation: 2026-10-12, on PR #19's branch based on `mobile-web-audit` at
`a1b238334fdfdc8bc2fe8f731d2cf9b327808d1b`. This replaces the old 15-minute limit
for new rooms; existing private staging needs an exact-source tested publication
before it receives this behavior. Replay/Return to lobby remains separate work.

## Player behavior

| State | Limit |
| --- | --- |
| Invitation waiting for the second authenticated player | 15 minutes from creation |
| Both players joined | One hour from the first paired handshake, including pauses |
| Paired but waiting, paused or finished | 10 minutes from entering that inactive state, within the one-hour cap |
| Warning | Within two minutes of the nearest deadline, shown to both players |

Starting/resuming play clears the inactive deadline. It does not restart the
one-hour clock. Repeated neutral generations, acknowledgments, held inputs and
heartbeats cannot reset either deadline. Completing a level enters the same
bounded inactive period; future replay cannot renew the absolute room cap.
These are conservative initial product limits, not a measurement of unassisted
level duration or a guarantee of an uninterrupted one-hour phone session.

The host sees warnings in the play area, including above the Pause/Resume
overlay. The banner cannot intercept touch input. Player 2 sees a separate
warning near the connection status. A resumed session clears a retired idle
warning only if its actual nearest deadline changes.

Expiry closes both sockets, releases controls, pauses the joined host and offers
**Return to title**. That action still waits for a successful save flush. Failed
or unavailable storage keeps the page open with retry; expiry never clears game
saves, settings or asset caches. The guest asks for a fresh invitation. An
unclaimed invitation can expire while the host stays at title; **Host game**
remains available there without reloading.

## Persisted policy and transport

`worker/room-lifetime.js` defines the initial invitation deadline, first paired
start, absolute session deadline, optional inactive deadline and two-minute
warning. `CoopRoom` persists that state and the notice revision in Durable Object
storage. Socket admission, message processing and alarms enforce the same nearest
deadline. An expired room rejects a delayed packet before forwarding input,
even when the scheduled alarm has not run. Missing persisted deadline fields
fail closed. Hibernation does not reset the clocks.

The existing 2.5-second heartbeat freeze and 15-second bounded recovery remain
independent. They can end an interrupted connection well before the room cap.
Inactive lifetime is driven by authenticated host session enable/disable state,
not by `ping`/`seen` traffic or packets from the guest. A change from playing to
inactive starts the idle clock once; repeated disabled reports do not extend it.

Each server-only `lifetime` notice carries a monotonic revision, deadline kind,
remaining milliseconds and warning flag. Notices coalesce in the existing fixed
receive window, survive hibernation in bounded attachments, and remain separate
from gameplay edges. Clients validate notices and ignore retired revisions.
Client clocks/countdowns do not decide expiry. The server closes expired rooms.

Protocol and WebSocket subprotocol are now **3 / `supertux-coop-v3`**, keeping
new clients and the Worker aligned. The static HTTP fallback, readiness probe,
room creation and diagnostic compatibility tests use that same version. Exact
build/manifest matching, origin-bound credentials, the two-client limit and
private R2 delivery remain in place. Pre-update stored rooms retain their
original finite 15-minute deadline; existing sockets do not acquire an extended
lease during a Worker update. Reload and create a fresh invitation for the new
protocol. No credential appears in status text or test reports.

## Validation and publication

Focused fake-clock Worker tests cover unclaimed expiry, active play past the old
cap, inactivity, duplicate disabled reports, pause/resume at the absolute cap,
expiry racing input/admission, warning coalescing, Durable Object reconstruction,
legacy policy, forged notices and malformed persisted deadlines.

Client tests cover malformed/retired warnings, unchanged held input during a
warning, safe host/guest expiry, failed-save retry and unclaimed-title recovery.
The compiled Chromium/WebKit lobby suite checks actual server notices and the
longer active-session deadline. UI warning and server close events are labelled
browser fixtures; they verify touch-target layout, trusted Resume, neutral input
and durable save retry without a one-hour sleep or a public test-only route.
Fake-clock server enforcement and browser fixtures are distinct evidence.

On the baseline plus room-lifetime working tree, all 10 lobby checks pass in
Chromium 151 and Linux WebKit 26.5, with no page/console errors. All 108 JavaScript
and 23 Python focused checks pass. The subsequent
[CI recovery correction](PRIVATE_COOP_CI_RECOVERY.md) retains the full remote-input
coverage and adds a deterministic delayed-generation regression. Final exact-source
Release/Debug results belong to the candidate's Actions runs.

Use the complete pinned Release/Debug artifact and exact successful non-PR
validation procedure in [PRIVATE_COOP_PHONE_ACCEPTANCE.md](PRIVATE_COOP_PHONE_ACCEPTANCE.md).
Both frontend protocol and Worker must publish together. No production deployment
or automatic private publication accompanies this PR. Physical iPhone/Android
warning visibility, OS callout behavior and ordinary long-session play remain
device acceptance checks.
