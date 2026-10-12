# Scenario catalogue and inspection guide

Fixtures create situations; they do not encode a winning NEXO response. Use the observer to inspect truth, the source gateway to see available reports and an organization view to see received knowledge. The same scenario can be combined with any supported disaster, procedural region, seed and reference policy.

## Selectable fixtures

| ID | Situation | Inspect / measure |
|---|---|---|
| S01 | Two deliveries and an implicit empty return trip | Inventory, vehicle availability, driver turn, permission, departure and actual receipt |
| S02 | A potential shelter needs multiple dependencies | Safety assessment, water, sanitation, staff, compatible power, permission and usable places |
| S03 | An intact water plant lacks suitable power | Connector/power compatibility, actual equipment arrival, feedstock and finite production |
| S04 | Old media is presented as current disaster evidence | Publication/source chronology, correction and mistaken confirmation |
| S05 | Advancing fire threatens an evacuation window | Exposure, access changes, instruction delay and people reaching a safe destination |
| S06 | An aftershock changes a shelter's condition | Assessment version, revoked safety, ongoing travel and revised destination |
| S07 | A community has urgent need but no social report | Unobserved need, field/radio verification, coverage and missed service |
| S08 | Many posts copy a single original claim | 30 distinct reposts, provenance, false independence and duplicate demand |
| S09 | A fleet faces 100 simultaneous heterogeneous requests | Water, food, shelter, blankets and rescue contexts; competition for stock, fleet and attention |
| S10 | A network partition outlasts commitments | TTL, communication queues, ownership and reservation expiry |
| S11 | A partner withdraws after work begins | Invalidated dependency, remaining physical cargo and sunk cost |
| S12 | A reroute is sent to a disconnected driver | Authorized time vs received time, old route, last GPS and actual position |
| S13 | Reconnection releases delayed reports | Queue bursts, stale timestamps and newer observations staying authoritative |
| S14 | A vehicle arrives before useful service is possible | Receiving/unloading capacity, setup, actual receipt and unmet demand |
| S15 | Deliveries oversupply one place while another lacks help | In-transit quantities, minimum reserves, excess by resource type and uncovered demand |
| S16 | Source content tries to override authority | Prompt-injection-like publications; agent permissions and private data staying inaccessible |
| S17 | A required tool becomes unavailable | 503, pending work, fallback costs and restoration |
| S18 | The available resources cannot complete every plan | Explicit infeasibility, partial service, abstention and bounded investigation |
| S19 | Four independent organizations and a fifth partner | Distinct depots, partial sharing, divided equipment/staff/sanitation, actual transfers and joint service |
| S20 | Donated money and help have distinct stages | Pledge, settlement/failure, purchase, delivery, receipt and public aggregate update |
| S21 | A source is changed or deleted | Versioned reads, missing permalink, old receipt retention and connector adaptation |
| S22 | A report contains ambiguous place/quantity information | Clarification cost, unit/location uncertainty and unsupported assumptions |
| S23 | Conventional coordination can already solve the request | A negative control: investigation may add overhead and must not be forced to win |
| S24 | A precedent has incompatible conditions | Optional recorded evidence, current connector verification and negative transfer |

The initial need is a finite request at a candidate shelter; its reported population now follows its sector population. Scenario requests are not automatically human observations. S19 defaults to five organizations unless an explicit organization count overrides it. The fifth partner has `usesPlatform: false` and a distinct base.

## Variants

- **standard:** baseline fixture.
- **adverse:** additional demand change and an unexpected road obstruction. Communication and physical consequences follow the normal engine.
- **infeasible:** removes available water and shortens the main deadline. An honest partial response is better than inventing stock.

These are reusable stress transforms, not 72 independently calibrated historical disasters. Build a sealed evaluation set with new combinations, timings, seeds and source wording before optimizing a candidate against them.

## Useful experiments

### A consequential bridge closure

Use regional topology, default extent 160 km, no hazard initially and three crossings. Inspect the central crossing. In the deterministic default test, closing its two directed edges changes the free-flow route between its banks from roughly 15 minutes to over eight hours. Traffic, fuel, shifts and order delay add further effects; this is not a universal promise for every seed.

The observer can inject:

```json
{ "type": "road_change", "data": { "edge": "COPY_EDGE_ID_FROM_MAP", "open": false, "reason": "bridge_damage" } }
```

The engine closes both directions of a crossing. A field observation or available report must reach an organization before its tools know the closure. A truck following outdated information can encounter the obstruction physically. Close all crossings to test isolation. Bridge repairs require explicit engineering authority, an available crew, access and elapsed work; they reopen both directions.

### Deterioration versus timely service

Advance the default world through 6, 12, 24 and 48 simulated hours. Inspect affected cohorts: water/food stores, deficit durations, injuries, exposure and simulated deaths. Use matched clones to deliver actual water earlier in one run and leave it pending in the other. Change grace/risk parameters through Advanced JSON for sensitivity; never change one candidate's starting population or resources to make it win.

After a request is fulfilled, population consumption continues. When stores cannot last to the next resupply review, another request may be generated. The new request follows source/report delay; it is not instantly inserted into actor knowledge. A silent community can remain undiscovered.

### Delayed instructions and connectivity

Dispatch a real shipment. Cut the driver's sector connectivity, then authorize a reroute. Inspect `reroute_authorized`, the queued message, the actual truck route and `reroute_received` after restoration. No teleportation or retroactive instruction is allowed. Compare radio and internet field reports under an outage.

### Collective service

Select S19. Use a current assessment and the permissions of each owner. Deliver compatible equipment, water, sanitation and staff to the same site; only then activate it. Inspect the physical deliveries and their owner records. The scenario also includes a reported fifty-person shelter need: people must be evacuated in finite vehicle trips and physically arrive before occupied place-hours accumulate. Opening an empty facility is not useful shelter service. The automated laboratory test performs this sequence with four independent owners; a separate NEXO episode is needed to measure an actual model's contribution.

### Actual ingestion

Open the fictional network on port 4319. Connect the source client with one actor key and download its available feed; mark selected items accepted/interpreted or discarded. The observer's third stream reflects those real requests and submitted receipts. Publication count and ingestion count must not be conflated.

### Large-volume and repeatability checks

Use compact mode and headless execution for 100k–1m records. Keep the observer window bounded and inspect exact totals in metrics. Replay the saved checkpoint bundle and verify the state hash. Run policy pairs with identical manifests and seeds. Repeatability applies to identical inputs, not to a newly generated external model answer.

All maps are fictional. Neither an earthquake fixture nor its casualty curve reconstructs a particular real disaster.
