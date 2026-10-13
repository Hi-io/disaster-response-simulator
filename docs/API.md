# AidScaler simulator API

The simulator exposes a public information source, an organization gateway and a private observer. An external response platform supplies its own reasoning and records its actions through these interfaces. The simulator does not call a model provider.

## Access

| Surface | Default address | Access |
|---|---|---|
| Laboratory and observer API | http://127.0.0.1:4318 | Observer key or laboratory session cookie |
| Fictional public sources | http://127.0.0.1:4319 | Public HTML/JSON, subject to source limits |
| Organization gateway | http://127.0.0.1:4319/api/actor/* | Organization- and role-scoped bearer key |

The server writes credentials to ignored .local/session.json. Send organization requests with Authorization: Bearer ORGANIZATION_KEY. Keep observer credentials separate from platform credentials. The default organization role is agent; it can inspect and propose, while commander/dispatcher permissions are required for consequential actions.

Authority is determined by the authenticated session. Posting a role or owner field does not grant permission. Responses use JSON errors containing error and message.

## Sources and received information

| Method / path | Purpose |
|---|---|
| GET /feed | Scrapeable timeline with publication IDs, versions and pagination |
| GET /search?q=water | Search available publications |
| GET /posts/:id | Publication permalink |
| GET /api/feed | JSON page containing posts and nextCursor |
| GET /public | Published aggregate response updates |
| GET /api/contracts | Action, observation and configuration schemas |
| GET /api/actor/state | The organization's received observations and own operational records |
| GET /api/actor/inbox | Available team messages |
| GET /api/actor/queries | Its asynchronous queries and results |

Feed filters include q, cursor, limit, since, author and location. A post becomes accessible after composition, transmission and indexing. Public feeds exclude team-only messages and private truth labels. Synthetic attachments describe media and its simulated size; they are not actual image, audio or video bytes.

Road and facility queries return received observations with their original observation times. Public map queries provide geography and a place directory. A query does not reveal an unreported need or replace a current physical safety assessment.

## Submit an action

POST /api/actor/action accepts a typed envelope:

~~~json
{
  "type": "query",
  "params": { "target": "inventory" },
  "idempotencyKey": "inventory-query-01"
}
~~~

An idempotency key is required. Actions that support version checking accept expectedVersion. Query actions initially return a pending query; wait for its received ready result before using it.

The catalogue covers evidence records, queries, verification, proposals and reviews, commitments, transfers, dispatch, rerouting, repairs, facility activation, evacuation, purchases, sharing, publication, coverage checks, unloading and human work. GET /api/contracts exposes the current fields; contracts/actions.mjs defines validation.

A normal integration reads accessible evidence, requests checks, proposes a plan, obtains the responsible owner's review, executes the authorized steps and follows their physical receipts. Arrival, unloading and useful service are distinct states. Other organizations' resources require their consent.

## Intake and human work

POST /api/actor/ingestion records a publication receipt:

~~~json
{
  "id": "COPY_PUBLIC_POST_ID",
  "version": 1,
  "stage": "downloaded"
}
~~~

Stages are downloaded, accepted, interpreted and discarded. Download must precede later stages for the same organization, ID and version. These receipts record the client's reported processing; they do not prove understanding. The batch endpoint /api/actor/ingestion/batch accepts up to 100 items.

The human_work action schedules read, decide or relay work against received evidence:

~~~json
{
  "type": "human_work",
  "params": {
    "stage": "read",
    "reference": { "kind": "post", "id": "COPY_PUBLIC_POST_ID", "version": 1 }
  },
  "idempotencyKey": "read-source-01"
}
~~~

Replace the placeholder with an accessible post and its actual version. Read the organization's humanWork and humanInbox receipts from actor state. Finite workers, dependencies, errors and communication affect completion. Reading does not authorize a shipment or supply hidden facts. With an active attention profile, owner reviews share the finite decision pool.

## Clocks and external models

POST /api/actor/model/start and /api/actor/model/finish record external-computation timing and usage. The platform runs the model; wait for the resulting available receipt before acting on it.

Live mode uses the wall clock at ×1. Modeled mode supports accelerated experiments with explicit availability timing. Replay uses recorded inputs and timing rather than new inference. Treat a failed or pending model call as failed or pending.

Times are simulated milliseconds; distances are metres. Water inventory uses litres, vehicle fuel uses millilitres, food uses portions, blankets use items and staff uses people. Finance uses sandbox credits. [CALIBRATION.md](CALIBRATION.md) explains the assumptions and units.

Observer controls, configuration, interventions, metrics and checkpoints are on port 4318 under /api/*. They are for the laboratory operator and must not be exposed as an organization's source of knowledge. API-only hosting uses the same engine and source gateway; see the [quick start](../README.md).

