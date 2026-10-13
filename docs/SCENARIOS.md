# AidScaler scenario catalogue

Scenarios create fictional situations for testing response workflows. They specify constraints and events, not a preferred solution. Combine them with a seed, map configuration, disaster and controller.

## Available scenarios

| ID | Situation |
|---|---|
| S01 | Two deliveries and a planned empty return trip |
| S02 | A candidate shelter needs assessment, supplies, staff and power |
| S03 | A water plant lacks compatible power and operational dependencies |
| S04 | Old media is presented as current evidence |
| S05 | Advancing fire threatens an evacuation window |
| S06 | An aftershock changes a shelter's condition |
| S07 | A community needs help without a social report |
| S08 | Reposts repeat a single original claim |
| S09 | A finite fleet faces simultaneous heterogeneous requests |
| S10 | A network partition outlasts commitments |
| S11 | A partner withdraws after work begins |
| S12 | A reroute is sent to a disconnected driver |
| S13 | Reconnection releases a backlog of reports |
| S14 | A shipment arrives but needs receiving or unloading capacity |
| S15 | One location is oversupplied while another remains underserved |
| S16 | A publication attempts to override the agent's authority |
| S17 | A required tool becomes unavailable |
| S18 | Available resources cannot complete every plan |
| S19 | Independent organizations contribute to a shared service |
| S20 | Funding, purchase, partial receipt and public reporting have distinct stages |
| S21 | A source is edited or deleted |
| S22 | A report has ambiguous quantities or locations |
| S23 | A conventional controller already has sufficient information |
| S24 | A recorded precedent has incompatible conditions |

S19 defaults to five organizations unless the configuration specifies another count. Organizations keep separate depots, permissions and received knowledge.

## Configuration and variants

Select a scenario in the viewer or use the CLI:

~~~sh
node cli.mjs run --scenario S12 --seed outage-01 --policy none --output runs/outage-01
~~~

Use a manifest for more detailed parameters. The standard variant provides the base fixture; adverse adds demand changes and a road disruption; infeasible reduces available water and tightens the main deadline. These are reusable stress conditions, not reconstructions of historical disasters.

## What to inspect

- **Information:** compare the event, accessible publication and actual received report. A repeated or recent post is not automatically independent evidence.
- **Transport:** inspect authorized and received instructions, pickup, travel, blocking, unloading and useful receipt. A reroute preserves the existing mission and cargo.
- **Facilities:** verify competent safety assessment, permission and compatible dependencies physically on site. Shelter service requires people to arrive; a plant needs feedstock and finite operating resources.
- **Cooperation:** inspect owner approvals, transfer receipts, reservations, expiry, revocation and retained costs.
- **Coverage and attention:** inspect silent locations, verification requests and finite read/decide/relay queues.
- **Failure:** keep unmet demand, incomplete work and source or communication failures visible.

The observer can inject road closures, outages and other supported interventions. Organization tools learn about changes through received reports or physical encounters. For comparisons, keep the initial resources and declared conditions consistent.

See [API.md](API.md) for integration and [CALIBRATION.md](CALIBRATION.md) for interpretation.
