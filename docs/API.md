# Local integration contract

The simulator generates a deterministic world. A separate platform supplies intelligence. No AI provider SDK, inference runtime or provider API credential is used by this repository.

## Surfaces and access

| Surface | Default address | Access |
|---|---|---|
| Observer UI and controls | `http://127.0.0.1:4318` | Observer bearer key or HttpOnly session cookie |
| Fictional public network | `http://127.0.0.1:4319` | Public HTML/JSON with request limits |
| Organization tool gateway | `http://127.0.0.1:4319/api/actor/*` | Bearer key scoped to one organization and role |

The server generates `.local/session.json` locally. Do not commit it. The default actor role is `agent`; it cannot review, dispatch, activate a facility or authorize a transfer. Observer interventions use explicit human commander identities. The external platform must not receive observer credentials, hidden truth labels, evaluation databases or the simulator's private state.

Requests return JSON errors with `error` and `message`. Typical errors include 401 authentication, 403 authority/access, 404 inaccessible entity, 409 stale version/duplicate review, 429 quota/budget and 503 source/tool outage. Authority comes from the authenticated session, never a posted `role`, `actor` or `authorizedBy` field.

## Public sources

| Method / path | Result |
|---|---|
| GET `/feed?cursor=0` | Scrapeable HTML articles with opaque `data-post-id`, version and media descriptions |
| GET `/search?q=water` | Searchable HTML; same visibility and pagination rules |
| GET `/posts/:id` | Accessible publication permalink |
| GET `/users/:id` | Author's available publications |
| GET `/public` | Aggregate public relief updates; sandbox only |
| GET `/api/feed` | `{ posts, nextCursor, ... }` public publication page |
| GET `/api/contracts` | Input/action/config schema catalogues |

JSON feed filters: `q`, `cursor`, `limit`, `since`, `author`, `location`. Pagination values must be nonnegative integers. A publication becomes readable only after composition, transmission and indexing; edited versions and deletion affect later reads. `claimedAt` can be unreliable and differs from actual publication time.

Synthetic attachments contain `kind`, `description`, optional duration and simulated byte size. They do not contain actual video, images or audio. Public sources never include `private.false`, preset identifiers, actual hidden location, cause IDs or truth categories. A team message is absent from public feeds/search/permalinks and other organizations' inboxes.

## Organization gateway

| Method / path | Result / request |
|---|---|
| GET `/api/actor/state` | This organization's received observations, own proposals, operations, inspections, commitments, offers, claims and timing receipts |
| GET `/api/actor/inbox` | Available scoped team messages |
| GET `/api/actor/queries` | This organization's recent asynchronous tool calls and results |
| POST `/api/actor/action` | Versioned action envelope below |
| POST `/api/actor/ingestion` | `{ id, version, stage, reason? }` publication acknowledgement |
| POST `/api/actor/model/start` | `{ model: "external-platform" }` starts an external-computation timing receipt |
| POST `/api/actor/model/finish` | `{ id, wallMs?, promptTokens?, outputTokens?, failed? }` completes that receipt |

Ingestion stages are `downloaded`, `accepted`, `interpreted`, `discarded`. Download must precede the other stages for the same organization, publication and version. The record retains the downloaded content and canonical content hash. This is a submitted receipt, not proof that an external model understood it. Old version receipts remain even after edits/deletion.

The client in `adapters/client.mjs` actually scrapes HTML and downloads JSON. `feed()` records downloads; it does not automatically claim every downloaded item was accepted or understood. Source revocation, rate limits, indexing changes and schema faults are observable failures, not fabricated empty successes.

### Action envelope

```json
{
  "type": "propose",
  "params": {
    "title": "Verify the shelter's current needs",
    "plan": { "next": "field assessment" },
    "references": []
  },
  "idempotencyKey": "proposal-unique-id"
}
```

`expectedVersion` is an optional nonnegative integer for version-aware operations. An idempotency key is mandatory. Quantities are nonnegative integers; physical operations generally require positive quantities. Times are elapsed **simulated milliseconds**, distance is metres, water/fuel inventory is litres, vehicle fuel is millilitres, food is portions, staff is people and funds are sandbox credits. One food portion supplies 700 kcal in the experimental population model.

### Action catalogue

| ID / action | Main parameters | Authority / consequence |
|---|---|---|
| O01 `record_claim` | `text`, `references` | Agent; evidence record, no physical effect |
| O02 `relate_reports` | `claim`, `references`, `relation` | Agent; same incident / independent / contradiction / separate |
| O03 `flag_report` | `post`, `state`, `reason` | Agent; suspected / old / contradicted / unverified / confirmed |
| O04 `query` | `target`, optional `id` and filters | Agent; bounded asynchronous result, snapshot time and simulated latency |
| O05 `verify` | `target`, `id`, `method` | Agent; field/radio/clarification request, finite work and delayed response |
| O06 `propose` | `title`, `plan`, `conditions`, `references` | Agent; awaits owner review |
| O07 `review` | `id`, `decision`, optional `plan` | Commander/dispatcher; queued approve/reject/clarify/modify, accountable actor |
| O08 `capabilities` | optional filters | Agent; permission-limited partner capabilities |
| O09 `commitment` | `action`, `resource`/`id`, `quantity`, `requester`, `ttlMs`, `conditions` | Resource owner commander; offer/reserve/confirm/release/withdraw/reject |
| O10 `transfer` | `action`, `resource`/`id`, `to`, `quantity`, `loan`, `returnBy` | Bilateral commander approval, followed by actual transport |
| O11 `dispatch` | `resource`, `vehicle`, `quantity`, `need` or `building`/`destination`, optional `commitment`/`proposal`/`transfer` | Commander/dispatcher; instruction, loading, travel, receipt and service |
| O12 `reroute` | `vehicle`, `destination` | Owner commander; delayed order applies at a reachable road boundary |
| O13 `repair` | `edge`, optional `engineering` | Commander; physical crew, access and time; active flood cannot be cleared as rubble |
| O14 `activate` | `building`, `permit: true` | Facility owner; current safe assessment and physical compatible dependencies |
| O15 `evacuate` | `from`, `to`, `vehicle`, `quantity` | Commander; finite seats, actual pickup, safe place reservation and arrival |
| O16 `purchase` | `type`, `quantity`, `price`, `leadMs`, supplier/location parameters | Commander; finite sandbox funds/vendor stock and procurement delay |
| O17 `share` | `to`, `kind`, `id`, optional `revoke` | Scoped evidence/resource/commitment sharing; owner-controlled revocation |
| O18 `correct` | `id`, `text` | Own claim correction with versioned history |
| O19 `cancel` | `id` (operation) | Commander; delayed instruction stops future work, physical cargo and sunk costs retained |
| O20 `publish` | `text`, optional `stage`, `operation` | Public aggregate update; physical stages require real evidence |
| O21 `coverage` | `{}` | Read known contact/coverage; no inference that silence means safety |
| O22 `abstain` | `reason`, optional context | Record an explicit decision not to act |
| O23 `record_outcome` | `summary`, `conditions`, `references` (received operation IDs) | Commander; optional evidence-backed precedent, conditions must be revalidated |

Implementation handlers and tested examples are the precise parameter reference: `engine/operations.mjs`, `tasks.mjs`, `cooperation.mjs`, `facilities.mjs`, `laboratory.mjs`. A catalogue entry is not authorization to bypass its handler.

Query targets include inventory, vehicles, roads, map, facility, capabilities, documents, policy, sources, personnel, communication, bulletins, forecasts, finance, memory, team, integrations and **received population observations**. `query` returns a pending query ID; read completed results from the scoped query endpoint or actor state. Physical truth is not returned by asking for an unknown need's health: a field/radio observation must first reach the organization.

## External computation and clocks

Timing endpoints never run an AI model. The separate platform calls its own model, stores its response and reports elapsed wall time and usage here.

- **Live:** configure `mode: "live"`, automatically selecting `clockLatency: "wall"`. The world advances at ×1 while external computation is pending. A result cannot be backdated. Higher UI speeds are rejected.
- **Modeled:** the world waits at a barrier until a recorded result arrives; availability is then scheduled at `max(now, requestedAt + modelLatencyMs)`. This supports deterministic accelerated experiments. Declared latency is an assumption, not a measured Gemini benchmark.
- **Replay:** recorded receipt timing and submitted actions are reused. No new model inference is performed. The same world does not imply the same new stochastic external response.

The external platform should wait for a timing receipt's `available` state before submitting the corresponding decision. The generic client does this. Pending external calls cannot silently become successful completed headless runs. Report failed calls and tool/inference budgets, not only favorable responses.

## Observer-only controls

Read endpoints: `/api/state`, `/api/catalog`, `/api/checkpoint`, `/api/metrics`, `/api/events?entity=...&offset=0`, `/api/credentials`, `/api/compare`.

Mutation endpoints: `/api/config`, `/api/control`, `/api/action`, `/api/inject`, `/api/restore`, `/api/comparison`. They require observer authorization and same-origin protection where a browser Origin is supplied. Invalid replacement configurations/checkpoints preserve the existing world.

Control supports play, requested rate, one event step, advance-to-time and next relevant entity event. Config values are validated against `CONFIG_SCHEMA`; unknown fields fail. Interventions include damage, road changes, connectivity/hazard events and typed laboratory faults. Use declared interventions, not arbitrary internal event handlers.

An observer is intentionally omniscient for laboratory inspection. The separate actor gateway is the platform's interface. Browser organization views are useful for demonstrations, but the browser still has observer access; do not hand that observer tab to an evaluated autonomous actor.
