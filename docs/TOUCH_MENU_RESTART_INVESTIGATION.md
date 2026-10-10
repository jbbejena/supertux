# Touch-menu restart timing

The Debug failure in [validation run 38029999586](https://github.com/jbbejena/supertux/actions/runs/38029999586)
occurred in `touch_smoke.py`, before the co-op checks. The screenshot shows
Restart Level selected with Tux still at x=0, rather than the expected spawn x=96.
Release, representative Linux, and lint/focused checks passed that revision;
the aggregate correctly failed because Debug failed. An unchanged local Debug
touch run subsequently passed, so the failure was intermittent.

## Reproduced mechanism

`MenuManager::event()` ignores pointer events while `MenuTransition` is active.
The opening animation takes about 167 ms of native real time. Its active flag
changes during menu drawing, after SDL events have been processed. The test's
`engineStatus` input-frame counter advances before menu processing/drawing;
waiting for that counter does not establish that a newly opened menu accepts
the next pointer press.

A controlled early tap reproduced the screenshot's menu behavior using the
same game code plus isolated, read-only native event logging. It queued a real
SDL pointer press during the opening transition and released it after that
transition finished:

| Native event | Transition active | Menu present | Selected item |
| --- | --- | --- | --- |
| Mouse down at native time 27.149305 s | yes | yes | Continue |
| Next completed transition observation at 27.279003 s | no | yes | Continue |
| Mouse up at 28.119907 s | no | yes | Restart Level |

The press was ignored. The release's synthetic mouse motion selected Restart,
but menu activation happens on **down**, so the level remained paused. The
2-second menu-close assertion failed and the screenshot shows Restart selected.
This establishes the race and reproduces the CI symptom; the failed GitHub job
did not capture a native event trace, so its precise event timings are unknown.
The screenshot alone was not treated as proof of the event order.

The diagnostic used Chromium 151.0.7922.34, Emscripten 6.0.11, Debug/SAFE_HEAP,
the original SwiftShader GPU compositor, an 844×390 touch viewport at DPR 1,
fresh browser storage, and local HTTP. Pointer Events in the early-tap negative
control reach SDL's normal browser handlers; ordinary touch navigation retains
trusted CDP injection. These are cloud desktop tests, not physical-phone results
or a performance comparison. Initial overlapping/incomplete diagnostic runs and
a simplified cycle probe without spawn assertions are excluded from acceptance.

## Correction and regression coverage

`get_browser_menu_state()` is a read-only Emscripten diagnostic exported with
`EMSCRIPTEN_KEEPALIVE`. Its flags describe an existing menu (1), a current
transition (2), and a current/pending dialog (4); it returns zero before the menu
manager exists. It does not skip animations, change selection, inject input,
restart levels, or modify the scheduler. Native-platform behavior is unchanged.

`Fingers.tap()` waits for the native transition to finish before starting and
after releasing a gesture. Restart additionally requires an open, ready menu
without a dialog, then a closed menu and the original real spawn/neutral-input
assertions. Readiness has a 2-second bound. The existing spawn-state deadline,
touch durations, input-frame checks, graphics launch settings, and all prior
touch/audio/viewport/cancellation/storage checks remain.

The compiled-game regression queues a pointer press from the first native frame
whose menu state is 3, before SDL polling. It releases after the state becomes 1
and requires the menu to stay open. A normal ready-menu touch must then close it
and restore the real spawn. The temporary callback is restored in `finally`.
Both Chromium and WebKit run this check as part of their existing touch suite.
No timing increase or automatic repeat tap makes an unsuccessful restart pass.

Local build/browser outcomes and the source-specific CI status are recorded in
[the measurement record](measurements/touch-menu-restart-2026-10-10.json).
The local validation used the working-tree patch based on `0077b1c`; GitHub CI
separately validates the exact committed PR revision.

| Local validation | Result |
| --- | --- |
| Release and Debug WASM builds | pass |
| Chromium Debug touch suite | 11 checks; all four spawn resets; no unexpected errors |
| Chromium Release touch suite | 11 checks; all four spawn resets; no unexpected errors |
| WebKit 26.5 Release touch suite | 11 checks; all four spawn resets; no unexpected errors |
| Representative GCC native Debug build and CTest | pass; 5 unit tests |
| Focused loader/relay/shell, packaging and workflow tests | 86 JavaScript and 22 Python tests pass |
| Full Cppcheck 2.22.0 and workflow actionlint | pass |

PR 17 remains draft. No staging or production publication is part of this fix;
physical iPhone Safari and Android Chrome acceptance remain outstanding.

## Repeat locally

Build Release and Debug with the repository's pinned toolchain, then run:

```sh
python tests/wasm/touch_smoke.py /path/to/Debug/build \
  --record-known-ub --output /tmp/touch-debug
python tests/wasm/touch_smoke.py /path/to/Release/build --output /tmp/touch-release
python tests/wasm/touch_smoke.py /path/to/Release/build \
  --browser webkit --output /tmp/touch-webkit
```

The new test requires a build containing the read-only menu diagnostic; an older
artifact is not a valid test target. Debug retains the existing explicit known
upstream sanitizer annotations. New sanitizer sites and errors still fail.
