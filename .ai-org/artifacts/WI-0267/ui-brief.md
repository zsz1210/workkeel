# Task monitor — code-first UI brief

Owner: UI Designer agent-yuna. Mode: code-first. Small optional developer utility;
the executable HTML is the first visual artifact. No design vendor dependency.

One page with a clear observation-only header, last updated timestamp, refresh
control, task selector, compact summary and per-run/per-attempt detail. Neutral
light palette, readable system type, strong hierarchy, no decorative animation.
Show requested, runtime-confirmed and independently observed models distinctly.
Use the shared formatter for unknown/partial tokens and elapsed durations.

Required states: loading, empty/unobserved, completed, running/partial, unresolved,
error/stale and access denied. Desktop and 390px mobile, keyboard-accessible
controls, visible focus, semantic headings/tables, reduced-motion-safe. Never
invent percentage completion or prices; include short measurement limitations.

Runtime review: actual browser screenshots and interaction checks for synthetic
states, resize/mobile overflow, escaping untrusted titles, polling updates and
error recovery. Browser assets contain only synthetic data. No live credentials,
account quota or private paths in committed captures. Review evidence will name
the exact tested revision; executable output is not approval by itself.

