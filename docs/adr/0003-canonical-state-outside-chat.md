# ADR-0003: Chat is not canonical state

- Status: Accepted
- Date: 2026-08-29

## Context

AI conversations cannot reliably share complete memory, and their titles can change or lose meaning.

## Decision

Specifications, designs, ADRs, work items, assignments, evidence, and approvals must be stored in project files, Git, or explicitly linked external systems. Chat is for discussion, operations, and handoffs.

## Consequences

Any Agent can recover state from the repository, but every task gains one necessary responsibility: write confirmed information back to canonical files.
