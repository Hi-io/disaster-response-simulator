# Disaster Response Simulator

A deterministic laboratory for testing disaster-response platforms against a causal world. It simulates disasters, information delays, transport, finite supplies, independent organizations and population outcomes. An isometric 3D observer lets you inspect what actually happened.

**The simulator does not run Gemini or any other AI model.** NEXO is a separate platform that will read the simulated sources, investigate alternatives and submit proposals. This repository supplies the world, action contracts, scripted reference policies and independent measurements. It requires no model API key and makes no paid inference calls.

## Run locally

Requires Node.js **24 or later** (the disk archive uses built-in SQLite) and pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm start
```

- Observer: **http://127.0.0.1:4318/**
- Fictional social network and source API: **http://127.0.0.1:4319/feed**
- Observer access and scoped organization credentials: `.local/session.json`, generated locally and ignored by Git. Enter the observer key at the login screen. Give an external platform only its organization key, never the observer key.

Both servers bind to loopback. This is a local research tool; it is not an internet-facing deployment.

The default world covers **160 × 160 km**, with 625 irregularly placed settlements, winding roads, four response organizations and **three river crossings**. Road speed, capacity, terrain cost and vehicle restrictions vary. Closing a crossing can create an hours-long detour or make a community inaccessible. The `grid` parameter controls settlement density; regional roads do not form a square grid.

The default earthquake runs for 48 simulated hours with disk-backed compact history and a scripted conventional coordination policy. Select **Manual / external platform** to operate it yourself or connect NEXO. A reference policy is ordinary code, not a substitute for a functioning Gemini integration.

## Inspect a scenario

1. Select S01–S24, seed, disaster, topology and size. Advanced JSON exposes all validated parameters.
2. Use Play, Step, Advance world or the requested ×1/×10/×100/×1000 speed. Effective speed is measured separately.
3. Drag to pan, scroll to zoom, use right-drag to rotate, or Fit region to return to the isometric overview. Click a building or truck, or search its ID. You can follow a truck and inspect its event history.
4. Switch from observer truth to an organization's received knowledge. Unknown information stays unknown. Activate road, needs, communication, community and organization layers as needed.
5. Inspect the three streams: physical reality, available communications and submitted platform ingestion receipts. Misleading-content labels appear only in observer truth.
6. Use Actions & interventions to submit proposals, review decisions, dispatch resources or introduce disruptions. Agent sessions cannot authorize physical interventions.
7. Compare A / B creates independent worlds with identical initial conditions and synchronized cameras. The built-in comparison uses scripted references, not Gemini.

Simple buildings, vehicles and cohort markers illustrate state; camera movement and frame rate never advance the simulation. The model represents operational interactions, not photorealistic physics.

## What has physical consequences

- Needs change after damage and recur when delivered supplies are consumed.
- A reservation reduces available stock. It has an owner, version and expiry; partners cannot reserve another owner's inventory without permission.
- Dispatch sends an instruction through the communication model. A truck moves only after receiving it, loading cargo and accessing a road.
- Traffic has finite entry/storage capacity, queues, spillback, fuel use, weight restrictions and shift limits.
- Arrival, unloading, receipt and useful service are separate milestones. Failed plans retain sunk distance, fuel and physical cargo.
- A shelter or water plant requires a current assessment, permission, compatible equipment and resources physically at the site. Production and generator runtime are finite.
- Independent organizations can miss needs, duplicate shipments, share observations, make conditional commitments, withdraw offers and transport borrowed equipment back.
- Internet outages, radio, bandwidth, packet loss, retries, indexing delay and stale observations affect what a platform can know and when an instruction arrives.
- Water and food shortage, injuries, exposure, unmet person-hours and **simulated fatalities** evolve over time. A deadline alone never kills people. A proposal alone never treats them.

Population response curves are **experimental assumptions**, not clinically validated predictions. Fatalities support sensitivity-tested comparisons inside the laboratory; they do not establish a real number of lives saved. See [CALIBRATION.md](docs/CALIBRATION.md).

## Reproducible experiments

```sh
pnpm test
pnpm check
node cli.mjs validate --config manifests/region.json
node cli.mjs generate --config manifests/region.json --output runs/map.json
node cli.mjs run --config manifests/unit.json --output runs/unit
node cli.mjs replay --checkpoint runs/unit/checkpoint.json.gz
node cli.mjs batch --config manifests/city.json --seeds 1,2,3 --policies conventional,rules,federated --workers 2 --output runs/batch
node cli.mjs export --checkpoint runs/unit/checkpoint.json.gz --output runs/export
pnpm benchmark
pnpm benchmark --full
```

Runs store a versioned manifest, actions/receipts, metrics, compressed event history and a checkpoint. Compact mode archives posts, messages and events in SQLite; portable saved checkpoints include their database files. Keep the bundle together. Batch jobs support bounded workers, memory/time budgets, cancellation and verified resume (`--resume`).

Batch resume reuses only completed episodes with the same configuration and source build. A cancelled episode retains its artifacts and completion reason, and is rerun on the next resume. The per-episode wall budget is checked between event chunks; hashing/export time is separate from simulation time.

Repeatability requires the **same engine source build, complete manifest and recorded inputs**. The manifest fingerprints causal source files, and checkpoints from a different build are rejected. Keep the recorded Git revision to restore an earlier build. Random streams are keyed by subsystem/entity/event, so extra tool calls do not consume a shared random generator. Running a new external inference is different from replaying its recorded output. CLI forks record their parent checkpoint and receive a distinct branch identity.

For a paired comparison, split `batch.json` into one policy per file and run:

```sh
node cli.mjs compare --a runs/reference.json --b runs/candidate.json
```

Comparisons reject duplicate seed/scenario pairs and different initial resources or budgets. Metrics retain losses and gains, include uncertainty across paired seeds and preserve units. The system does not force NEXO to win. A one-seed interval is not meaningful statistical evidence.

## Connect an external platform

Read [API.md](docs/API.md) for public HTML/JSON sources, organization-scoped access, 26 input kinds and 23 actions. `adapters/client.mjs` supplies an HTTP client and HTML discovery helper. It contains no model provider implementation.

The default actor keys have the `agent` role: they can query, record evidence and propose; a human commander must review and authorize physical actions. Reads and proposals do not silently grant authority.

External-computation receipts measure latency and usage without running inference here. Live evaluation uses ×1 wall time. Accelerated modeled evaluation uses declared simulated latency and a barrier while an external result is pending. Keep modes separate when comparing performance.

## Documentation and limits

- [SIMULADOR.md](docs/SIMULADOR.md): complete original design and subsequent map/population requirements.
- [COVERAGE.md](docs/COVERAGE.md): implementation evidence and remaining validation work.
- [API.md](docs/API.md): integration and authorization contracts.
- [SCENARIOS.md](docs/SCENARIOS.md): scenario catalogue, variants and inspection recipes.
- [CALIBRATION.md](docs/CALIBRATION.md): causal assumptions, parameter ranges and sensitivity plan.
- [PERFORMANCE.md](docs/PERFORMANCE.md): measured workloads and scaling limits.
- [PLATAFORMA.md](docs/PLATAFORMA.md) / [DEMO.md](docs/DEMO.md): context for NEXO and its eventual demonstration.

There are 360 content presets across 30 semantic families. Held-out content is separated by variant within a family; this is not a sealed independent evaluation dataset. Synthetic video/audio objects contain descriptions, not real pixels or recordings. Scripted references currently focus on water delivery; they are not calibrated expert human baselines.

The repository is private. Dependencies, runs, credentials, generated archives, private evaluation data and development-agent instructions are ignored. Changing repository visibility later does not make those files safe to publish.
