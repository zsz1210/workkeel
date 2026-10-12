# ADR-0023: Separate normalized evidence from lifecycle authority

- Status: Accepted
- Date: 2026-08-30
- Scope: Phase 2B evidence and Observer surface

## Context

Temple already preserves gate references on Work Items, but a free-form path does not say whether a claim came from Git, a test runner, a runtime observation, a risk review, or an explicitly unverified statement. The Observer also needs a stable way to show stale evidence, pending approval, and recovery attention without opening every task or taking authority from a Position.

## Decision

Add a project-owned Evidence Registry at `.ai-org/project/evidence.json`. Every entry has a stable ID, Work Item, evidence kind, outcome, exact scope revision when applicable, actor, adapter provenance, timestamps, summaries, and content-addressed repository artifacts.

Temple ships bounded local adapters for exact Git revisions, test observations, runtime observations, explicitly unverified claims, risk records, and rollback records. Adapters read local repository state only. They never run a test, launch a runtime, contact a service, write an external tracker, release software, or satisfy a lifecycle gate.

Add a generated Observer projection that combines Work Items, runtime workers, normalized evidence, and events into:

- active, blocked, QA-pending, approval-pending, and queued work;
- a revision-aware lifecycle timeline;
- stale, invalidated, failed, unverified, high-risk, approval, and recovery attention signals;
- a local static overview with no mutation controls.

`observe --no-write` is strictly read-only. The default `observe` command may replace only generated files under `.ai-org/views/`; canonical project state remains untouched.

## Consequences

- Evidence becomes searchable and machine-checkable without making chat or generated views canonical.
- Capturing evidence and authorizing a transition remain two explicit actions.
- Exact revision and artifact digests let `doctor` detect drift.
- Unverified claims remain visible instead of being laundered into passing evidence.
- Production actions and external writes remain outside this adapter boundary and require separate explicit authority.

## Not claimed

This decision does not validate a real production runtime, an external CI provider, multiple physical machines, distributed locking, or external write-back. Those conditions require separate evidence.
