# Scenario catalogue

[Overview](../README.md) · [Impact evaluation](EVALUATION.md) · [API](API.md)

**24 situations that exercise the gap between recognizing a need and completing a response.**

Each scenario creates a fictional operational situation with explicit constraints and events. A response controller chooses its own actions. Combine the scenario with a seed, topology, hazard, workload and response policy.

## Discover and verify

| ID  | Situation                                      | Capability to examine                                                 |
| --- | ---------------------------------------------- | --------------------------------------------------------------------- |
| S01 | Two deliveries and a planned empty return trip | Discover usable capacity and check its timing, load and permission.   |
| S04 | Old media is presented as current evidence     | Recover context and investigate current need using dated evidence.    |
| S07 | A community needs help without a social report | Reach quiet locations through coverage checks and field assessment.   |
| S08 | Reposts repeat one original claim              | Connect related reports while retaining distinct evidence and demand. |
| S21 | A source is edited or deleted                  | Carry source versions into the investigation and dependent proposals. |
| S22 | A report has ambiguous quantities or locations | Obtain clarification before committing resources.                     |

## Make a response physically feasible

| ID  | Situation                                                       | Capability to examine                                                 |
| --- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| S02 | A candidate shelter needs assessment, supplies, staff and power | Assemble the dependencies of an operating service.                    |
| S03 | A water plant lacks compatible power                            | Coordinate equipment, permission, installation and production inputs. |
| S09 | A finite fleet faces simultaneous requests                      | Respect stock, vehicle capacity, scheduling and review queues.        |
| S14 | A shipment arrives before receiving capacity is ready           | Complete unloading and useful receipt after arrival.                  |
| S15 | Supplies are unevenly distributed                               | Account for outstanding demand, incoming shipments and reserves.      |
| S18 | Available resources cannot complete every plan                  | Deliver useful partial responses and make remaining demand visible.   |

## Adapt as conditions change

| ID  | Situation                                     | Capability to examine                                                           |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| S05 | Advancing fire threatens an evacuation window | Respond to changing access and instruction-delivery time.                       |
| S06 | An aftershock changes a shelter's condition   | Reassess affected dependencies before service continues.                        |
| S10 | A network partition outlasts commitments      | Preserve resource ownership and handle reservation expiry.                      |
| S11 | A partner withdraws after work begins         | Repair affected steps while preserving valid work and recorded costs.           |
| S12 | A reroute is sent to a disconnected driver    | Distinguish a sent instruction from a received instruction and actual movement. |
| S13 | Reconnection releases a backlog               | Interpret delayed observations with their original times.                       |
| S17 | A required tool becomes unavailable           | Continue through available sources while preserving commitments.                |

## Coordinate and account for the result

| ID  | Situation                                                      | Capability to examine                                                    |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| S16 | A publication attempts to override an agent's authority        | Keep external evidence separate from permissions and action authority.   |
| S19 | Independent organizations contribute to one service            | Combine capabilities with separate owner approval and physical receipts. |
| S20 | Funding, purchase and partial receipt occur at different times | Keep financial records, physical supply and public progress connected.   |
| S23 | A conventional controller has sufficient information           | Compare workflows in a case with a strong conventional reference.        |
| S24 | A precedent has incompatible conditions                        | Check whether a previous response pattern fits the current case.         |

S19 defaults to five organizations unless configured otherwise. Each organization keeps its own depots, permissions and received knowledge. S24 covers the optional precedent-transfer workflow.

## A useful walkthrough

For a short tour, start with **S01** to inspect hidden transport capacity, **S19** for joint organizational capability, **S12** for delayed instructions and **S14** to follow arrival through useful receipt.

Follow the same sequence in each case:

1. Inspect the initial world and resources.
2. Compare what happens, what gets published and what the organization receives.
3. Observe the connected platform's investigation and authorized actions.
4. Follow the vehicle, transfer or service through completion.
5. Inspect timing, resource use and outstanding demand.

## Configuration and variants

Choose a scenario in the viewer or use the CLI:

```sh
node cli.mjs run --scenario S12 --seed outage-01 --policy none --output runs/outage-01
```

Use a manifest for detailed parameters. The `standard` variant supplies the base fixture; `adverse` adds demand changes and a road disruption; `infeasible` reduces water availability and tightens the main deadline.

The observer can inject supported interventions such as road closures or connectivity outages. Organizations learn about those changes through received reports or physical encounters.

For a paired evaluation, keep initial resources and declared conditions consistent. See [Impact evaluation](EVALUATION.md) for the workflow and [Models and measurement](CALIBRATION.md) for units and interpretation.
