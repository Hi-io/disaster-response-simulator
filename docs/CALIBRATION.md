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
