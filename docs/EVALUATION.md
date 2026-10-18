# Evaluate response impact

[Overview](../README.md) · [Scenarios](SCENARIOS.md) · [API](API.md) · [Models and measurement](CALIBRATION.md)

The simulator connects decisions to their consequences. An action consumes resources, moves through communication and approval steps, enters a physical operation and eventually produces a receipt or service outcome.

That makes it possible to ask a concrete question: **with the same needs and resources, does a different response workflow get useful help to people sooner?**

## The AidScaler + Gemini comparison

The recorded 18 October 2026 study compares conventional response with AidScaler using **Gemini 3.8 Flash on Vertex AI**.

| Outcome                           |   Conventional | AidScaler + Gemini |                     Reduction |
| --------------------------------- | -------------: | -----------------: | ----------------------------: |
| Average time until sufficient aid |      45.22 min |          33.98 min |                    **24.85%** |
| Average time until authorization  |      28.60 min |          18.92 min |                    **33.84%** |
| Modeled human coordination work   | 263 person-min |      16 person-min |                    **93.92%** |
| Fully served needs                |        24 / 24 |            24 / 24 | Full coverage in both methods |

The food-response subset served eight needs in **19.30 minutes on average**, compared with **46.85 minutes** conventionally: **58.81% less waiting**, with the same 173 portions delivered.

The comparison used a fixed seed on Takamatsu's 10 × 10 km mapped road network: four organizations, 24 needs, 192 distractors, two reposts, a 30-minute formal-report delay and a three-hour horizon. Corpus, fleet, supplies, permissions and human-work parameters were matched. Model requests were sent to the live Vertex AI provider.

The platform repository maintains the canonical [benchmark report](https://github.com/Hi-io/aidscaler-platform/blob/main/docs/BENCHMARK.md) and [machine-readable result extract](https://github.com/Hi-io/aidscaler-platform/blob/main/docs/assets/gemini-benchmark.json), including unrounded values and source hashes.

## Separate truth, information and action

| Layer                                 | Owned by                                   | Evaluation purpose                                                        |
| ------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| World state                           | Simulator                                  | Establish when needs appear and what physically occurs.                   |
| Publications and communications       | Simulator                                  | Model how observations become available through public or team channels.  |
| Received knowledge                    | Organization-scoped gateway                | Establish what information a responder could use at a given time.         |
| Interpretation and response decisions | Connected platform or reference controller | Choose which evidence to investigate and which actions to propose.        |
| Authorization                         | Authenticated resource owner               | Commit the exact resources and actions that owner controls.               |
| Execution and service                 | Simulator                                  | Apply physical constraints and record travel, receipt and useful service. |

The observer can inspect the experiment; a connected agent receives its own authorized information. Information collection, interpretation, approval and physical service each have their own recorded stage.

## What can be measured

The [metric engine](../evaluation/metrics.mjs) derives outcomes from the authoritative world and event history.

| Measurement                | What it explains                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| **First useful aid**       | Time until a positive physical contribution reaches an outstanding need.                  |
| **Sufficient aid**         | Time until enough aid has been physically received to cover that need.                    |
| **Coverage and deadlines** | Fully served, partially served, pending and on-time needs.                                |
| **Unmet demand over time** | How much of each resource remains missing, and for how long.                              |
| **Information flow**       | Publication and ingestion stages, source versions and download latency.                   |
| **Human attention**        | Reading, decision and relay work; queue waiting, backlog and staff utilization.           |
| **Transport**              | Travel distance, fuel, blocked operations and vehicle utilization.                        |
| **Resource integrity**     | Inventory, reservations, ownership, transferred quantities and invariant checks.          |
| **Facilities and service** | Admission, occupied shelter place-hours, qualified staffing and operational dependencies. |
| **Population exposure**    | Modeled water/food deficits, injury and exposure under the declared cohort parameters.    |

The AidScaler benchmark's report combines these records with the platform's response traces to produce its authorization, coordination and sufficient-aid measurements. [Metric definitions and units](CALIBRATION.md) explain how to interpret them.

## Design a paired comparison

1. **Choose the question.** For example, earlier discovery, lower coordination effort, joint resource use or recovery after a road change.
2. **Fix the world.** Record the engine build, seed, map, scenario, demand, resources and permissions.
3. **Fix information and time rules.** Keep source conditions, communication delays, human attention and model-result availability explicit.
4. **Run each response method.** Give each the same physical starting point and declared access rules.
5. **Follow the complete response.** Preserve authorizations, movement, unloading and physical receipts.
6. **Compare outcomes.** Report service and coverage together; keep partially served and pending needs in the result.
7. **Replay and vary.** Replay the recorded inputs, then test additional seeds or change a declared parameter to explore its effect.

The live interactive demonstration uses recurring incidents and participant contributions. Fixed-horizon experiments use their own saved configurations and run artifacts.

## Run a small experiment

The bundled unit manifest is a compact starting point:

```sh
node cli.mjs run --config manifests/unit.json --seed example-01 --output runs/example-01
node cli.mjs replay --checkpoint runs/example-01/checkpoint.json.gz
node cli.mjs export --checkpoint runs/example-01/checkpoint.json.gz --output runs/export
```

The replay command checks the final state hash. Export produces metric JSON and per-community CSVs.

A batch compares scripted reference policies across the same seeds:

```sh
node cli.mjs batch --config manifests/unit.json --seeds example-01,example-02 --policies conventional,rules --workers 2 --output runs/comparison
```

The CLI also supports `fork` with a checkpoint and a new recorded-input file, plus `compare` for matching batch result arrays. See [`cli.mjs`](../cli.mjs) and [paired-comparison checks](../evaluation/runs.mjs).

## Connect AidScaler

Use the [platform development guide](https://github.com/Hi-io/aidscaler-platform/blob/main/docs/LOCAL.md) to start the connected laboratory. The platform consumes the simulator's public sources and organization-scoped gateway, runs model inference, prepares responses and records approved actions.

For recorded model execution, `/api/actor/model/start` and `/api/actor/model/finish` establish request timing and result availability. The simulator owns the clock; the platform owns its inference and decisions.

Built-in policies such as `conventional`, `rules` and `federated` are scripted reference controllers. The Gemini evaluation is implemented in the connected AidScaler platform, using [its evaluation harness](https://github.com/Hi-io/aidscaler-platform/tree/main/evaluation).

## Preserve the experiment

Keep the whole run directory:

| Artifact                 | Purpose                                                             |
| ------------------------ | ------------------------------------------------------------------- |
| `manifest.json`          | Configuration and build provenance.                                 |
| `inputs.json`            | Recorded external actions, interventions and model timing receipts. |
| `metrics.json`           | Measured outcomes, run hash and completion state.                   |
| `checkpoint.json.gz`     | Reproducible world state and history references.                    |
| `events.ndjson.gz`       | Exported authoritative event history.                               |
| Referenced archive files | Full compact history used by checkpoints and replay.                |

Exact replay uses the same build, configuration and recorded inputs. A new external model call produces a new input; replay uses the saved receipt.

## Inspect the implementation

- [World engine](../engine/world.mjs) and [determinism](../engine/determinism.mjs).
- [Run, replay and comparison](../evaluation/runs.mjs).
- [Parallel batches](../evaluation/batch.mjs).
- [Human-work model](../engine/human-capacity.mjs).
- [Metrics and their rules](../evaluation/metrics.mjs).
- [Evaluation acceptance tests](../tests/evaluation-acceptance.test.mjs), [physical service tests](../tests/service-measurement.test.mjs) and [response-time tests](../tests/response-time.test.mjs).
