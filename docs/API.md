# AidScaler simulator API

[Overview](../README.md) · [Runtime](RUNTIME.md) · [Evaluation](EVALUATION.md)

The simulator exposes a public information source, an organization gateway and a private observer. An external response platform supplies its own reasoning and records its actions through these interfaces. The simulator does not call a model provider.

## Access

| Surface                     | Default address                   | Access                                     |
| --------------------------- | --------------------------------- | ------------------------------------------ |
| Laboratory and observer API | http://127.0.0.1:4318             | Observer key or laboratory session cookie  |
| Fictional public sources    | http://127.0.0.1:4319             | Public HTML/JSON, subject to source limits |
| Organization gateway        | http://127.0.0.1:4319/api/actor/* | Organization- and role-scoped bearer key   |

The server writes credentials to ignored .local/session.json. Send organization requests with Authorization: Bearer ORGANIZATION_KEY. Keep observer credentials separate from platform credentials. The default organization role is agent; it can inspect and propose, while commander/dispatcher permissions are required for consequential actions.

Authority is determined by the authenticated session. Posting a role or owner field does not grant permission. Responses use JSON errors containing error and message.

Authenticated actor responses include `X-AidScaler-Source-Instance`. Bind a response workspace to the value returned by its first actor-state read and send the same header on every actor POST. Resetting or generating a world changes this transport identity even with the same seed; an exact coordinated checkpoint resume retains it. A mismatch returns `409 SOURCE_RESPONSE_CHANGED` before changing the world. Connect a new response workspace instead of reusing old reservations or operations. The deterministic `runId` and actor JSON remain unchanged. Legacy clients without this optional header remain compatible; new integrations should always bind it. Inline checkpoint launchers must preserve the `sourceInstance` credential metadata alongside their checkpoint and pass it to `createLabServers` when resuming.

## Sources and received information

| Method / path          | Purpose                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| GET /feed              | Scrapeable timeline with publication IDs, versions and pagination    |
| GET /search?q=water    | Search available publications                                        |
| GET /posts/:id         | Publication permalink                                                |
| GET /api/feed          | JSON page containing posts and nextCursor                            |
| GET /public            | Published aggregate response updates                                 |
| GET /api/contracts     | Action, observation and configuration schemas                        |
| GET /api/actor/state   | The organization's received observations and own operational records |
| GET /api/actor/inbox   | Available team messages                                              |
| GET /api/actor/queries | Its asynchronous queries and results                                 |

Feed filters include q, cursor, limit, since, author and location. A post becomes accessible after composition, transmission and indexing. Public feeds exclude team-only messages and private truth labels. Synthetic attachments describe media and its simulated size; they are not actual image, audio or video bytes.

Road and facility queries return received observations with their original observation times. Public map queries provide geography and a place directory. A query does not reveal an unreported need or replace a current physical safety assessment.

## Submit an action

Human warehouse intake uses `POST /api/actor/inventory/receipt` with
`{resource, quantity, receiptReference, note?, idempotencyKey}`. Only the
authenticated owning commander or dispatcher may use it in an interactive
world; an agent key cannot. The existing usable inventory receives a ledger
addition and returns a canonical receipt. A unique reference is idempotent
within its organization; different quantities under the same reference conflict.
It is not a new depot, a field observation, or proof of delivery to a community.
Public-demo intake additionally applies depot caps, at most 600 L or 120 portions
per receipt, and one manual receipt per team per 30 simulated minutes.

POST /api/actor/action accepts a typed envelope:

```json
{
  "type": "query",
  "params": { "target": "inventory" },
  "idempotencyKey": "inventory-query-01"
}
```

An idempotency key is required. Actions that support version checking accept expectedVersion. Query actions initially return a pending query; wait for its received ready result before using it.

The catalogue covers evidence records, queries, verification, proposals and reviews, commitments, transfers, dispatch, rerouting, repairs, facility activation, evacuation, purchases, sharing, publication, coverage checks, unloading and human work. GET /api/contracts exposes the current fields; contracts/actions.mjs defines validation.

A normal integration reads accessible evidence, requests checks, proposes a plan, obtains the responsible owner's review, executes the authorized steps and follows their physical receipts. Arrival, unloading and useful service are distinct states. Other organizations' resources require their consent.

## Intake and human work

POST /api/actor/ingestion records a publication receipt:

```json
{
  "id": "COPY_PUBLIC_POST_ID",
  "version": 1,
  "stage": "downloaded"
}
```

Stages are downloaded, accepted, interpreted and discarded. Download must precede later stages for the same organization, ID and version. These receipts record the client's reported processing; they do not prove understanding. The batch endpoint /api/actor/ingestion/batch accepts up to 100 items.

The human_work action schedules read, decide or relay work against received evidence:

```json
{
  "type": "human_work",
  "params": {
    "stage": "read",
    "reference": { "kind": "post", "id": "COPY_PUBLIC_POST_ID", "version": 1 }
  },
  "idempotencyKey": "read-source-01"
}
```

Replace the placeholder with an accessible post and its actual version. Read the organization's humanWork and humanInbox receipts from actor state. Finite workers, dependencies, errors and communication affect completion. Reading does not authorize a shipment or supply hidden facts. With an active attention profile, owner reviews share the finite decision pool.

## Clocks and external models

POST /api/actor/model/start and /api/actor/model/finish record external-computation timing and usage. The platform runs the model; wait for the resulting available receipt before acting on it.

Live mode uses the wall clock at ×1. Modeled mode supports accelerated experiments with explicit availability timing. Replay uses recorded inputs and timing rather than new inference. Treat a failed or pending model call as failed or pending.

Times are simulated milliseconds; distances are metres. Water inventory uses litres, vehicle fuel uses millilitres, food uses portions, blankets use items and staff uses people. Finance uses sandbox credits. [CALIBRATION.md](CALIBRATION.md) explains the assumptions and units.

Observer controls, configuration, interventions, metrics and checkpoints are on port 4318 under /api/*. They are for the laboratory operator and must not be exposed as an organization's source of knowledge. API-only hosting uses the same engine and source gateway; see the [quick start](../README.md).

## Compact presentation transport

Interactive launchers isolate the physical engine from HTTP readers and the local durable queue. Reads represent the latest published simulation boundary and may lag the engine; they do not wait for a viewer or integration to acknowledge data. Commands still enter the same ordered, authoritative engine. A transport acknowledgement does not approve an operation or confirm a delivery.

| Observer endpoint                                    | Purpose                                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET /api/viewer/bootstrap?org=org0&perspective=truth | Static map baseline and the current presentation frame                                               |
| GET /api/viewer/frame?org=org0&perspective=truth     | Compact changes relative to that baseline; reload bootstrap when mapId changes                       |
| GET /api/state                                       | Hydrated presentation state in isolated mode; inline library mode retains the full observer snapshot |
| GET /api/activity                                    | Bounded recent information lanes                                                                     |
| GET /api/runtime                                     | Tick/work timing, simulation lag, queue backlog and transport health                                 |
| GET /api/checkpoint                                  | Complete authoritative checkpoint for exact recovery/replay                                          |
| GET /api/metrics                                     | Exact evaluation captured at one simulation boundary and computed in a separate worker               |

Organization clients may request `GET /api/actor/state?compact=1`. Query bodies become `resultRef: {id, version}`; retrieve a result with `GET /api/actor/query-result?id=...&version=...` using the same organization credential. Cache by organization, run and content revision. The `compact.mapQueryId` identifies the retained query that supplies `known.map`. Reconstructing those references yields the existing actor-state shape. A stale revision returns HTTP 409; refetch state rather than combine revisions. The plain actor-state endpoint continues to hydrate results for older clients.

The local bus uses stable event IDs, scoped audiences, ordered deliveries, leases, explicit acknowledgements and replay. It retains authoritative events; acknowledged presentation messages and unreferenced presentation blobs have bounded retention. Restart rebuilds read views from a fresh baseline. The [Pub/Sub bridge](../scripts/gcp-bridge.mjs) connects the simulator to hosted applications. Consumers retain event-ID deduplication and acknowledge after their side effects commit. `createLocalEventBus` and the injected document store are replaceable transport ports; no cloud SDK is imported by the engine.

## Hosted demonstration adapter

`scripts/demo-host.mjs` exports `startDemoHost({dataDir, observerPort, sourcePort,
allowDemoBuildUpgrade, allowOperationalDemoUpgrade, director, rate})`. It starts the existing isolated engine,
not a second simulation. Both simulator ports remain bound to loopback; a
separate gateway must expose only the spectator projection and scoped platform
operations. `dataDir` must be persistent. The returned host supplies private
`credentials`, `lab`, `pause()`, `resume()`, `persist()` and `close()`.

These routes require observer authentication, including the spectator reads:

| Method / path                         | Contract                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET /api/demo/bootstrap               | Immutable geographic map and first allowlisted spectator frame                                                                                                            |
| GET /api/demo/frame                   | Current vehicles, requests, operation receipts, public posts and team names; no secrets, private inventory, future sources or actor observations                          |
| POST /api/demo/organizations          | `{name, color, idempotencyKey, resupply?}` creates a unique physical visitor team, with three vehicles, 600 L water, 120 meal portions, staff and fuel                    |
| POST /api/demo/organizations/release  | `{org, idempotencyKey}` retires only a drained visitor team and revokes its actor access; ownership and operation history remain distinct                                 |
| POST /api/demo/organizations/resupply | `{org, idempotencyKey, resupply}` changes one team's bounded incoming-supply schedule                                                                                     |
| POST /api/demo/director               | `{enabled, intervalMs, maxOpen, maxActive, baseOperations, resolvedThreshold, waveSize, quietWatchdogMs, visitorWindowMs}` controls bounded demo waves and base responses |

Mutations are rejected outside an interactive `continuousDemo` world. The
default admission quota is four active visitor teams. Names and kit resources
are idempotent across retries and exact checkpoint restores. A retired identity
is never reassigned. The lifetime registration quota is also finite. Actor keys
are provisioned separately using the existing seven-day scoped actor contract;
the gateway owns renewal and never sends source or observer keys to a browser.

The hosted director publishes requests and delayed local-team reports through
ordinary source channels. It does not copy spectator knowledge into the agent.
Supply replenishments use recorded `demo_supply_replenished` ledger additions,
not fabricated delivery receipts. Transport, loading, authorization, arrival
and useful receipt retain their normal physical semantics. This is a controlled
operational demonstration with synthetic incidents and resupply, not a benchmark
or a calibrated model of lives saved over months. Only this host disables
unbounded population-generated requests and fatality probabilities; ordinary
world defaults and evaluation scenarios are unchanged.

The hosted director also enables clearly labelled scripted base teams. Their
owner-scoped native dispatches contribute at most 100 L or 40 meal portions per
new incident, leaving most of the request available for visitors. They are not
model inferences. The continuous base driver roster and supply additions are
explicit recorded demo configuration. An existing visitor dispatch takes
precedence over that incident's scripted base response.
After the visitor intervention window (30 simulated minutes by default), bases
can serve the outstanding amount after subtracting active incoming deliveries.
A connected but inactive visitor does not block continuation. Cleanup is
recorded and still requires physical receipt; visitor assets are never
automatically authorized. Three resolved requests trigger a further wave;
a ten-simulated-minute quiet watchdog can open more requests up to the cap.
At capacity it reconfirms an existing shortfall, preserving the original target
and all physical receipts instead of deleting unmet requests.

`resupply` is `{enabled, intervalMs, water, food}`, defaulting to
`{enabled:true, intervalMs:1800000, water:300, food:60}`. Intervals range from
300,000 to 21,600,000 ms of simulated time; water and food ranges are 0–600 L
and 0–120 portions. Depot stock is capped at 1,200 L and 300 portions.
Changes start the next interval from the current time, with no historical
catch-up. Scheduled receipts, references and generations survive checkpoints.
Disabling the schedule retains stock and prevents future scheduled additions.

The host saves credentials, checkpoints, transport cursors and authoritative
archives on the persistent volume. Close operational writers before `host.close()`
for a coordinated final checkpoint. A source storage failure pauses the clock
and becomes a health failure. An ungraceful process loss may leave the platform
newer than the last checkpoint; preserve the source-response fence and perform
explicit recovery rather than silently pairing mismatched state. Compatible
demo-only build upgrades require `allowDemoBuildUpgrade: true`; engine contracts
and physical state are checked and a private migration receipt is saved. No
benchmark checkpoint is migrated.
Hosted storage maintenance removes only previous-process archive working copies
captured before the new engine starts, after the replacement checkpoint commits.
The active files and the retained checkpoint remain protected. A demo-only audit
consumer verifies each queued audit payload against the durable checkpoint's
event offset and hash before acknowledging and pruning that redundant queue copy.
The authoritative physical log, other consumers' unacknowledged deliveries and
all event-ID deduplication tombstones remain intact. Generic bus/benchmark
retention semantics are unchanged. `storage-maintenance.json` records the work.
The demo presentation cadence defaults to 1500 ms; engine ticks and physical
simulation timing are unaffected.

`allowOperationalDemoUpgrade: true` separately authorizes the initial hosted
workflow migration of only recurring population requests, health reports and
the four fatality probabilities to their demo settings. It preserves all past
physical state and writes a private before/after receipt. It is never implicit,
never changes transport or action physics, and cannot migrate a benchmark.

`viewer/spectator-map.mjs` exports a fetch-free `createSpectatorMap()` renderer.
Its only inputs are the sanitized bootstrap and frames. It reuses Three.js,
the existing `MotionBuffer` and shared road geometry. It has selection, camera
and vehicle-follow methods, and no world-control or actor-command methods.
