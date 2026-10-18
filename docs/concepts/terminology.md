# Workkeel terminology

Use the established terms below for current Workkeel tasks. Names of persisted
schemas and historical records remain exact identifiers, not terms to rewrite.

| Term | Meaning in Workkeel | Important distinction |
| --- | --- | --- |
| Task contract | Approved goal, scope, actor, environment and acceptance criteria | Not an executable prompt or proof of completion |
| Agent / Principal | The executing identity / the human authority sponsoring it | Attributed IDs are not authenticated accounts; a second Agent is not a second human |
| Agent harness engineering | Designing instructions, tools, boundaries and checks around an agent | Workkeel orchestrates tasks; the coding runtime owns its internal agent loop |
| Context engineering | Supplying relevant instructions, Skills and evidence at the right task boundary | Not unconditional whole-repository reading or compression of authority |
| Graph orchestration | Explicit nodes, edges, branches, direct joins and bounded loops | A workflow graph is different from a repository knowledge graph or visualization |
| Durable execution | Checkpoints plus an intent/result journal for controlled recovery | Not a guarantee of exactly-once external effects |
| Feedback loop | Execute, evaluate and revise within declared limits | Not automatic learning, policy changes or unlimited retries |
| Human-in-the-loop | Stop for an attributed approval tied to a specific pending action | An approval does not expand the task's permissions |
| Policy-based model routing | Choose a model from approved explicit/rule/default settings | It does not switch the coding runtime or change a model halfway through a conversation |
| Runtime adapter | Trusted host code implementing compatibility, start, resume, cancel and results | An LLM gateway provides model transport, not the coding runtime's tools or sandbox |
| Requested / runtime-confirmed / observed model | The selected name / runtime's reported configuration / independently available backend observation | Unknown observations stay null; an alias alone does not prove the backend |
| Skill | A task-relevant project method with instructions and verification | Selection, reading, application and outcome quality are separate checks |

These terms describe concrete behavior in the [task contract](task-contract.md),
[workflow guide](../operations/workkeel-workflows.md), and
[context guide](../extensions/workkeel-context.md). We use **graph orchestration**
and **feedback loops**, not new product-specific meanings for “Graph Engineering”
or “Loop Engineering.”
