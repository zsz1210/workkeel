# Bounded efficiency evaluation

Candidate: `e8953fa339e4b3012d1dfa7b73620cc0d5f11a44`.

The observer improvement meets acceptance at 20 and 200 synthetic tasks. Seven
paired measurements preserve complete semantic output; the 200-task median fell
60.59%. One-task results show no meaningful improvement. The snapshot remains a
point-in-time observation, not an atomic transaction across all files. Seven-sample
p95 is the maximum sample and is not a production SLA.

The shortened controlled strings reduce bytes 30.58%, with full task/work values
still transmitted. Live Sol / medium tests preserve first-pass quality and scope
in eight of eight synthetic cells. Each scenario has only two before/after pairs,
in AB/BA order, identical frozen source/specification/checks, 120 seconds per turn,
and at most one repair. Reference implementations passed the prewritten oracles.

Retry: before/after mean 38.93/37.99 seconds; 54648.5/63157.5 total tokens.
Handoff: before/after mean 40.25/40.58 seconds; 77959.5/78446 total tokens.
Uncached input increased 51.03% and 40.22% respectively. Requests/tool behavior
and cache coverage varied. Smaller instruction bytes therefore did not produce
observed token savings; this cohort cannot establish causality or a stable penalty.
Runtime difference is small and mixed. Do not claim faster model execution or
cheaper usage. Cost, human time and main coordinator conversation usage are unknown.

This cohort compares Workkeel before and after; it is not the previous native-
Codex comparison. Prepared cold-handoff fixtures do not establish actual crash or
cross-machine recovery. All attempts are retained; no selected-result filtering.
The conservative disposition is retain the byte reduction and independently
measured observer speedup, with no general cost/performance marketing claim.
