# Geography and map provenance

[Overview](../README.md) · [Scenarios](SCENARIOS.md) · [Models and measurement](CALIBRATION.md)

The simulator supports small inspectable fixtures, procedural regions and city-scale mapped road networks. Geography, synthetic communities and operational state are separate layers.

## Choose a world

| Topology             | Use                                                                           |
| -------------------- | ----------------------------------------------------------------------------- |
| **Grid**             | Small fixtures for inspecting a response step by step.                        |
| **Regional**         | Procedural regions with configurable extent, road networks and bridges.       |
| **Honmura, Japan**   | A curated town-core road layout at approximately one-kilometre scale.         |
| **Takamatsu, Japan** | A mapped 10 × 10 km region with 4,300 synthetic community and facility sites. |

Select the topology in World configuration or a manifest. Seeds control synthetic events and site details; the mapped road fixtures retain their geographic layout.

## Takamatsu

The bundled 100 km² fixture retains strategic road connectivity, mapped junctions, curved polylines and one-way streets. Its geographic database is loaded from a pinned offline extract with a verified SHA-256 fingerprint.

- [Generator and provenance](../generators/takamatsu.mjs)
- [Bundled road database](../generators/data/takamatsu-roads-v1.json.gz)
- [City-scale manifest](../manifests/takamatsu.json)

```sh
node cli.mjs run --config manifests/takamatsu.json --output runs/takamatsu
```

The 4,300 sites represent synthetic communities and facility opportunities. Population, responder locations, building uses, supplies, traffic assumptions and disasters are scenario data placed on the mapped road network.

## Honmura

The curated town-core fixture contains **43 junctions** and **56 two-way road segments**, represented as 112 directed edges. It preserves mapped junction connectivity and curved geometry, including the port approach and Prefectural Route 256.

Coordinates use a local metre projection. The fixture records original OpenStreetMap node/way IDs, retrieval date, source URL and a snapshot fingerprint in [`generators/honmura.mjs`](../generators/honmura.mjs).

Sources: [Honmura in OpenStreetMap](https://www.openstreetmap.org/#map=17/34.4605/133.9975) and [Naoshima's official access map](https://naoshima.net/en/access-en/access_from/).

## Reproducible geography

Bundled maps require no live tiles or third-party routing service during a run. The engine can reuse the same geographic graph while varying needs, organizations, hazards, traffic or communications.

Road profiles, capacities, speed assumptions and operational restrictions are declared simulation inputs. The maps provide geographic structure for experiments; live emergency navigation requires current operational information.

## Attribution

The geographic fixtures are adapted databases **© OpenStreetMap contributors**, available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Attribution is also visible in the viewer.

Source provenance accompanies the generator files and bundled data. Retain that attribution when distributing the geographic fixtures or images of their maps.
