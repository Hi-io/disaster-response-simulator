# AidScaler simulation assumptions

This simulator models operational interactions under declared parameters. The 3D view helps inspect those interactions; visual detail is not evidence of physical or behavioral accuracy.

## Physical and information models

Supplies, reservations, ownership, capacity, qualifications, calendars and physical receipts are explicit constraints. Travel uses procedural road geometry, speed limits, traffic capacity, queues and fuel. Command delivery, publication, indexing and verification have separate times.

Organization knowledge consists of received observations. A report can be old, incomplete, mistaken or repeated. Synthetic media descriptions exercise information workflows; they do not evaluate transcription or image recognition on real bytes.

These models are useful for testing causal behavior. Road, communication, reporting and operational parameters should be compared with relevant field data before claiming realistic performance.

## Human attention

Human attention profiles declare finite read, decide and relay pools. Moderate uses default task durations of 30, 60 and 90 seconds; burst adds background work. Advanced configuration controls pool sizes, durations, background rates and error probabilities. Zero preserves the legacy review scheduling when no positive overrides activate the model.

The pools represent attention capacity and need not represent distinct people. Completed work, queue waiting and communication waiting are separate quantities. Reviews use the decision pool, and a completed read does not authorize a physical action.

These durations and error rates are hypotheses rather than measurements of emergency operators. Keep the profile, overrides and controller workflow with the run. Choosing an attention profile does not turn a scripted policy into a manual workflow or an AI integration.

## Population and units

The population model tracks cohort stores and exposure. Delivered aid replenishes stores; shortages can accumulate and affect modeled health outcomes. Intake, grace periods, vulnerability and risk rates are configurable assumptions, not clinical predictions or a validated estimate of lives saved.

| Quantity | Unit and interpretation |
|---|---|
| Time | Simulated milliseconds; divide by 60,000 for minutes |
| Distance | Metres |
| Water | Litres; the population model converts to millilitres |
| Food | Abstract portions; the population model assumes 700 kcal per portion |
| Blankets | Individual items |
| Staff | People, with anonymous skill profiles and availability |
| Vehicle fuel | Millilitres |
| Finance | Sandbox credits |
| Unmet demand integral | Resource unit × time, such as litre·minutes or portion·minutes |
| Attention work / queue waiting | Person-time, reported separately |
| Shelter service | Occupied place-hours, after physical admission |

Sufficient-service time runs from the need's response start to enough physically received aid. First useful service can occur earlier with a partial delivery. Report unmet or censored cases with the timing statistics.

The unmet-demand integral accumulates the missing quantity over time: 20 portions missing for 10 minutes produce 200 portion·minutes. Resource units remain separate. Delivered quantities do not establish a count of unique people or families fed, sheltered or protected.

## Reproducibility and comparison

Keep the complete manifest, engine build, seed, recorded inputs, timing policy and controller configuration. Exact replay depends on those inputs; a new external model response is not guaranteed to repeat.

Use the same physical starting resources and access rules for compared controllers. Record communication failures, field checks, owner reviews, model latency and costs. Preserve unsuccessful, censored and partially served cases. Distinguish simulated physical response from host execution speed and rendering performance.

Vary the assumptions that could explain a result: workload, worker capacity, task duration, connectivity, stock, route restrictions and model timing. A gain under one configuration is a result for that configuration; extrapolation requires broader validation.

See [SCENARIOS.md](SCENARIOS.md) and [API.md](API.md).
