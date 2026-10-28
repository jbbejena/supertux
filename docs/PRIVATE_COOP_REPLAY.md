# Private co-op: same-room Replay and Next level

Implementation baseline: `mobile-web-audit` at
`34d8d40e423129396641ad183fad66c8fe7d0db6` (merged checkpoint-revival PR #21).
Working branch: `codex/coop-replay-next-level`. Publication is separate from
merging; this document does not claim the hosted private link has been updated.

## Player flow

Start a private game through the ordinary **Start → Private co-op → Host game**
flow. Choose Welcome to Antarctica or The Journey Begins, share the invitation,
wait for Player 2, and press **Start together**.

When a level ends, both screens show its result. The host can **Replay** that
level or, after completing Welcome to Antarctica, choose **Next level** to play
The Journey Begins. Player 2 waits for the host's choice. The room, invitation,
WebSocket pair and prepared guest artwork are reused; neither player reloads.
After The Journey Begins, the panel explains that this is the end of the current
two-level preview. Replay and Close room remain available. There is no third
level, synchronized world map or general lobby/level selector in this change.
The shared camera and checkpoint teammate revival remain in effect.

The host's native completion record is written before choices become available.
The browser then flushes saves to persistent storage. On failure it offers
**Retry saving** or **Continue this visit**. Continuing explicitly acknowledges
that progress may not survive closing the tab; it keeps the current in-memory
progress and does not delete existing saves. Close room retains the existing
save-preserving Return to title flow. All player-facing choices respect Pause,
backgrounding, trusted Resume, lost connections and finite room lifetime.

## State and authority

* `GameSession::finish` keeps native win bookkeeping. Only connected shared-view
  co-op holds the original `LevelsetScreen` after completion. Ordinary single
  player, native builds and controller-only diagnostics keep their existing exit.
* The held screen retains the GameManager-owned Savegame, saves the solved flag,
  and acknowledges the exact result session/epoch. It has no underlying title
  menu that a keyboard, touch or gamepad can navigate while the dialog is open.
* Host command 6 accepts only that held session/epoch and an allowlisted Replay
  or successful first-to-second-level transition. It constructs a fresh native
  GameSession using the same Savegame and resets checkpoint/remote input state.
  Guest input masks cannot invoke it. Repeated actions are ignored while starting.
* The relay accepts a bounded host-only `transition` after the matching result.
  It permits the same scene or successful `antarctica-v1` → `journey-v1`, uses
  the current input generation, and retires results on a newer session or epoch.
  Coalesced results/transitions survive Durable Object hibernation and arrive
  ahead of the next complete view baseline. Protocol remains 3; exact content
  build identity prevents old/new frontends pairing.
* Player 2 freezes the completed scene, clears held input and shows a waiting or
  loading panel. Old-session frames/results cannot reopen it or enable controls.
  Replay/Next requires a newer native session, the requested scene and a complete
  rendered baseline acknowledgment for the current generation before simulation
  and either player's gameplay input advance. There is no guest simulation.
* Save-flush promises cannot reenable a closed room. A rejected native transition
  restores choices on both screens. Save storage and downloaded-asset caches
  remain separate; room credentials are never saved in progression.

## Local validation

Use pinned Emscripten 6.0.11 and vcpkg `c748cb44f2a435fcf015c35225c9d5545fe0021c`.
Restore excluded local Node dependencies with the committed lockfile before
starting Miniflare:

```sh
npm ci --prefix tools/web/coop --ignore-scripts
cmake --build /path/to/web-release --parallel 4
python3 tools/web/verify_artifact.py /path/to/web-release \
  --source-commit FULL_SOURCE_SHA --configuration Release
python tests/wasm/coop_flow_smoke.py /path/to/web-release --output evidence/flow-chromium
python tests/wasm/coop_flow_smoke.py /path/to/web-release --browser webkit --output evidence/flow-webkit
python tests/wasm/coop_level_smoke.py /path/to/web-release --output evidence/checkpoints
```

The flow suite runs a compiled host and separate guest through the actual local
Worker/Durable Object. Host-only placement fixtures enter the original native
end triggers; this is not an unassisted playthrough. It tests Welcome → Replay →
Next Journey → Replay Journey in one room, delayed-baseline physics/input gates,
remote movement, stale result/native command rejection, double-tap protection,
save failure/retry, trusted Pause/Resume, both solved records after a real reload,
no repeat guest artwork/WASM/DATA/music downloads, and portrait/landscape results.
Screenshots and reports identify the engine, configuration and source manifest.
Browser emulation and Linux WebKit do not establish physical iPhone acceptance.

Validation results are recorded in this PR. Current physical iPhone Safari,
Android Chrome and separate-network traversal remain unverified. Follow the
[phone checklist](PRIVATE_COOP_PHONE_ACCEPTANCE.md), including both roles,
normal level traversal, Replay/Next, checkpoint revival, background/Resume and
persistent progression before expanding the supported level allowlist.

## Preview and publication without CI

At the user's request, all ten validation workflows remain manually disabled.
Local checks do not reenable or dispatch them. Mobile Web Preview and Mobile Web
Deploy remain available; normal Deploy updates the separate single-player Worker.
Repository rules are unchanged; classic branch-protection inspection returned 403.

For local use, assemble a complete artifact and run the actual room server:

```sh
python3 tools/web/package_assets.py assemble --build /path/to/web-release --output /tmp/supertux-coop
node tools/web/coop/preview.mjs /tmp/supertux-coop 8787
```

Wait for `INPUT_PROOF_READY`, then open `http://127.0.0.1:8787/index.html` and use
Private co-op. This address is local to the development machine. The complete
artifact includes both levels' guest artwork and all startup/deferred host assets.
Do not use a plain static server to test rooms.

After review and merge into `mobile-web-audit`, explicitly request private staging:

```sh
runtime_sha=$(gh api repos/jbbejena/supertux/branches/mobile-web-audit --jq .commit.sha)
gh workflow run mobile-web-preview.yml --repo jbbejena/supertux \
  --ref mobile-web-audit -f ref="$runtime_sha" -f publish_coop=true
```

These are operator instructions, not a publication performed by this PR.
`ref` must be a full 40-character SHA already integrated into `mobile-web-audit`.
Trusted inline workflow gates check format, checked-out identity and integration
ancestry before publication. An omitted `validation_run_id` builds a fresh pinned
Release artifact; complete source/configuration/toolchain/manifest/payload checks
remain mandatory. This is a build and delivery action, not a CI acceptance claim.
If an exact successful non-PR validation artifact exists, optionally supply its
numeric run ID; missing/mismatched artifacts fail rather than silently rebuilding.
No unverified latest artifact or privileged `workflow_run` path is introduced.
Private publication remains serialized, with the existing isolated Worker,
credentials, R2 streaming and exact hosted readiness probes. Check its job summary
and hosted `BUILD_INFO.json` before assuming the invitation serves the new code.
