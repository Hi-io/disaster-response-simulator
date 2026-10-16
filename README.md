# AidScaler Disaster Response Simulator

A deterministic environment for developing and testing disaster-response software. It models needs, reports, communications, traffic, finite resources and independent response teams. The isometric 3D viewer uses simple geometry to make those interactions easy to inspect.

The simulator provides the world and its interfaces. The separate [AidScaler platform](https://github.com/Hi-io/aidscaler-platform) connects through organization-scoped APIs and currently supports Gemma 4 through OpenRouter. Running this simulator requires no model API key.

## Quick start

Install Node.js 24 or later and pnpm 11, then:

~~~sh
git clone --depth 1 https://github.com/Hi-io/disaster-response-simulator.git
cd disaster-response-simulator
pnpm install --frozen-lockfile
pnpm start
~~~

- Open the [3D laboratory](http://127.0.0.1:4318/).
- Explore the [fictional public feed](http://127.0.0.1:4319/feed).
- Find the generated observer and organization keys in the ignored .local/session.json file. Enter the observer key at the laboratory login. Give an integration only its scoped organization key.

The servers bind to localhost and the world starts paused. Play, Step and Advance world control the backend clock; camera movement and browser rendering do not advance it.

For the same APIs without the 3D viewer, use pnpm service. Add --play to start the clock automatically:

~~~sh
pnpm service -- --play
~~~

Use one server mode at a time because both use ports 4318 and 4319.

The public feed uses a dark social timeline and refreshes from the same source-indexed world clock. It keeps the newest 30 posts on screen and moves existing posts down as updates arrive; older posts remain accessible through pagination. Images, clips and voice notes are explicitly simulated media. The sidebar measures the latest increase in published public posts (excluding edits and private messages), divided by elapsed simulation time and scaled to a minute; it is labeled per simulation minute, so speed controls do not create an unlabeled real-time throughput claim.

For a continuously running integration demo, use `continuousDemo: true`, `mode: 'interactive'`, and `clockLatency: 'wall'` in the world configuration. The world continues through model inference and past the finite scenario horizon, with recurring content and physical processes intact. It never silently resets the seed, resources or operations. The viewer labels this mode; benchmark runners reject it. Use a finite modeled/live configuration for measurements. Explicit event, post and provider budgets still apply, and real-time acceleration is demonstration pacing rather than a latency benchmark.

## Explore the world

Choose a scenario, seed, map size and response policy in World configuration. Pan and zoom the map, inspect buildings and vehicles, follow a moving vehicle, and switch between observer truth and a team's received knowledge.

The information lanes show world events, circulating reports and information received by the selected team. The Human attention profile selector controls zero, moderate and burst presets; Advanced JSON exposes timings, finite pools, connectivity and other parameters. Built-in response policies are scripted controllers. A manual workflow or model-assisted response connects through the external API.

### A real street layout, kept local

Select **Honmura, Japan · real street layout** under Topology. This fixed, approximately one-kilometre town-core fixture contains 43 junctions and 56 two-way road segments (112 directed edges), curated from the [Honmura area in OpenStreetMap](https://www.openstreetmap.org/#map=17/34.4605/133.9975). Roads retain mapped junction connectivity and curved polylines, including Prefectural Route 256 and the port approach. Coordinates use a local metre projection without stretching the town. The [official Naoshima tourism map](https://naoshima.net/en/access-en/access_from/) provides geographic context.

No tiles, live map service, or third-party routing is used at runtime. Density and extent are fixed for this fixture; seeds still control synthetic world events. All buildings, facility uses, stocks, responders, population, traffic assumptions, hazards and operational restrictions are **invented demonstration data**, not real shelters, observed damage, or navigation advice. The irregular procedural region remains the default.

Geographic arrays in [generators/honmura.mjs](generators/honmura.mjs) are an adapted database © OpenStreetMap contributors, available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The fixture retains source way/node IDs, retrieval date, source URL and snapshot fingerprint; attribution is also visible on the map. The fixture records the curated town core rather than every path or restriction in the area.

The engine includes:

- Procedural maps, earthquake, flood and wildfire events.
- Traffic queues, route restrictions, fuel, drivers, cargo capacity and staff shifts.
- Supplies, expiring lots, owner-controlled reservations and transfers.
- Field checks, qualified teams, facility dependencies, evacuation and physical delivery receipts.
- Delayed or lost messages, outages, stale information and finite human attention.
- A fictional social network with reports, reposts, corrections and synthetic media descriptions.
- Saved checkpoints, replay, headless execution and multiple-seed experiments.

## Reproducible runs

~~~sh
pnpm check
pnpm test
node cli.mjs run --config manifests/unit.json --seed demo-01 --output runs/demo-01
node cli.mjs replay --checkpoint runs/demo-01/checkpoint.json.gz
node cli.mjs batch --config manifests/unit.json --seeds demo-01,demo-02 --policies conventional,rules --workers 2 --output runs/batch
node cli.mjs export --checkpoint runs/demo-01/checkpoint.json.gz --output runs/export
~~~

Keep the complete run directory, including its checkpoint and compact-history files. Exact replay requires the same engine build, configuration and recorded inputs. A new external model response is a new input.

See [API integration](docs/API.md), [scenarios](docs/SCENARIOS.md) and [model assumptions](docs/CALIBRATION.md). Simulation outcomes describe the configured world; population and human-work parameters require calibration before making claims about real emergencies.
