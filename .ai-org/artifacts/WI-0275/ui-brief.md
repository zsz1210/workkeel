# UI brief and required state coverage

UI Designer: agent-yuna. Mode: code-first. Medium: existing HTML/CSS observer and
installed Chromium browser. Existing quiet panels, responsive cards and system
light/dark theme remain the visual reference. This bounded interface extension
needs no separate design vendor or preimplementation mockup.

Overview prioritizes attention. Detail places current task state, concrete next
action and copy handoff before evidence and timing. Quality compares individual
tasks with sample labels, without an unsupported efficiency ranking. Chinese is
the interface language; machine IDs and project-authored content remain unchanged.
Durations are explicitly stage elapsed time including waiting, not human effort.

Required states: loading, empty, normal, awaiting review, accepted, interrupted,
malformed/unavailable data, expired authorization, clipboard success and fallback,
snapshot failure/recovery, missing capability, no search matches. Verify desktop
1440 and mobile 390 widths, dark mode, keyboard access, visible focus, semantic
labels, polite status, no document overflow, escaped untrusted task titles and
no private model output/capability in handoff text. No decorative motion needed.

Runtime review: run existing monitor browser verifier and legacy console browser
gate; inspect saved screenshots at both widths. Record exact candidate and actual
state coverage, distinguishing real server fixtures from injected error states.
