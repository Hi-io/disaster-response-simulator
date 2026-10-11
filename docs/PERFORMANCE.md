# Measured simulator performance

These are measurements of this simulator, without Gemini or NEXO. They are not estimates of the future platform's inference speed or humanitarian impact.

## Recorded workload

Recorded **2026-10-11 16:40 UTC** (2026-10-12 in Japan) using the causal source build at Git revision `db2888e`. The complete configurations, state hashes, machine details and unrounded results are in [benchmarks/0.2.0.json](benchmarks/0.2.0.json).

- Engine: 0.2.0; source fingerprint `e9cea9cf4241afea97bcd8a3f625298e461643473e05fa5775de6b81fef30aff`.
- Machine: Windows 10.0.26200, Intel i5-10400 @ 2.90 GHz, 12 logical CPUs, 63.93 GiB RAM, Node 24.19.0.
- Each profile runs sequentially in a fresh worker, with disk-backed compact history. Other desktop/test activity can affect elapsed times.
- Effective speed = simulated milliseconds / execution milliseconds. Final hashing, bundle export, UI rendering and external inference are excluded from that speed.

| Profile                                      | Simulated duration |    Events | Created / published posts | Execution | Final hash | Effective speed | Worker heap, sampled peak |
| -------------------------------------------- | -----------------: | --------: | ------------------------: | --------: | ---------: | --------------: | ------------------------: |
| Unit · 2 km, 9 settlements                   |             30 min |       514 |                     4 / 4 |    0.26 s |     0.03 s |          ×6,888 |                  12.5 MiB |
| City · 15 km, 225 settlements                |                2 h |    49,907 |             8,076 / 8,076 |    5.38 s |     0.81 s |          ×1,338 |                  52.4 MiB |
| Region · 160 km, 1,225 settlements           |                4 h |   247,396 |           55,051 / 55,048 |   58.62 s |     4.02 s |            ×246 |                 141.7 MiB |
| Default earthquake · 160 km, 625 settlements |               48 h | 1,282,172 |           12,493 / 12,427 |  159.38 s |    13.70 s |          ×1,084 |                 213.8 MiB |
| Information · 10,000 posts                   |                1 h |    32,652 |           10,000 / 10,000 |    2.52 s |     0.90 s |          ×1,428 |                  43.8 MiB |
| Information · 100,000 posts                  |                1 h |   324,972 |         100,000 / 100,000 |   31.29 s |     6.40 s |            ×115 |                 125.1 MiB |
| Information · 1,000,000 posts                |                1 h | 3,249,491 |     1,000,000 / 1,000,000 |  422.84 s |    76.55 s |           ×8.51 |                 147.0 MiB |

Every recorded profile completed without a ledger-invariant violation. That checks conservation and modeled milestones; it does not validate every possible strategy or establish scientific realism.

## Interpret the figures correctly

The default 48-hour world completed in about **2 minutes 39 seconds**, plus about 14 seconds to fingerprint its final state. A much denser information workload is slower: one million published posts took about **7 minutes 3 seconds**, plus about 77 seconds for hashing. Requesting ×1000 does not force that throughput.

The information profiles isolate source generation on a small map, with no reference policy, traffic or recurrent health reports. A million-post test therefore demonstrates archival/source capacity, not a million active rescue decisions or a realistic posting rate during one hour of a disaster.

RSS is process-wide because the runner uses worker threads. The sampled RSS peaks range from 76.6 to 466.7 MiB across these profiles; they include the parent and possibly retained allocations from earlier workers. They must not be described as isolated per-world memory. Worker heap is separate but also sampled between event chunks, so short allocation spikes can be missed.

Compact logs are authoritative on disk. The observer draws a limited window and does not send a million cards to the browser. SQLite archive files grow with the history: bounded UI/heap is not bounded total storage. Final hashing and export deliberately visit the recorded history and need additional time and disk space. The benchmark does not include a complete bundle export.

## Repeat or scale an experiment

```sh
pnpm benchmark          # unit, city, region, default 48h and 10k information
pnpm benchmark --full   # also 100k and 1m information; allow several minutes
```

The new report is written to ignored `runs/benchmarks/latest.json`. To reproduce an old state hash, use its recorded source build and configuration, not merely the same seed on a changed engine. This report precedes a fix that makes A/B observer snapshots atomic; that fix changes the source fingerprint without changing the physical workload measured here.

For iteration:

1. Start with the hand-verifiable unit manifest; confirm real receipt, service and conservation.
2. Increase region size, traffic, posting volume, loss and communication delay independently. Keep the full manifest with each result.
3. Run paired seeds with equal resources, parameter ranges and operator budgets. Retain failed and losing episodes.
4. Keep worker count bounded (`--workers`, default 2). Memory limits apply to each worker, not the entire machine.
5. Use wall-time budgets/cancellation for long batches. Cancelled artifacts remain marked as such; resume only reuses completed episodes with matching source builds and configurations.
6. Measure HTTP scraping, external computation, review queues and real platform costs separately. Modeled and live clocks answer different questions.

The isometric observer is for inspection and demonstration. Headless throughput is independent of camera movement and browser FPS. A local desktop benchmark is neither a Cloud deployment benchmark nor a guarantee of performance on another machine.
