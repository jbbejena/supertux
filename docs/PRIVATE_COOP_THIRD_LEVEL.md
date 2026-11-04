# Private co-op: The Somewhat Smaller Bath

Baseline: `mobile-web-audit` at `5551c48a374e30791478100b1e54b9b798c07091`,
including merged Replay/Next PR #22. Branch: `codex/coop-smaller-bath`.
This is the third original Icy Island level, following The Journey Begins in
`data/levels/world1/worldmap.stwm`. Original levels, graphics, music, physics,
native/Android packaging and the remaining worlds are preserved.

## Playing

Choose **The Somewhat Smaller Bath** in the host's ordinary Private co-op
**Level** selector, then Host game, share the invitation and Start together.
Alternatively, complete Welcome to Antarctica and The Journey Begins using
**Next level** in the same room. Journey can still Replay; Bath offers Replay
and the end-of-preview message. There is no fourth guest-supported level or
synchronized world-map navigation.

The host runs both players' physics, water/swimming, fish, path-driven coins,
collapsing ice, pickups, secrets, checkpoint revival, audio and saves. Player 2
renders the authoritative shared scene and supplies ordinary input. Directional
controls swim underwater; holding Jump boosts swimming. Both living players
share the native camera. The guest never runs its own physics or owns saves.

Room lifetime, neutral pause/Resume, disconnect recovery and save retry retain
the behavior in [PRIVATE_COOP_REPLAY.md](PRIVATE_COOP_REPLAY.md) and
[PRIVATE_COOP_ROOM_LIFETIME.md](PRIVATE_COOP_ROOM_LIFETIME.md).
A fresh checkpoint revives fallen teammates; all-player death restarts both at
that checkpoint and requires a fresh scene acknowledgment. Saves retain their
existing schema and transient remote membership is not persisted.

## Content and packaging

| Scene | Native level | Host selection code |
| --- | --- | --- |
| `antarctica-v1` | `levels/world1/welcome_antarctica.stl` | 0 |
| `journey-v1` | `levels/world1/journey_begins.stl` | 3 |
| `bath-v1` | `levels/world1/somewhat_smaller_bath.stl` | 4 |

Bath has one sector, eight tilemaps, four backgrounds, 18 paths, 22 explicit
coins, four Captain Snowballs, five dangerous swimming fish, six harmless fish,
ten unstable ice tiles, four bonus blocks, two secrets, one checkpoint and the
original end-sequence/stoptux triggers. It imports no extra level script and
requires no new sector-transition protocol. Tile-derived objects, particles,
bubbles, swim poses and spawned powerups retain native behavior.

Deterministic `coop-scene.json` schema 2 adds Bath's original level hash,
object/tile inventory and canonical texture mapping. Existing shared textures
are deduplicated by their unchanged PNG hashes. Bath adds the ice-fish and
unstable-tile animation directories; Captain Snowball, swimming Tux, bubbles,
checkpoint, HUD and powerup resources were already inventoried. Original data
is not modified and generated artwork stays outside the source data tree.

| Raw packaged bytes | Two-level baseline | Three-level candidate |
| --- | ---: | ---: |
| Unique guest PNGs | 1,072 | 1,143 |
| Guest PNG bytes | 18,980,679 | 19,845,238 |
| Mandatory host DATA | 176,669,514 | 176,669,514 |
| Deferred host music | 150,011,881 | 150,011,881 |

The extra guest artwork is 864,559 bytes. These are raw file sizes, not measured
HTTP transfer or physical-phone startup times. The host already contains the
full campaign; its startup package does not grow. All three guest levels' art
is prepared with the existing four-download limit and hash/size verification.
No guest WASM, DATA, soundtrack or save database is introduced.

## Scene and transition safety

The existing native presentation captures water alpha, rotated swim quads,
animated tiles, fish, coins and collapsing ice. The additive `bath-v1` allowlist
is matched in native entry/completion, the host selector, guest renderer, relay
world validator and complete-artifact verifier. Source/build identity prevents
old two-level content from pairing with the new runtime. Publish the matching
Worker and frontend together.

Replay accepts the completed native session/epoch; Next permits only successful
Welcome → Journey or Journey → Bath. Guests cannot choose levels. Neither role
may skip a level, navigate backwards through a result, reuse an older completion
or inject an arbitrary runtime path. A new native session, input generation and
complete rendered guest baseline gate physics/input for every Replay/Next;
checkpoint restart requires the new epoch. Relay messages retain the 64 KiB
bound, bounded geometry/entities, two-client limit and hibernation/backpressure
behavior. Protocol remains 3 and no bound or watchdog is relaxed.

## Validation and limitations

Focused tests check the actual source inventory/default sprites, missing or
corrupt payload rejection, normal selector, legal adjacent transitions,
failed-result/skip/backwards/unknown-level rejection and stale-result retirement.
`tests/wasm/coop_bath_smoke.py` runs the compiled host and separate guest through
the real local Worker/Durable Object relay. Its host placement/safety fixtures
are labelled; input, collisions, checkpoint activation, native end sequence and
saving remain real. It exercises swim directions/Jump, rotated swim presentation,
both fish types, moving coin pickup, collapsing ice, secret fade, checkpoint
revival/restart, shared camera, portrait/landscape, neutral Pause/Resume and
progression after a real IndexedDB reload.

`tests/wasm/coop_flow_smoke.py` now covers all three levels and six native sessions
in one room, including Replay of each level, no repeated artwork requests,
late/stale identity rejection, delayed-baseline gates, save retry, the
pause-before-poll race and all three solved flags after reload. Existing
second-level and first-level suites remain available.

Local Release/Debug builds, Chromium/Linux WebKit browser evidence and native
checks are recorded in the PR. Linux WebKit and mobile emulation are not actual
iPhone Safari. Unassisted traversal, physical iPhone/Android gestures, Safari
selection/callouts, silent-switch/audio behavior, cellular performance and both
roles on separate networks remain unverified. Physical-phone acceptance remains outstanding for all three levels.

## Trying and publishing

Follow the pinned build and complete-artifact instructions in
[PRIVATE_COOP_REPLAY.md](PRIVATE_COOP_REPLAY.md). Local room preview needs Miniflare:

```sh
npm ci --prefix tools/web/coop --ignore-scripts
python tests/wasm/coop_bath_smoke.py /path/to/complete/web-release --output evidence/bath-chromium
python tests/wasm/coop_bath_smoke.py /path/to/complete/web-release --browser webkit --output evidence/bath-webkit
python tests/wasm/coop_flow_smoke.py /path/to/complete/web-release --output evidence/three-level-flow
node tools/web/coop/preview.mjs /path/to/complete/web-release 8787
```

Wait for `INPUT_PROOF_READY`, open `http://127.0.0.1:8787/index.html` and use the
ordinary Private co-op panel. A plain HTTP file server cannot provide rooms.
Localhost is local to the development machine; physical phones need reachable
HTTPS staging.

All ten validation workflows stay disabled at the user's request. No CI,
production deployment or private publication is dispatched by this implementation.
After review/merge, manually run **Mobile Web Preview** on `mobile-web-audit`,
using the full integrated source SHA as `ref`, `publish_coop=true` and an empty
`validation_run_id` for a fresh pinned Release build. Existing exact
source/toolchain/manifest/payload and hosted readiness checks remain mandatory.
Ordinary Mobile Web Deploy updates the separate single-player Worker.

After publication, check hosted `BUILD_INFO.json` and test both roles on physical
phones: Journey → Next Bath; swim vertically/diagonally with Jump; encounter
harmless and dangerous fish; ride/collect moving coins; cross collapsing ice;
find the checkpoint, revive a teammate and restart after both die; complete Bath,
Replay without a new invitation, and reopen to verify earned progression.
