# Parallel work and runtime correlation

Read for dispatch planning or runtime-worker changes, not ordinary sequential delivery. A plan does not authorize new scope or create claims or app tasks.

This procedure governs delivery, formal verification and resource-owning workers. For informational help under a parent's authority, first apply [Read-only support](read-only-support.md). If eligibility fails, use this governed route; never relabel an existing worker to evade its obligations.

1. Configure parent/dependencies, stage Disciplines/resources, exact base revision, affected paths, shared-contract status, integration owner and overlap resolutions naming conflicting Work Item IDs.
2. Run `parallel check` for one item or `parallel plan --parent <id>` for a group. Rebuild stale plans. Never dispatch a rejected, sequential, blocked or unauthorized plan.
3. For the first fresh safe wave, call `parallel prepare` with Agent, sponsoring Principal, exact base revision, branch, optional worktree and `internal-subagent` or `user-task`. Successful preparation reserves claim, resources and worker. Only then create the runtime.
4. When implementation is authorized and concurrent workers are available, dispatch the safe wave up to capacity without redundant confirmation. Otherwise preserve wave boundaries and work sequentially. Attach internal runtimes with `worker attach --runtime-id`; do not register them as Codex tasks. For an explicitly authorized separate user-owned task, create it with the app tool, then `task register` with its stable ID and prepared `--worker-id`.
5. Use `worker update` for runtime status/evidence and `task update` for separate app tasks. Terminal workers release resources, not lifecycle responsibility. Cancelling an unattached reservation may release its claim; attached/completed work still needs explicit handoff and release.
6. The Integration Owner joins exact candidates, checks and unresolved items before dependent work or lifecycle advancement, then rebuilds the plan. Local locking is not distributed: separate checkouts/machines still need branches, PRs and explicit conflict resolution.

Planning finishes with valid fresh plan-only entries and explicit reasons for non-dispatchable work. This is not implementation completion.
