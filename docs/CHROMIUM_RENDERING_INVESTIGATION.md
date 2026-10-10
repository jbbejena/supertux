# Chromium stalls in private co-op validation

The reproduced stalls occur when headless Chromium's software graphics pipeline
blocks the authoritative host's WebGL calls. Two independent SwiftShader browsers
share the cloud environment's four-core CPU quota. GPU page compositing introduces
context-switch waits that back up the host graphics command buffer. This is a
headless validation finding; physical Android Chrome and iPhone Safari remain
unverified.

## Evidence

The measured Release runtime is
`52d8bf370bee4b97b1a943beec695274fb13b518`, built with Emscripten 6.0.11 and pinned
vcpkg `c748cb44f2a435fcf015c35225c9d5545fe0021c`. Chromium is 151.0.7922.34.
The game uses SDL3's GLES2 renderer. Its custom OpenGL vertex-array implementation
is not active in this build.

A captured 2,940.4 ms frame gap contained a 2,635.4 ms `vertexAttribPointer` call
and a 283.9 ms `drawArrays` call. Chromium's renderer spent 2,635.32 ms in
`CommandBufferHelper::WaitForAvailableEntries1`, including 2,635.22 ms in
`CommandBufferProxyImpl::WaitForGetOffset`. At the same time its GPU process spent
2,633.93 ms in `GLContextEGL::MakeCurrent`, using only 0.161 ms of CPU time on that
main thread. The graphics process's other threads continued consuming CPU.
The vertex call was waiting for queued graphics work to drain.

The affected frame issued 127 draw calls and 374 vertex attribute calls, with no
texture uploads. An independently sampled CPU profile agrees with direct timing:
2,633.215 ms in `vertexAttribPointer` and 284.023 ms in `drawArrays`. First-use
texture upload or game asset decoding does not explain this captured frame.
The trace does not identify the native wait primitive inside EGL or establish
that every historical stall has the same cause.

Because profiling adds overhead, a second probe used direct WebGL timing and
one-second CPU sampling, without CPU profiling, browser tracing, screenshots or
the deliberate 3.2-second recovery fixture. It reproduced a 3,897.5 ms campaign
frame gap containing a 3,827.5 ms vertex attribute call and no texture uploads,
while typing a paused host position fixture before the growup-block test.
The environment averaged 3.967 CPU cores and was throttled during 97.24% of
scheduling periods. A third ordinary trial reported a 4,653.2 ms gap and a
4,169.3 ms `bufferSubData` call; multiple graphics APIs can encounter backpressure.

## Controlled comparisons

All trials ran sequentially with fresh browser contexts, independent host and
guest browsers, an 844×390 viewport, DPR 1, touch available, desktop browser
identity and unthrottled local HTTP/WebSocket delivery through an actual local
workerd/Durable Object relay. The same compiled game and untouched campaign
assets were used. No automatic Resume or longer recovery deadline was added.

| Chromium test configuration | Growth probes passing | Largest observed campaign/native gap | Longest tracked WebGL call |
| --- | ---: | ---: | ---: |
| Original GPU page compositor | 1/3 | 4,653.2 ms | 4,169.3 ms |
| Software page compositor; SDL/WebGL drawing preserved | 3/3 | 480.6 ms | 41.6 ms |
| Host GPU draw calls suppressed, diagnostic only | 1/1 | 45.1 ms | 23.2 ms |

These are small samples of a specific fixture, with different completion times,
not a phone frame-rate guarantee or equivalent-duration performance benchmark.
The no-draw control is not a rendering acceptance pass. One failed ordinary
trial's 3,000-frame ring was overwritten while the fixture waited on its paused
host; its gap is preserved in the existing native lifecycle/failure report.

The complete original Release shared-view suite additionally passed all 24 checks
with software compositing, including real host/guest rendering, title-to-campaign,
growth, information panels, checkpoints, deliberate interruption recovery and
save failure/retry/reload. The full-suite run did not inject timing wrappers or
disable draw calls. Debug and remote-input validation are recorded with their
final outcomes in the [measurement record](measurements/private-coop-chromium-2026-10-10.json).

## Test-launch change and retained coverage

`coop_smoke.py` and `coop_view_smoke.py` now add
`--disable-gpu-compositing` for Chromium. This moves page compositing off the
software GPU while retaining actual SDL/WebGL rendering and guest Canvas2D
drawing. Chromium reports the same ANGLE/Vulkan SwiftShader renderer, WebGL
`enabled_readback`, GPU compositing `disabled_software`, and Canvas2D enabled.

All original assertions, screenshots, trusted audio/input activation, stale-input
retirement, explicit Resume, bounded relay recovery and save hydration checks
remain. WebKit launch settings are unchanged. Native/game renderer code, frame
pacing, production assets, Worker routing and deployed links are unchanged by
this test adjustment. Existing benchmark launch conditions are unchanged so
historical measurements keep their original meaning.

CI and hosted validation already call these two test launchers, so they inherit
the setting without changing workflow triggers, required check names, concurrency,
permissions or artifact verification. See [PR 17 checks](https://github.com/jbbejena/supertux/pull/17/checks)
for final-revision CI; local results do not imply a successful hosted run.

The completed run on `0077b1c` passed Release, Linux and lint/focused checks, but
Debug failed touch-only Restart before reaching co-op. The separate
[touch-menu investigation](TOUCH_MENU_RESTART_INVESTIGATION.md) reproduces the
ignored-press/late-release sequence and replaces input-frame assumptions with
bounded native menu readiness. It preserves the compositor settings and all
existing restart and gameplay assertions.

Both launchers retain the original GPU compositor mode explicitly:

```bash
python tests/wasm/coop_view_smoke.py /path/to/complete-preview \
  --output /tmp/coop-standard

python tests/wasm/coop_view_smoke.py /path/to/complete-preview \
  --gpu-compositing --output /tmp/coop-original-gpu-compositor

python tests/wasm/coop_smoke.py /path/to/complete-preview \
  --gpu-compositing --output /tmp/coop-original-input-compositor
```

The original mode needs sufficient software-renderer CPU headroom for meaningful
playability validation. This adjustment does not fix or measure hardware-phone
graphics performance. Test the private staging invitation on real Android Chrome
and iPhone Safari, including sustained gameplay and background/Resume behavior,
before treating phone performance as accepted. A native graphics-driver profile
would be needed to identify the exact wait beneath the observed EGL context switch.
