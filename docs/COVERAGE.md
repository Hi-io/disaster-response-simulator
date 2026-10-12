# Implementation coverage and evidence

The design remains in `SIMULADOR.md`. This file distinguishes functioning software from field validity and from the separate NEXO implementation. Passing tests demonstrates modeled behavior, not clinical precision or a competition result.

## Acceptance matrix

| Phase                               | Implemented behavior                                                                                                                                                             | Executable evidence                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| F0 — Contracts                      | 26 versioned input kinds, 23 action types, units, permissions, idempotency and config validation                                                                                 | `core.test.mjs`, `laboratory.test.mjs`, `server.test.mjs`                                                            |
| F1 — Engine                         | Deterministic ordered event heap, independent keyed streams, recorded inputs, checkpoints, restore, fork and replay                                                              | `core.test.mjs`, `world.test.mjs`, `laboratory.test.mjs`, `archive-batch.test.mjs`                                   |
| F2 — Geography and operations       | Regional road graph, three scarce crossings, varied road profiles, congestion, real loading/travel/unloading, finite resources and composed facilities                           | `region-population.test.mjs`, `world.test.mjs`, `tasks.test.mjs`, `laboratory.test.mjs`                              |
| F3 — Disaster and communication     | Earthquake, aftershock, fire front, flood, access changes, channel outages, retries, queued orders, delayed GPS and stale-report handling                                        | `world.test.mjs`, `tasks.test.mjs`, `laboratory.test.mjs`                                                            |
| F4 — Sources                        | Fictional HTML network, paginated/searchable API, revisions, deletions, misinformation, scoped team audio, 360 presets and 30 families                                           | `server.test.mjs`, `adapters.test.mjs`, `extensions.test.mjs`, `archive-batch.test.mjs`                              |
| F5 — Observer                       | Isometric 3D, map layers, selection, search, truck follow, event history, three information streams, scoped views, checkpoint controls, synchronized A/B maps                    | Browser QA; backend access tests in `server.test.mjs`. Browser verification is separate from automated engine tests. |
| F6 — Actors and collective capacity | Human approval, finite review slots, evidence-backed conditions, owned stock, bilateral transfers, return trips, withdrawal, loans, finite funds and purchases                   | `tasks.test.mjs`, `laboratory.test.mjs`, `extensions.test.mjs`                                                       |
| F7 — Integration                    | Generic source client, real HTTP scrape, versioned ingestion receipts, quotas, outage/schema/revocation faults, external-computation timing with live/modeled clocks             | `adapters.test.mjs`, `server.test.mjs`, `integration-clock.test.mjs`, `extensions.test.mjs`                          |
| F8 — Evaluation                     | 24 runnable fixtures, standard/adverse/infeasible variants, physical service metrics, per-community outcomes, integrity checks, paired comparisons and loss-preserving intervals | `world.test.mjs`, `laboratory.test.mjs`, `integration-clock.test.mjs`                                                |
| F9 — Scaling                        | CLI, headless execution, isolated worker batches, budgets/cancellation/resume, compact disk archives, portable bundles and load benchmarks                                       | `archive-batch.test.mjs`; `scripts/benchmark.mjs --full`; `PERFORMANCE.md`                                           |
| Population extension                | Dynamic water/food consumption, recurrent requests, injuries/exposure, received aid, evacuations, simulated deaths and observed-vs-private health                                | `region-population.test.mjs`, `tasks.test.mjs`                                                                       |
| H1 — Optional precedent             | Evidence-backed outcome records with explicit conditions to revalidate; no autonomous learned policy                                                                             | `extensions.test.mjs`; S24                                                                                           |

## C1–C7: what the laboratory can test

| Capability                   | Implemented world mechanism                                                                                                             | What still comes from the external platform                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| C1 — Composed service        | Four owners' actual deliveries can open a shelter; compatibility, current assessment, finite feedstock and permission constrain a plant | Discovering and assembling that plan from unstructured sources        |
| C2 — Conditional commitments | Versioned owner reservations, inspection/approval/time/commitment conditions, expiry and conflict prevention                            | Negotiating and choosing a feasible set of commitments                |
| C3 — Value of investigating  | Queries and clarification have quotas, delays and finite personnel; unobserved needs can remain unmet                                   | Deciding which question is worth its opportunity cost                 |
| C4 — Competing demand        | 100 heterogeneous needs can compete for the same fleet, supplies and human reviewers                                                    | Joint prioritization and avoiding harm displaced to another community |
| C5 — Repairing a plan        | Changed routes, withdrawals, expired stock, unsafe sites and communication loss affect ongoing physical operations; sunk cost remains   | Selecting a revised plan while preserving still-valid work            |
| C6 — Human capacity          | Review queues, decisions, ownership, shift cycles and clarification remain distinct from physical execution                             | Reducing attention needed without hiding uncertainty                  |
| C7 — Partial cooperation     | Separate inventories, permissions, delayed sharing, partitions and a fifth partner without the platform                                 | Discovering collective opportunities while retaining local autonomy   |

## Current validation boundaries

1. **No Gemini is executed here.** A measured NEXO-vs-baseline result requires the external NEXO platform, recorded responses and the appropriate clock. Scripted references cannot establish a GenAI advantage.
2. **Clinical calibration remains open.** Mortality/exposure curves, injury treatment rate and susceptibility are explicit assumptions. Expert-reviewed ranges and sensitivity testing are required before interpreting their magnitude.
3. **Geography is procedural.** It includes consequential bottlenecks, but is not a reconstruction of a real city or Venezuelan disaster. Hazard spread is a zone/event model, not structural, fire or flood physics.
4. **Operational simplifications are recorded.** Crews are generic staff units; the simulator does not reproduce every profession, real permit process, drug supply chain, hospital workflow, warehouse operation or demographic subgroup.
5. **The reference policies are preliminary.** Their physical actions use the same world constraints, but they primarily handle water. They need independent operator/optimizer review before being called competent real-world baselines.
6. **Held-out variants are not secret worlds.** Reserving different text variants within 30 families prevents exact copy reuse, not all information leakage. Independent hidden seeds, authorship and unseen scenario combinations belong in a sealed evaluation service outside the evaluated platform's filesystem.
7. **Media is descriptive.** An audio/video description exercises information interpretation, not transcription or real visual perception. No claim of multimodal recognition should be based on it alone.
8. **Ingestion stages are platform acknowledgements.** The provided client performs real HTTP downloads; an accepted/interpreted receipt records what that client reports, not independent proof of internal comprehension.
9. **×1000 is requested speed.** Workload-dependent effective throughput, storage, export and inference latency are measured separately. The million-publication profile is a load test, not a default interactive workload.
10. **Scenario invariants are necessary but insufficient.** Every fixture running without conservation errors does not prove every external strategy, horizon, parameter interaction or scientific conclusion.

## Release verification

The current automated suite has 116 tests and zero skipped tests. `pnpm check` verifies syntax, contract/preset counts and tracked-file hygiene. Rerun both after changes. Per-test names explain the property under test; the files above provide their concrete setup and assertions.

`service-measurement.test.mjs` separately checks occupied shelter benefit and exact consumption: an empty operating shelter earns zero occupied place-hours, fifty occupants for one hour earn fifty place-hours, closure stops accumulation, and twenty-four hours of fifty occupants consume one hundred litres at the declared two-litre daily rate. This verifies arithmetic within the model, not a clinically validated intake requirement.

`service.test.mjs` verifies that the API-only backend advances without a browser or polling, preserves authentication and organization scope, hides observer UI assets, stops only when paused, and produces the same seeded results as the service with its optional viewer.

`activity.test.mjs` checks observer authentication, read-only methods, selected-team payloads, exact source/receipt/event content, retained archived history and English laboratory defaults. Repeated lightweight polling leaves the world hash unchanged.

`social.test.mjs` checks all 102 contextual bilingual wordings, separate content splits, quantity/unit fidelity, actual ambient diversity, stable author identities, exact seeded continuation, coherent personal/news media, retained repost lineage and misleading statements tied to real unmet demand or damage. Contextual wording augments the existing 360 situation presets; it is not credited as additional simulated physical capabilities.

`viewer.test.mjs` checks indexed and scoped source availability, receipt-version fidelity, actual delivery versus consultable sources, consolidation of connector stages, optional telemetry without duplicate GPS cards, meaningful observation changes, queue-pressure pacing, bounded visual queues, traffic colors without hidden-state leakage, confirmed curved paths, new departures, paused motion and GPS-only views. These are view-model checks; browser QA separately verifies the viewport layout, drawers, clickable cards, notifications, layer toggles, freeze/filter controls and responsive states. Animations do not execute Gemini or establish an operational advantage.

Browser QA covers the map, controls, selection, information streams, scoped perspectives and comparison surface. It does not substitute for headless causal tests. Measured scaling results and machine details are stored in `PERFORMANCE.md`; complete run artifacts stay under ignored `runs/`.

Before a claim of real humanitarian impact, add reviewed parameter manifests, recorded expert baseline behavior, untouched evaluation cases, external-platform traces, and statistical results that include failures. None of those can be supplied by inventing a favorable simulator score.
