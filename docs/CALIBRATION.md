# Causal assumptions and calibration

The laboratory must not become an oracle that gives NEXO favorable answers. Every result is conditional on a versioned world, resource budget, information model, inputs and explicit assumptions. Graphics provide inspection, not realism evidence.

## Population outcomes

`engine/population.mjs` uses cohort stores and exposure durations. Water and food are consumed only in disrupted affected populations; received aid replenishes actual stores. Deprivation accumulates when intake is unmet. Vulnerability is a seeded factor, not an individually calibrated clinical profile.

For a risk cause beyond its grace duration, the additional deterministic expected loss uses `1 − exp(−rate × exposed_time × vulnerability × intensity)`. Fractional expected losses carry across ticks; integer losses are bounded by living exposed people. Causes are applied sequentially, so no person is counted dead twice. People remain conserved across living, in-transit, relocated and deceased cohorts.

**These rates are experimental. They are not survival probabilities established by clinical research.** Changing a need deadline changes timeliness metrics, not mortality. Different causes have different grace periods; there is no universal “fourth day” cutoff. Simulated deaths can occur during delays, including evacuation, and are counted without exposing private health to the platform.

| Parameter | Default | Interpretation / status |
|---|---:|---|
| `healthTickMs` | 600000 | 10-minute integration step; test convergence before interpreting small differences |
| `waterMlPerPersonDay` | 3000 | Drinking/intake proxy; not total WASH demand |
| `foodKcalPerPersonDay` | 2100 | Energy-demand proxy; nutritional composition is not modeled |
| `initialWaterHours` / `initialFoodHours` | 6 / 12 | Synthetic starting stores, not universal household reserves |
| `waterCriticalHours` / `foodCriticalHours` | 30 / 72 | Hypothetical grace durations after unmet intake accumulates |
| `injuryCriticalHours` / `exposureCriticalHours` | 2 / 4 | Hypothetical risk thresholds, not clinical triage rules |
| `waterFatalityBpPerHour` | 150 | Experimental water-risk intensity; 150 basis points = 0.015/h before modifiers |
| `foodFatalityBpPerHour` | 25 | Experimental food-risk intensity |
| `injuryFatalityBpPerHour` | 1000 | Experimental injury-risk intensity |
| `exposureFatalityBpPerHour` | 600 | Experimental exposure-risk intensity |
| `injuryFractionBp` | 1500 | Fraction injured at highest modeled damage severity |
| `temperatureC` | 24 | Single scenario temperature; cold/heat raises exposure intensity outside toy comfort bands |
| `resupplyReviewHours` / `resupplyHorizonHours` | 6 / 24 | Recheck stores every 6h, request up to another 24h if supplies will not last |
| `healthReports` / `recurringNeeds` | true / true | Reports still incur connection/source delay; silent populations need active observation |

Water intake context is informed by the [Sphere Handbook](https://spherestandards.org/handbook-2018/): survival intake differs from the household standard covering drinking, cooking and hygiene. The latter is commonly at least 15 litres/person/day; using 3 litres here does **not** claim full WASH service. The same handbook uses 2,100 kcal/person/day as a baseline food-energy planning quantity. These standards do not provide the simulator's fatality rates or universal survival times. See the [official interactive water standard](https://interactive.spherestandards.org/) and [food-energy guidance](https://handbook.spherestandards.org/?chapter=all&contentType=all&handbook=all&lang=en&search=adequate+daily+food+needs&sort=relevance).

One simulated food portion contributes 700 kcal; adequate micronutrients, age-specific nutrition, contaminated water, infectious disease, medical treatment and real injury categories remain outside this model. Generic available staff provide simplified local care at four patients/staff-hour. Blankets/shelter lower exposure according to the modeled condition. Neither behavior is a medical effectiveness claim.

## Operational assumptions

- Regional roads use irregular spatial candidates, a connected backbone on each river bank, limited redundancy and a few bridges. Topology, road class and physical travel time are generated independently of a candidate's desired outcome.
- Each direction has finite capacity/storage and entry headway. Congestion/spillback changes physical arrival. Opposing-direction collision physics, individual driver behavior and detailed traffic signals are simplified.
- Vehicle gross weight, fuel and driver-shift limits are enforced. A field assessment, repair or evacuation occupies actual resources. A driver relay/refuel requires a declared intervention and appropriate physical location/stock.
- Facilities require owner permission and a current received safe assessment. Generator compatibility, feedstock and runtime constrain actual output. Generator runtime conversion is synthetic, not an engineering fuel-consumption curve.
- Operator review has finite slots, cost and shifts. Generic crews and medical staffing are simplified; professional certifications are not comprehensively modeled.
- Communication includes finite outbox, bandwidth, latency, retries, packet loss, channel access and stale versions. Phone-battery fields exist, but a detailed per-app battery/radio propagation model is not implemented.
- Earthquake damage, aftershocks, fire front and flood interactions are event/zone rules. They are not seismology, structural collapse physics, computational fluid dynamics or a wildfire forecasting model.

## Information assumptions

Separate physical reality, a person's observation, composition, transmission, indexing, download and a platform's reported interpretation. A publication is not a fact merely because it is recent or repeated. Distinct copies can have one original source. Ambiguity and unverified claims remain explicit.

Descriptions of synthetic media do not test real transcription or image recognition. The 360 text presets vary semantically within 30 families, but source timing, wording and causal preconditions still need review by practitioners. Do not infer a accuracy score from unverified ambient posts. The evaluator counts specific confirmed-false, incorrect rejection and false-merge events against private labels.

## Required sensitivity experiments

1. **Freeze a base manifest and policies first.** Use paired subsystem seeds so changed controllers do not receive easier worlds.
2. **Vary operational inputs independently:** extent, sparse bridges, road speed/capacity, traffic, stock/floors, human review delay, travel/setup time, network latency/loss, source frequency, false-report fraction and observation probability.
3. **Vary health assumptions:** no casualty model, half/double risk intensities, longer/shorter grace periods, starting stores, temperature and tick size. Report unmet person-hours alongside simulated fatalities so conclusions do not depend on one mortality curve.
4. **Vary information access:** silent communities, delayed videos, conflicting reports, partial sharing, nonparticipating partner, source outage/schema changes and expired knowledge.
5. **Vary external computation assumptions separately:** live ×1 measured wall latency vs modeled latency distributions. A ×1000 headless run cannot turn a real model's 10-second inference into free simulated time.
6. **Keep losing cases.** Include S23, infeasible cases and negative transfer. Show paired uncertainty and per-community harm, not only the aggregate winner.
7. **Review realism externally.** Ask emergency logistics and humanitarian operators to check feasible resource/service chains and ranges. Ask qualified specialists to review health assumptions before making casualty claims. Record reviewer, date, evidence and changes in the manifest.
8. **Seal final evaluation cases.** Use unseen combinations and private held-out inputs outside the platform's filesystem; do not tune the world after seeing its result.

Passing tests validates conservation, causal ordering and declared rules. External calibration determines whether those rules approximate a real emergency closely enough for the intended claim.

## Fleet observability repair (2026-10-13)

The information-gap pilot `discovery-transfer-01 / B5` completed eight of twelve needs, with exactly eight dispatches, eight receipts, no blocked trips and no invalid actions. It confirmed all twelve locations. This was not evidence that eight trucks could not serve twelve small requests: the final road-edge telemetry described each truck as `en_route`, and unloading changed the physical truck to `idle` without transmitting that availability. The received fleet therefore remained permanently busy. The preserved pilot is a diagnostic result; its 75.30-minute restricted mean includes four censored needs and must not support a product advantage claim. The associated candidate run was stopped before a paired conclusion.

Terminal vehicle states now produce versioned telemetry through the existing communication channel. Unloading, completed field work, repair, evacuation, cargo recovery, cancellation and failure do not directly mutate a controller's received vehicle view. Latency, destination connectivity, packet loss, retry, finite capacity and expiry still apply equally to every arm. Equal-time reports use vehicle versions so an old retry cannot overwrite newer availability. Background traffic does not add operator telemetry.

Three causal regression tests demonstrate two physical deliveries with one truck, delayed availability during a destination outage, and rejection of an older equal-time busy report. Sequential delivery and outage checkpoints reproduce exactly. The full simulator suite passes 131 tests; the contract check covers 71 JavaScript modules, 26 input kinds, 23 actions and 360 presets. This repairs an operational observation contract; it does not calibrate human productivity, infer saved lives or establish an AI benefit. Re-freeze the simulator fingerprint and rerun every paired arm after this repair.

For the discovery benchmark, human source reading must be reported as a sensitivity assumption, not a field measurement. At minimum compare 0 and 30 seconds per unique source with two and four readers, retain the slower declared profile if run, and include the free keyword/location reference and immediate-formal-report control. Keep physical travel, stock, confirmations and owner authorization identical. Report first useful aid, sufficient aid, coverage and every censored community; do not use only the median of served communities. Confirmation requests should not prevent already confirmed aid from being planned while unrelated inquiries remain pending.

## Dynamic demand response clocks (2026-10-13)

Previously `completedAt` remained set when the same need subsequently increased. A case that had received enough water could therefore remain a reported success even after new outstanding demand appeared. Its old first delivery also looked like immediate aid to the new shortfall. This did not affect the fixed-quantity discovery cohort, but invalidated that interpretation for changing demands in aftershocks, evacuation surges or repeated emergencies.

The cumulative need retains its original `createdAt`, demand quantity and physical `served` ledger. A new `responseCreatedAt` and a new `demandEpisodes` entry begin when a covered or retired need returns to a positive outstanding shortfall. First-useful and sufficient-service timestamps reset for that episode. Historical episodes retain their own timestamps, native units, peak demand and uncovered unit-time. Growth while the same need is still outstanding enlarges its existing episode; it does not erase a useful partial delivery. Existing physical oversupply can cover a later small increase without fabricating another arrival.

Reducing or retiring a request is not a physical service success. An unfinished episode ends as `retired`, with an explicit reason and censoring time; partial deliveries remain visible. A positive but retired current need is excluded from the current active-response denominator and counted separately. Episode history retains both zero-demand retirements and positive corrections, so a controller cannot turn withdrawal into successful aid or silently delete the earlier failure. Withdrawals are competing events: report their count separately and do not interpret a withdrawal-censored duration as sufficient service in a restricted-mean effectiveness claim.

`evaluate().perCommunity.createdAt` is the current response episode's start, with `originalCreatedAt` retaining the initial demand time. `response.sufficientServiceMs` and `response.firstUsefulServiceMs` refer to the current episode; completed-only percentiles still require their censor counts. `response.episodes.perEpisode` exposes historical/active timestamps and censoring, without adding litres, portions or places into one quantity. Integrals remain in each resource's native unit multiplied by milliseconds. The fixed public-discovery cohort never grows or retires a positive scored demand, so its declared first/sufficient physical response measurements are unchanged by this clock repair.

Nine dedicated dynamic tests cover constructor-time demand, increases after coverage, increases before coverage, withdrawal, positive corrections, reopening after retirement, preserved oversupply, checkpoint continuation and exact input replay of three real truck deliveries around a demand-growth intervention. Together with the three original response-time tests, all twelve targeted tests pass. Arithmetic fixtures are identified as measurement fixtures; only the final replay test uses actual dispatch, loading, travel and unloading. This verifies causal accounting, not field realism, human productivity or an AI improvement. Re-freeze builds before new paired comparisons; never combine pre-repair and post-repair worlds.

## Pickup expiry, terminal receipts and facility stock ownership (2026-10-13)

The subsequent primary/control worlds exposed a second observability defect: an ordinary second pickup could take longer than the approved fifteen-minute stock hold. Expiry correctly released the stock; loading correctly failed, but the loading handler did not transmit that failure. The owner therefore kept the previous `arrived` observation and an executing proposal. A censored reference trip must not become evidence of a model's advantage. The apparent approximately 2% positive control estimate depended on this failure and is invalid for comparative claims.

Terminal and actionable operation changes now pass through normal source communications: pickup failure, inspection completion, repair success/failure, cancelled cargo returned physically, evacuation pickup failure or unsafe receiving destination, unloading/compatibility waits and cancellation. Vehicle fuel/shift failure also transmits the physical vehicle state. Existing latency, outages, retries, loss and expiry remain in force. A private material signature versions genuine lifecycle/authority/progress changes; repeated reporting of identical material does not increment the version. Equal-time older status retries cannot overwrite a newer terminal version. These private tracking signatures are absent from actor views.

The implicit hold remains **900,000 ms**. An authenticated owner can explicitly approve `dispatch.params.ttlMs`, a positive integer no greater than **86,400,000 ms**. Invalid windows are rejected before stock mutation. Dispatch does not prolong an existing commitment or bilateral transfer reservation. A delayed policy query exposes default/maximum hold, loading/unloading time and nominal command latency as received operational information with source time and version. Nominal latency is not a guarantee under congestion/outages. Every controller may consume the same contract and must still allow expiry, incomplete work and recovery.

A separate physical defect occurred when an earlier ordinary delivery created a foreign-owned stock at a facility node. Its goods were consumed against the original need; later own provisioning correctly created an owner-suffixed stock, but facility activation and ongoing water consumption still looked only at the base ID. Facilities now resolve stock by node, type and facility owner consistently for dependency availability, qualified staff, power, reservation and water consumption. Foreign stock is never pooled, reserved or consumed; cumulative `provisioned` history alone cannot substitute for currently available physical stock.

Twelve new causal regressions pass. They cover two actual truck journeys with a long pickup, unchanged default expiry versus explicit approved validity, outage-delayed failure and exact replay, invalid-window atomicity, preservation of an existing commitment's expiry, twenty identical reports without new material versions, stale equal-time retries, physical repair/inspection/cargo recovery/fuel failure, receiving-team waits, and an occupied shelter exhausting own water before bilateral replenishment. The ownership case preserves untouched co-located foreign water through closure, replenishment, reopening and service. The complete local suite passes **166/166 tests**; **77 JavaScript modules**, 26 inputs, 23 actions and 360 presets pass contract/hygiene checks. This is integrity evidence, not a measured planning advantage.

All affected current comparisons are retained and invalidated in the platform's `reports/pickup-stock-invalidation.json`: primary `1791837744022`, control `1791837754844`, queued/control `1791839019386`, composition `1791837825645`, plus the two combined-load probes as historical diagnostics. The composition B7 episodes additionally crossed the source-edit boundary and retain that invalidation and any unknown-cost reserve. No missing outcome or paid charge is imputed as success. The old engine benchmark remains a measurement of its recorded build, not this repaired build. A fresh complete freeze, common-controller regression and paired evaluation are necessary before making any benefit claim. The repair neither calibrates real reservation practice nor demonstrates mortality reduction, human productivity or Gemini performance.
## Conservación de competencias después de transferencia y reexpedición

Se encontró otro defecto físico antes del nuevo freeze: una transferencia de personal a un depósito perdía sus cualificaciones; la reexpedición posterior no podía evaluar/provisionar con ese equipo. Copiar la etiqueta histórica del origen también podía inventar habilidades en pools mixtos o duplicar cuentas después de consumir personal. Se corrigió con perfiles físicos, cuentas de competencias y reservas de grupos concretos. La carga, entrega, retorno, pérdida y consumo conservan esas cuentas; las habilidades comunes no son la unión de todos los grupos. Las competencias nativas parciales sin perfiles sólo permiten una intersección garantizada.

Inventario, verificación y observaciones recibidas conservan los perfiles públicos de personal. El nuevo recibo de stock viaja por la comunicación normal; no se crea acceso al oro del evaluador. Las mismas reglas se aplican a todos los controladores. Siete regresiones nuevas cubren transferencia → depósito → evaluación física → reexpedición → activación, personal comprado sin competencias, evaluador ya reservado frente a carga concurrente, división y orden de reservas, intersecciones, cuentas nativas, consumo parcial, pickup fallido, pérdida, retorno y replay/checkpoint.

Verificación del motor posterior: **173/173 pruebas PASS**, cero skips/cancelaciones, **79 módulos JS**/26 inputs/23 acciones/360 presets e higiene PASS; `ENGINE_BUILD bb307da98907240bf04aa7a9bcf6675efd74a7dac6b216cddc346b964b14680c`. Las pruebas anteriores del build `c83c…` no se atribuyen a este motor. Falta el gate conjunto de plataforma/UI/huellas y las nuevas comparaciones congeladas. La reparación acredita consistencia local, no que NEXO ya supere planificación convencional ni que las competencias estén calibradas con operadores reales.
