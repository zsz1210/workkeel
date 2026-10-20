# ADR-0087: Coordinator-owned browser verification

- Status: Implementation candidate; independent acceptance required

## Context

A UI improvement cannot be accepted using syntax checks alone. Giving a model
unrestricted browser and process tools would broaden the approved stock runtime.
A check that reports completion while leaving background processes alive is also
not a settled operation.

## Decision

Keep model turns on the qualified Codex subscription profile, with their exact
model selection, scoped product access and disabled network. The coordinator may
run an immutable, approval-pinned browser check when both component and controller
explicitly authorize Node, browser execution and loopback networking.

On the qualified macOS host, the coordinator starts the installed Google Chrome
under an operating-system filesystem and network sandbox. The check connects to
that browser through CDP. Its Node process cannot fork, including detached
children. Chrome owns its renderer processes; the coordinator closes Chrome and
settles its process group before returning. Cancellation uses the same ownership
boundary. No browser, SDK or executable is downloaded or vendored.

Only private scratch is writable. Networking is limited to the check's allocated
preview and browser control ports. Product code and approved evidence are readable;
an existing preview needs its exact loopback origin pinned in component authority.
The application host owns that preview's subprocesses and candidate identity.
private runtime records stay denied. Each screenshot is bounded, fully validated
as a supported PNG and pinned into a candidate-bound verification report. The
distinct reviewer must open those exact images and author its own visual judgment.
Invalid evidence fails the mandatory check and permits the existing bounded
repair path; it never counts as a successful visual review.

## Consequences

This is a specific qualified local host, not a promise of portable browser
containment. Unsupported operating systems or missing Chrome block before model
dispatch. Generic Node checks cannot spawn subprocesses; composite checks need an
explicit qualified coordinator implementation. Missing provider usage remains
unknown. Local verification itself uses zero model tokens.

The installed browser is a user-managed prerequisite with its own license. The
framework adds no vendor package or runtime dependency. Browser checks may use
project-installed libraries already covered by their project policy; Workkeel
does not install them. Public framework browser tests continue to use the existing
lockfile-pinned Playwright Core dependency and installed Chrome.

See the [goal guide](../operations/workkeel-goals.md),
[workspace guide](../operations/workkeel-workspace.md) and the primary
[Chrome DevTools Page protocol](https://chromedevtools.github.io/devtools-protocol/tot/Page/).
