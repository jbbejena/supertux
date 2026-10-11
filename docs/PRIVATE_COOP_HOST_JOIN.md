# Phase 8C: phone Host/Join

This follows recovery PR #17, merged into `mobile-web-audit` at
`e7fe8aa180e5dcbe900cd14c833464256ba5f323`. Private staging refresh
[38105080282](https://github.com/jbbejena/supertux/actions/runs/38105080282)
reuses that exact successful non-PR Release artifact from
[38089097434](https://github.com/jbbejena/supertux/actions/runs/38089097434).
Delivery readiness and all 24 shared-view checks in each of hosted Chromium and
Linux WebKit pass. These results validate the merged recovery baseline, before
the Host/Join changes described here. Production remains separate.

## Player flow

On a server with private rooms, press **Start**, open **Private co-op**, and
choose **Host game** at the title screen. Use **Share invitation** or
**Copy invitation** to send the Player 2 link privately. Native sharing requires
a supported browser; cancellation leaves the room intact. If clipboard permission
is denied/unavailable, a selected read-only field supports manual copy. Credentials
stay in the URL fragment, outside query strings and normal status text.

Player 2 opens that invitation on another device. The page checks the build and
shows artwork preparation progress. All artwork is size/hash checked and decoded
before the guest connects. A failed preparation cannot mark the guest ready;
**Retry joining** starts a fresh attempt. Updates/expired rooms require a fresh
invitation. The guest downloads artwork only, with no native game, startup DATA,
soundtrack or campaign-save database.

After a shared-view guest joins and the native engine reserves Player 2, the
host sees **Player 2 ready** and **Start together** becomes available. That button
starts the original **Welcome to Antarctica** and collapses the panel. The
existing generation/session/epoch baseline acknowledgment still gates simulation;
connection readiness does not substitute for a valid scene. The host controls
Player 1, menus and saves. The guest controls Player 2. Both use the shared camera.

Alternatively, **Join game** accepts a pasted Player 2 invitation from the same
private co-op site. It rejects foreign origins, credentialed URLs, controller-only
links and malformed fragments. Opening the shared invitation directly avoids
loading the host game on the guest device.

`GET /coop/capabilities.json` discovers room support. Neither `?coop=1` nor a stale
link advertises rooms without the Durable Object binding. Discovery returns no
room state/credentials; room mutations/socket authentication retain Origin checks.
The ordinary production Worker remains single-player unless separately configured.
Complete previews include a hash-verified static `rooms:false` JSON fallback, so
ordinary HTTP servers return a successful discovery response. The private Worker
overrides this one route with live room availability and `no-store`. Hosted
readiness checks its exact bounded JSON/MIME/cache policy separately from static
presentation hashes; all existing build/manifest/payload checks remain intact.
Controller-only invitations and static/forest test buttons require
`?coop_debug=1`. Existing diagnostic suites use that explicit flag; the new lobby
suite uses ordinary `index.html` without developer arguments.

## Lifecycle and loading

Trusted Start/Resume still owns actual host audio activation. Sharing may background
a phone; the existing shell pauses and requires trusted Resume. The co-op panel
stays beneath that overlay and cannot cover Resume/Return to title. Guest controls
remain at least 44 CSS pixels and fit portrait/landscape emulated viewports.

Artwork preparation uses at most four workers. Progress counts verified/decoded
bytes, including HTTP-cache reads; it does not measure network transfer. Failure
aborts siblings and waits for all workers before retry. Scene/images/build publish
together only after success. Backgrounding/changing invitations aborts preparation,
clears input and prevents late completion opening a socket. Same-page, same-build
retries reuse a fully prepared scene. Immutable artwork HTTP caching and host
startup/music caching remain unchanged.

Safe interruption, neutral generations and save-flush-before-title restart remain
as described in [PRIVATE_COOP_RECOVERY.md](PRIVATE_COOP_RECOVERY.md). Phase 8D
completion/lobby polish and invitation versus active-session expiry remain follow-up
work. The entire current room, including play, still expires after 15 minutes.
Seamless in-level reconnect is not supported.

## Build, preview and validation

Use pinned Emscripten 6.0.11/vcpkg and a complete Release/Debug artifact assembled
with `tools/web/package_assets.py assemble`. For local checks:

```sh
npm ci --prefix tools/web/coop --ignore-scripts
python tests/wasm/coop_lobby_smoke.py /path/to/complete/preview --output evidence/lobby-chromium
python tests/wasm/coop_lobby_smoke.py /path/to/complete/preview --browser webkit --output evidence/lobby-webkit
```

The runner starts the actual local Worker/Durable Object. It exercises normal
Start/Host, labelled Share-cancellation/clipboard-denial fixtures, partial artwork
failure/retry, readiness, real level start, Player 2 input, portrait/landscape,
trusted neutral Resume and guest backgrounding. Evidence captures no invitation
credentials. Headless Chromium uses software page compositing while retaining
SDL/WebGL; Linux WebKit is not physical Safari. Existing full shared-view,
remote-input, touch, audio, save and cache checks remain in CI.
The local-gamepad suite uses ordinary HTTP and asserts that rooms stay hidden.
Its Forest entry uses the existing native command API as a labelled diagnostic
fixture; the real room-server suite retains the Forest button interaction.

The existing WASM job runs the lobby suite in Chromium for both configurations
and in WebKit for Release, retaining evidence. No jobs/workflow-level filters are
added. Required validation still fails on needed-job failure. The shared action
change receives Release/Debug WASM, lint/focused tests and representative Linux; manually
run `WebAssembly` for exact non-PR Release/Debug acceptance before private
publication. Full-platform manual/weekly/tag access is retained.

Private publication uses **Mobile Web Preview**, the complete candidate SHA as
`ref`, its exact successful non-PR `validation_run_id`, and `publish_coop=true`.
Source/toolchain/configuration/manifest and every payload are verified before
artifact reuse. PR artifacts, missing artifacts and mismatched runs are rejected.
Production's workflow/serialization are unchanged.

Local development validation on the merged baseline plus this working-tree change:

| Check | Result |
| --- | --- |
| Release WASM build | Pass; complete artifact verified by the local Worker preview |
| Normal-entry lobby, Chromium 151 | All six checks pass; no script errors |
| Normal-entry lobby, Linux WebKit 26.5 | All six checks pass; no script errors |
| Focused JavaScript / Python | 95 / 23 pass |
| Workflow syntax and diff whitespace | Pass |

These local build identities refer to the baseline plus working-tree edits; final
committed-source Release/Debug and hosted acceptance are recorded separately in
the candidate's Actions runs. The first Chromium run preceded small presentation
and DOM-update improvements; final-source CI must cover those changes.
No physical-device result is inferred from these local results.

Physical iPhone Safari, Android Chrome, OS share sheets and separate networks
remain unverified. Follow [PRIVATE_COOP_PHONE_ACCEPTANCE.md](PRIVATE_COOP_PHONE_ACCEPTANCE.md),
swap roles and complete the real level before advertising phone co-op support
or adding another level.
