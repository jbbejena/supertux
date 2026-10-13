# Phase 8F: The Journey Begins

Baseline: `mobile-web-audit` at `7d9ec4388cf67c3d2121f18e7544a4c4c184eaf3`,
including merged room-lifetime PR #19. Branch: `codex/coop-next-level`.
The user requested this bounded content expansion before remaining Phase 8D
Replay/lobby work and physical-device acceptance.

## Playing

On a complete private co-op preview, press **Start**, expand **Private co-op**
at the title screen and choose **The Journey Begins** in **Level**. Choose
**Host game**, share the Player 2 invitation, wait for **Player 2 ready**, then
press **Start together**. **Welcome to Antarctica** remains the default.

The host runs both players' original physics, enemies, scripts, audio and shared
camera. The guest presents the native scene and controls Player 2, without
running collisions or writing progression. The native shared camera follows
both living players, including zoom when they separate.

Select before starting. Replay and automatic first-to-second-level handoff in
the same room remain a separate Phase 8D task. To change levels, expand the host
panel, choose **Close room**, then **Return to title**. The host flushes saves
before reloading; failed saving keeps the page open for retry. Select the next
level and share a fresh invitation. Finite room limits and neutral-input,
trusted-Resume recovery continue to apply.
The selector uses the existing native levelset completion records; synchronized
world-map navigation and automatic campaign advancement remain out of scope.

## Supported content

| Scene | Original path | Scope |
| --- | --- | --- |
| `antarctica-v1` | `levels/world1/welcome_antarctica.stl` | Existing first-level regression suite |
| `journey-v1` | `levels/world1/journey_begins.stl` | Second level and new interaction suite |
| `coop-view-v1` | `levels/web/coop-view.stl` | Static diagnostic arena |

The Journey Begins has one sector, six tilemaps, four parallax backgrounds,
three explicit bonus blocks, four explicit coins, three decals, one checkpoint,
one fading secret area, two end-sequence triggers and two spawnpoints. Its
enemies are six snowballs, five smartballs, two bombs, two stalactites, one jumpy,
one ice block, one smart ice block, one spiky and one sleeping spiky. Tile-derived
objects and spawned powerups/debris use the same native complete draw baselines.
There are no extra imported scripts or sector-transition commands in this level.

Other levels and all worlds remain available to the host, outside this guest
allowlist. Original source levels/assets and native/Android packaging are
preserved; physics, visual quality and camera rules are unchanged.

## Packaging and readiness

`coop-scene.json` schema 2 contains `campaigns`, keyed by scene ID. Each entry
records canonical level path, original content hash, display name, object/tile
inventory and canonical texture-to-content-addressed PNG mapping. Each level
is inventoried independently across all sectors. Shared PNG bytes deduplicate
across levels. The new level adds spiky animations and its referenced decals
and tiles. Smart-block frames and indirect splash/melt resources are included
in the audited defaults.

Both levels' artwork is size/hash verified and decoded with at most four
downloads before the guest connects. The guest must paint and acknowledge a
complete baseline for the current native session, epoch and input generation
before physics/input advances. Checkpoint restart requires a fresh epoch.
Old-session frames, results and readiness cannot replace the new level.

The Worker accepts `journey-v1` through the existing bounded world validator;
64 KiB message, geometry/entity, origin, build and two-client limits remain.
Protocol stays 3: this additive scene uses the same envelope, and build identity
prevents old guest artwork pairing with new host code. Publish the exact matching
frontend and Worker together. Artifact verification checks both level hashes
against packaged native assets and every guest payload.

The previous single-level guest art had 1,049 unique PNGs / 18,637,169 raw bytes.
The two-level inventory has 1,072 / 18,980,679: 343,510 extra bytes. These are
file sizes, not measured HTTP transfer or phone startup times. The guest still
fetches no WASM, startup DATA, soundtrack or save database.

## Validation and limitations

Focused packaging, selector, renderer/session ordering and relay checks cover
both scenes. `tests/wasm/coop_level_smoke.py` uses the compiled host, separate
guest and actual Durable Object relay through the ordinary selector. It checks
delayed-baseline gating, remote movement/touch Jump, shared camera, level artwork
survey, sleeping-spiky wake and smart-block stomp, coin removal, secret fade,
checkpoint/death restart, pause/neutral
Resume, viewport changes, original native completion and hydrated host saves.
The save check waits for this level's actual `solved` flag before comparing the
file after a real reload; an initial unsolved file is not completion evidence.
Host-only placement/ghost fixtures are labelled; they do not establish
unassisted completion on a phone. Global sprite artwork animation may continue
while the loading gate holds physics; positions/input must remain frozen.
Before the first fixture key edge, a displayed baseline also needs the current
neutral native input handshake. The eleven-check lobby suite covers a controlled
startup stall; see [PRIVATE_COOP_CI_RECOVERY.md](PRIVATE_COOP_CI_RECOVERY.md).

Existing first-level, boot/audio/cache, touch, local/remote input and lobby,
lifetime/save suites remain. CI adds the second-level suite to Release Chromium
and Linux WebKit, plus Debug Chromium, and archives reports. Shared C++ changes
select representative Linux, lint, Release/Debug WASM, focused tests and Required
validation. Exact source identities and completed results are recorded in the PR.

Physical iPhone Safari and Android Chrome remain unverified. Two-phone acceptance
must include both roles, separate networks, ordinary traversal/completion,
smart-block/spiky contact, checkpoint, secret fade, rotation, background/Resume,
callout suppression and earned-save reload. Follow the
[phone checklist](PRIVATE_COOP_PHONE_ACCEPTANCE.md).

## Build and preview

Use pinned Emscripten 6.0.11 and the existing web build action. Ordinary builds
generate startup, deferred music, manifest and both guest-art inventories.

```sh
python3 tools/web/package_assets.py assemble --build build --output build/upload
python3 tools/web/verify_artifact.py build/upload --source-commit "$(git rev-parse HEAD)" --configuration Release
npm ci --prefix tools/web/coop --ignore-scripts
node tools/web/coop/preview.mjs build/upload 8787
```

For private HTTPS publication, follow the exact successful non-PR artifact
procedure in the phone handoff. Merging runs ordinary mobile deployment; private
co-op publication is separate. No production deployment is part of this task.
