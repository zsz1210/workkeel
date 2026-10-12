# Progressive context routing

Temple keeps project truth in ordinary repository files and routes each Agent to the smallest useful evidence set for a work item. The routing layer reduces repeated full-repository reading; it does not create a second source of truth.

```text
Canonical Specs / ADRs / Skills / Work Items / Learning
                       │
                       ├── specification authority index
                       ▼
         project-owned Context Map
                       │
                       ▼
       deterministic Retrieval Provider
                       │
                       ▼
       generated work-item Context Capsule
```

## Source and ownership model

An opt-in `context packet` command acquires whole selected local sources for the current low-risk bounded Lean Build/Test stage, without changing the existing capsule formats:

```bash
node ./templew.mjs context packet . --work-item WI-0001 --position developer --no-write --json
```

Use the actual Work Item and its current owner Position (`quality_evaluator` at Test). The response includes deduplicated source bodies, selection reasons, hashes and byte counts. Temple emits bodies only to stdout and does not save them to views or canonical records. Caller/provider retention remains separate. Other discovered Skills remain supporting references. Current entry instructions and required nested reads still apply; a packet does not certify complete instruction coverage or authorize mutation.

Missing, unsafe, non-text, oversized, unresolved or changed inputs produce an incomplete response with no source bodies and exit status 1. First-version acquisition conservatively includes authority documents and does not promise smaller prompts or lower Token usage. Limits are 256 KiB per source and 1 MiB total. Unsupported profiles, wrong stage owners, pending delivery and resolver warnings also require the existing route. External specifications and unresolved Evidence IDs are not fetched or invented.

Optional `--purpose primary|integration|recovery` selects the existing route purpose. `--expected-plan <packet_digest>` rejects changed acquisition inputs; the digest does not become a mutation token or proof that a fresh Agent read the material. Revalidate before later actions. See [ADR-0055](../adr/0055-transient-stage-material.md) for the transient acquisition contract and limits.

Optional `--material stage` emits a v2 derived response. It narrows only recognized managed-file inventories and Position definitions to exact existing affected files, acquired sources, and current/handoff/next responsibilities. Original source hashes and emitted-body hashes are separate; the complete sources are still acquired and rechecked. All policies, entry instructions, Skills and evidence remain whole. This does not waive required reads or establish write permission. Omitted mode and `--material full` retain the original v1 response.

Stage mode falls back to whole sources when formats or custom fields are unknown, scope includes directories/globs/missing files, the source is explicitly required by a gate/route/specification, the purpose is recovery, or the projection is not smaller. Each representation carries its reason. Negative exact managed-entry lookup does not classify ownership of unassessed paths. Expected digests bind the material mode, full sources and emitted representation. Byte reduction is diagnostic evidence, not a measured Token or delivery-time improvement. See [ADR-0056](../adr/0056-stage-material-projections.md).

Humans and authorized Agents maintain canonical project files, the thin `.ai-org/project/spec-index.json` authority registry, and the thin `.ai-org/project/context-map.json` routing map. The specification index answers which product or interface document governs a revision; the Context Map answers when an Agent should read a source. Neither stores the source body. The CLI derives disposable views:

- `.ai-org/views/capabilities.json` inventories repository Skills and their lifecycle ownership.
- `.ai-org/views/parallel-plan.json` derives safe dispatch waves and freshness from canonical coordination state.
- `.ai-org/views/work-items/WI-####.json` records the bounded Context Capsule resolved for one work item and Position.

These files can be rebuilt. They never override the Spec, ADR, Skill, Learning record, work item, Assignment, or evidence to which they point.

The Capability Registry classifies exact managed Skill paths as `core`, `optional-pack`, or another framework-managed distribution. An unlisted repository Skill is observed as a `project-extension`; discovery does not add it to `temple.lock`, install it, approve its dependencies, or transfer ownership to Temple.

## Context Map

The Context Map is a compact index of important project sources. Do not copy full documents into it. Each route gives an Agent enough information to decide whether the referenced source should be read.

```json
{
  "schema_version": "temple.context-map/v2",
  "routes": [
    {
      "id": "checkout-spec",
      "kind": "product-spec",
      "title": "Checkout specification",
      "summary": "Product rules and acceptance criteria for checkout.",
      "paths": ["docs/specs/checkout.md"],
      "tags": ["checkout", "payments"],
      "positions": ["product_manager", "developer", "independent_qa"],
      "work_items": [],
      "read_when": ["Changing or verifying checkout behavior"],
      "owner_position": "product_manager",
      "status": "active",
      "stages": ["spec", "design", "build", "test", "independent_qa"],
      "purposes": ["primary", "integration"]
    }
  ]
}
```

Active routes must use repository-relative safe paths, name valid Positions, and point to existing files. `temple doctor` checks those conditions. A work item may pin routes through repeatable `--context-ref` values; `temple doctor` rejects references that do not exist.

Context Map v2 may also constrain a route by `stages` and `purposes`. An omitted or empty array means the route applies everywhere. `temple.context-map/v1` remains readable and behaves as unscoped; context resolution never rewrites that project-owned file. A pinned route outside the selected stage or purpose is excluded with a warning rather than silently overriding the route boundary.

## Capability discovery

List the current repository inventory or find capabilities relevant to a task:

```bash
temple capability list .
temple capability list . --json
temple capability find . --query "checkout documentation" --position developer
```

Search uses Skill names, descriptions, paths, Position hints, and declared invocation metadata. A result is a routing suggestion, not permission to perform the Skill's operation.

## Work-item Context Capsule

Record affected paths and any known context routes when creating work:

```bash
temple work-item create . \
  --title "Verify checkout totals" \
  --scope "Checkout calculation and tests" \
  --acceptance "Independent QA reproduces the public totals" \
  --affected-path "src/checkout/**" \
  --context-ref checkout-spec
```

Resolve context before acting in a Position:

```bash
temple context resolve . \
  --work-item WI-0001 \
  --position developer \
  --stage build \
  --purpose primary \
  --revision abc123 \
  --no-write \
  --json
```

Remove `--no-write` to persist the generated capsule. `--stage` defaults to the Work Item's effective lifecycle stage, while `--purpose` defaults to `primary`. Use `integration` for joining component revisions and contracts, and `recovery` when a fresh Agent must reconstruct the operating boundary. A capsule contains:

- the canonical work-item path, scope, acceptance criteria, and unresolved items;
- the Work Item's revisioned product, UX, UI, API, and technical-design references, resolved to their current authority metadata with stale-reference warnings;
- the Position, assigned Agent Identity, and caller-supplied or inferred revision reference;
- matching Context Map routes;
- active Practices and validated Lessons relevant to the query;
- matching repository Skills and their distribution class;
- affected-path overlaps with other non-terminal work items;
- the Work Item's current parallel-plan disposition, wave, and plan freshness;
- the provider ID, retrieval mode, scores, reasons, and warnings.
- the selected stage, purpose, and explicit `TEMPLE.md` fallback policy;
- a body-free source manifest with one stable selection digest plus per-file category, byte size, and SHA-256.

The resolver does not read every routed document into a prompt. It returns paths and reasons so the Agent can open only the sources necessary for the current responsibility.

The source manifest hashes selected safe regular files locally and retains no source body, prompt, hidden reasoning, tool payload, or credential. Its byte count measures repository content, not model Tokens or monetary cost. `TEMPLE.md` is included in the manifest only for explicit recovery purpose; primary and integration routes name it only as a fallback when authority is ambiguous or the route is incomplete. Temple never expands to it automatically.

Because `.ai-org/views/work-items/WI-####.json` remains a rebuildable latest view, a later resolution may replace an earlier Position, stage, or purpose view. Durable handoffs and evidence must cite canonical repository sources or normalized Evidence rather than using the capsule as lifecycle history.

## Compact entry

The source CLI adds an opt-in `temple.context-entry/v1` response for picking up current work:

```bash
node ./templew.mjs context resolve . --work-item WI-0001 --position developer --compact --no-write --json
```

`--compact` requires `--no-write --json`; it never writes or replaces the full generated capsule. The full response remains unchanged when the flag is omitted. Compact entry is included in published Alpha.33.

The compact entry keeps scope, acceptance, current recorded owner/claim, the last handoff and Developer candidate, unresolved items, selected references and warnings. It omits retrieval scoring, repeated query text and tracker observation detail. A `candidate_operation` and the profile edge guide navigation; they are not a readiness result. Additional policy gates, claim eligibility and current evidence must still be validated by the actual operation. Explicit route stage/Position selection does not change lifecycle ownership. Terminal work has no continuation; pending delivery recovery suppresses other next-operation hints.

Its body-free `source_manifest` is a compact projection, not the full manifest schema. The selection digest covers selected sources plus an authority group: entry instructions, workflow/policies, Identity/Assignment/collaboration, usage, repository integration and governing specification index. `sources` retains selected non-authority file hashes; `authority_snapshot` gives one group digest and its paths. A changed group requires rereading applicable authority; an unchanged hash never proves a source was read or remains available in the current session. Missing sources remain warnings or validation failures, never approval. Recovery and bootstrap reads still apply. Additional unselected authority remains the caller's responsibility.

Neither the manifest nor compact entry is a transaction-wide snapshot, a provider observation, or a Token measurement. Validators recheck mutable state at action time. Serialized sizes depend on selected content and may not be smaller for every tiny Work Item.

## Retrieval Provider boundary

Alpha.12 ships `repository-deterministic`, a local provider that uses explicit IDs, work-item references, Position hints, phrases, terms, tags, and paths. It is reproducible, requires no network, model, vector database, daemon, or embedding download, and reports `semantic: false`.

The `temple.retrieval-provider/v1` contract defines an adapter boundary with `id`, `mode`, `semantic`, and `search(request)`. Alpha.19 includes an injectable local-hybrid provider contract that can combine deterministic and local semantic results through reciprocal-rank fusion. Semantic output may rank only IDs already present in the supplied canonical repository corpus; it cannot replace their paths, content, or authority metadata. The provider preserves repository-relative citations and provenance and falls back deterministically when the local semantic provider fails.

The project-owned `.ai-org/project/retrieval.json` keeps `repository-deterministic` selected by default and marks local hybrid as `available_not_configured`. The framework installs no model, embeddings, vector database, daemon, or remote search. A project must supply and evaluate its own local provider before selection is considered.

## Optional Lean entry

For deliberate opt-in to the bounded Lean material/completion path, use:

```sh
node ./templew.mjs context enter . --work-item WI-0001 \
  --position developer --agent-id agent-builder --principal-id human \
  --no-write --json
```

This read-only entry reassesses the current workflow, actor, stage, ownership and recovery state. Eligible low-risk bounded Lean Build/Test work receives stage material and navigation toward an existing claim or `work-item finish`. Standard, High-Assurance, UI, recovery, conflicting or incomplete cases retain the compact route with explicit reasons. Entry does not choose a new profile, claim work, execute commands or waive required instructions.

Read the returned whole mandatory bodies and the installed `temple-work` Lean execution reference. Read remaining required sources as needed; hashes alone do not prove reading. The source packet is transient and its structured inventory selections remain derived views. Native provider entry and bootstrap obligations still apply to a fresh session.

`--expected-plan` compares an earlier entry digest with the current read-only selection. Actor, authority, runtime state or source changes invalidate it. This digest cannot be passed as a finish mutation preview: finish validates its own request, candidate, claim and evidence. See [ADR-0058](../adr/0058-bounded-lean-entry.md) and [completion guidance](lean-completion.md).

Installed-template and CLI sandbox checks can verify routing, coverage and no-write behavior without model inference. They do not prove that every model will choose the route or understand the delivered instructions.

## Optional task material

Availability: included in published Alpha.33.

`context enter --material task` adds a conservative, derived task view to the same eligible Lean entry. Omitting this option retains the existing stage packet. All original files are still checked for safety, freshness and authority before their representations are selected.

- Known Agent and Assignment inventories retain complete records for the caller, recorded/handoff actors and current/handoff/next Positions. Rules, workflow, collaboration, usage, scope, specifications, risk and current handoff bodies remain complete.
- Evidence referenced only by non-current `evaluation_report`, `independent_qa_pass` or `release_record` gates becomes a path/digest/size reference in Build/Test. It is not current gate evidence. Any additional route, specification or current requirement preserves the full body. Unknown categories remain full.
- Unknown inventory shapes, ambiguous relations, recovery or non-smaller projections retain the original representation. An independently required full read always takes precedence, including requirements expressed in project prose that the CLI cannot infer.

For already-read complete sources that remain available in this same context, `--available-whole-sources` accepts a JSON array of exact `path` and `sha256` records. The digest includes the `sha256:` prefix. This is a caller assertion, not a reading receipt; never generate it from filesystem hashes alone or carry it into a fresh/compacted context whose bodies are unavailable. Changed or missing sources do not disappear. Omit this option when unsure. A projected record cannot stand in for a whole-source acknowledgement.

Task packets use `temple.context-packet/v4`; opted-in whole-source reuse on stage packets uses v3. Reference representations have null bodies and explicit reasons, retaining original provenance. Defaults remain v2. Measured body bytes are not model Tokens; no live efficiency advantage has been established.

Example (substitute the actual eligible Work Item and Agent):

```sh
node ./templew.mjs context enter . --work-item WI-0001 \
  --position developer --agent-id agent-builder --principal-id human \
  --material task --no-write --json
```

See [ADR-0060](../adr/0060-task-material-and-proportionate-instructions.md).
## Retrieval evaluation

Store bounded cases in project-owned JSON and run:

```bash
node ./templew.mjs learning evaluate . \
  --fixture .ai-org/artifacts/retrieval-evaluation.json \
  --no-write \
  --json
```

Each case declares a retrieval kind, query, expected IDs, optional Position, and result limit. The report records result ranks, hit rate, mean reciprocal rank, and provider provenance. Remove `--no-write` to create the rebuildable `.ai-org/views/retrieval-evaluation.json` projection. The current large-repository validation field remains `not_run`.

## Scaling and maintenance

- Keep route summaries short and discrimination-oriented.
- Route stable source families, not every implementation file.
- Use `work_items` and `context_refs` for explicit exceptions; do not encode transient chat state.
- Add stage or purpose constraints only when the same source is genuinely irrelevant elsewhere; leave the arrays empty while evidence is insufficient.
- Compare `source_manifest.selection_digest` before reopening an unchanged route, but still read the underlying canonical source when the responsibility requires its body.
- Deprecate a route before removing it when active work may still reference it.
- Treat affected-path overlap as a warning for coordination, not an automatic ownership claim or work cancellation.
- Evaluate retrieval failures from real work before adding semantic infrastructure.

This design supports small repositories without setup overhead and provides a stable seam for larger repositories without making RAG a dependency of every project.

## Validation evidence

Public tests cover deterministic routing and fallback behavior. They do not
prove large-repository retrieval quality, production local-model operation,
or multi-maintainer governance.
