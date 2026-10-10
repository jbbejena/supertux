# Private co-op: HTTPS staging and phone acceptance

The [private HTTPS host](https://supertux-private-input-proof.jshbjnr.workers.dev/index.html?coop=1)
now serves recovery runtime `7c7926478e40f24cf6bca972609f1a86ee5d1de4`,
based on merged Phase 8B at `0a240fc3445efd08610b9d66bf6b647a512fbfca`.
It supports the original Welcome to Antarctica level and the static diagnostic
arena, with smoother guest presentation, neutral shared pause, bounded socket
recovery, trusted Resume and a save-preserving title restart. The
[supported-level handoff](PRIVATE_COOP_SUPPORTED_LEVEL.md),
[smoothing measurements](PRIVATE_COOP_SMOOTHING.md), and
[recovery implementation and failures](PRIVATE_COOP_RECOVERY.md) describe scope.
The implementation remains under review in
[PR #17](https://github.com/jbbejena/supertux/pull/17).

All six [focused PR checks](https://github.com/jbbejena/supertux/actions/runs/38016818646)
pass for this runtime. The
[non-PR exact-source WASM run](https://github.com/jbbejena/supertux/actions/runs/38016814903)
passes Release/Debug after one failed-Release-job rerun on the identical source.
The first Release attempt and ordinary local Chromium run failed after long host
stalls; their authenticated rooms recovered with neutral input and stayed paused
awaiting trusted Resume. Those failures remain recorded. They do not count as
uninterrupted acceptance or establish physical-phone performance.

The [separate staging run](https://github.com/jbbejena/supertux/actions/runs/38020319030)
reuses that exact successful Release artifact; frontend/manifest/payload readiness
has passed. Hosted Chromium failed during checkpoint restart after a 3,368.1 ms
host stall; its sockets recovered with neutral input and stayed paused for Resume.
That run is failed and its original fail-fast step did not run WebKit. An independent
ordinary hosted Linux WebKit 26.5 run passes all 23 checks with no console/script
errors. The PR now runs both hosted checks and fails if either fails. Its summary
distinguishes successful delivery from the browser outcome. Physical iPhone, Android
and separate-network tests below remain unverified. No production publication
or merge is part of this work.
Normal Mobile Web Deploy does not enable the private rooms.

To republish this tested runtime, use the complete source and successful run:

```sh
gh workflow run mobile-web-preview.yml --repo jbbejena/supertux \
  --ref codex/private-coop-stall-recovery \
  -f ref=7c7926478e40f24cf6bca972609f1a86ee5d1de4 \
  -f validation_run_id=38016814903 -f publish_coop=true
```

For a different runtime, first run `wasm.yml` on its reviewed branch and wait for
both configurations. Supply its exact successful non-PR validation run; never
use a build-only preview, PR artifact or unverified latest artifact.

For Phase 7B phone acceptance, choose **Play Welcome to Antarctica** in step 3.
Additionally verify coin pickup, enemy contact, growth, information panels,
brick breaking, fireballs/ice melting, secret-area tile fading, checkpoint
restart and actual level completion. Repeat with both host and guest roles.

## Previously published Phase 7A evidence

Phase 7A is merged into `mobile-web-audit` at
`e5cfbe08ea4bb4959ad8b84cd3763366dd8eeba1`. The shared display supports the
controlled static scene, not a campaign level. The existing production Worker
still has no `COOP_ROOMS` binding.

The [HTTPS host preview](https://supertux-private-input-proof.jshbjnr.workers.dev/index.html?coop=1)
is published. [Integration validation](https://github.com/jbbejena/supertux/actions/runs/37843161404)
passed Release/Debug WASM and representative Linux for that exact runtime.
[Hosted staging validation](https://github.com/jbbejena/supertux/actions/runs/37847833680)
verified 116 frontend files and 79 immutable payloads, reused all 79 R2 objects
without uploading replacements, and passed all nine display checks in each of
Chromium 151 and Linux WebKit 26.5. Both reports contain no errors. These are
emulated browsers, not physical phones or separate-network acceptance.

## Publish a separate tested preview

The existing **Mobile Web Preview** workflow now has an explicit `publish_coop`
option, defaulting to false. Ordinary preview builds still publish downloadable
artifacts. With staging selected, supply a complete runtime commit SHA and an
explicit successful validation run for that exact source. The staging path
rejects PR artifacts, foreign repositories, mismatched source/toolchain/build
identities, incomplete assets and missing artifacts. It never selects “latest.”

The workflow runs from the staging tooling branch while checking out the runtime
at the requested tested SHA. Its deployment and browser validation tools are
checked out separately;
the Worker, browser code and complete game artifact use the tested runtime. This
allows publication tooling to be reviewed without rebuilding or changing that
runtime. The build job contains no deployment secrets.

The historical Phase 7A publication used:

```sh
gh workflow run mobile-web-preview.yml --repo jbbejena/supertux \
  --ref codex/private-coop-staging \
  -f ref=e5cfbe08ea4bb4959ad8b84cd3763366dd8eeba1 \
  -f validation_run_id=37843161404 -f publish_coop=true
```

The separate publication job uses the existing `tux` environment's
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `R2_ACCESS_KEY_ID` and
`R2_SECRET_ACCESS_KEY`. Credentials remain in GitHub environment secrets; neither
the checkout nor the cloud setup stores their values. The recent successful
production deployment establishes that route; secret-list inspection is not
available to this integration. Missing or denied credentials fail publication
with the relevant variable/API error.

Publication is limited to Worker `supertux-private-input-proof`, using
`wrangler.coop.toml`, its SQLite `COOP_ROOMS` binding and the existing private R2
bucket. The configuration check rejects a different Worker name or attached
routes/environments/services. Existing content-addressed R2 objects are checked
and reused; incompatible immutable objects are never overwritten. The production
Worker/configuration/workflow is not invoked.

Staging runs serialize and do not cancel an active publication. Ordinary preview
validation keeps cancellation in a separate concurrency group. Production's
existing serialization is unchanged.

The readiness check requires the exact frontend/manifest/build identity, hashes
every presentation asset, verifies MIME and immutable artwork caching, checks
every startup/deferred R2 payload with HEAD, and exercises origin-bound room
creation without logging invitation credentials. It retries rollout within one
five-minute budget. Large game files are not downloaded or buffered by this
probe. Chromium and Linux WebKit then run the actual compiled-host/two-browser
display proof through the hosted Worker. Reports and screenshots are retained
in `private-coop-staging-evidence`; the successful run summary contains the host
HTTPS URL and runtime SHA.

HTTP probes identify themselves as `SuperTux-Coop-Validation`. The hosted edge
rejects Python's default `Python-urllib` user-agent with HTTP 403; validation
uses an explicit descriptive user-agent rather than disabling edge protection.

Touch regression automation observes a native input update after dispatching
each menu touch edge. Sampling before dispatch can mistake an earlier frame
for consumption of the new event. Setup resets use a direct touch on Restart
Level, independent of menu hover/selection; the required neutral controls and
real spawn position remain asserted. A failed reset captures a screenshot.

## Two physical phones

Use the host HTTPS URL from the successful run summary, including `?coop=1`.
Staging is a separate origin, with its own browser saves/settings and asset
cache. Production saves are not imported. The entire room currently expires after
15 minutes, including active play; create a new room for a longer testing session.

1. Phone A: use Start, expand **Private co-op**, then **Create room**.
2. Share **Guest shared view** with Phone B. That invitation contains a temporary
   guest credential; keep it private. Wait for Player 2 to join.
3. On the newly published supported-level runtime, Phone A chooses **Play Welcome to
   Antarctica**. Both screens should show the original level and both players.
   Phone A controls Player 1; Phone B controls Player 2. The older Phase 7A URL
   only offers **Start shared view proof**, a static diagnostic arena.
4. Try movement, Jump and independent finger releases. Move apart and confirm
   both living players remain visible through the native shared camera.
5. Pause/resume on the host, rotate each phone, and inspect safe areas and control
   visibility. Release fingers before continuing; old held inputs must not replay.
6. Hold movement while briefly interrupting the host/connection. On the recovery
   runtime, both players must stop, held fingers/keys must clear, and the game
   must stay paused after the connection recovers. Release controls, then use
   the host's trusted **Resume** button. Keep the co-op panel expanded once to
   confirm it cannot cover Resume. A permanent loss (including guest backgrounding
   or the bounded 15-second recovery timeout) blocks Resume: use **Return to
   title**, create a new room and open its new invitation in the same guest tab.
   The older runtime requires a title restart after any disconnect.
7. Where death occurs, wait for **Tap Action** before ordinary respawn; all-player
   death must restart with fresh display state.
8. Reload the host and confirm existing campaign saves/settings survive. The
   guest must not create campaign progression.

Repeat on separate networks and swap host/guest roles, including an iPhone Safari
host and guest. Record device model, OS/browser, network, orientation, observed
delay, any disconnect, and screenshots for failures. Hosted Linux browser tests
are emulation, not physical Safari or a two-network acceptance result.

The Phase 7B handoff records the subsequent supported-level implementation and
local evidence. Phase 8 still requires physical-phone and separate-network
acceptance before expanding content or describing mobile co-op as supported.
