# Security

## Supported version

Workkeel is an experimental beta. The published prerelease is
`0.1.0-beta.1`. Security fixes target the latest supported prerelease;
older versions may need an upgrade.

## Report a vulnerability

Use [GitHub's private vulnerability report](https://github.com/zsz1210/workkeel/security/advisories/new)
to contact the maintainer. Describe affected versions, impact and a minimal
synthetic reproduction. Do not place a vulnerability, token, private prompt,
customer record or task evidence in a public issue or PR. There is no response-time
service-level agreement. If the private form is unavailable, do not disclose the
details publicly; ask for the private reporting route to be restored without
including vulnerability details.

## Boundaries

- Workkeel records permissions and attribution; the execution host enforces
  filesystem, tool, network, and model access. Recorded identities are not
  authentication.
- Keep actual tasks, approvals, conversations, raw execution output, measurements,
  review evidence and machine settings in a separate private workspace outside
  the public checkout. Git-ignored paths are not a storage boundary. Preserve a
  private backup; never attach those records to public issues, PRs or releases.
- Optional adapters and observers must stay within their documented access
  and authority boundaries. Review their specific guides before enabling them.

In retained compatibility mode, initialization never accepts model credentials as
Agent display names or Position assignments. `temple init` preserves modified
managed files and existing `AGENTS.md` unless integration is explicitly requested.
Archify has no authority to approve releases or modify canonical state.

## Private Dashboard viewer

The optional Tailscale viewer keeps Temple bound to `127.0.0.1` and trusts a Tailscale identity header only for an exact runtime `*.ts.net` Host behind Tailscale Serve. Its projection excludes the Human Inbox, Agent Commands, session secrets, daemon paths, and raw events, and all remote mutations are rejected. Never bind the control plane directly to a LAN or tailnet address, invoke Funnel for it, or treat tailnet membership as Agent-command authority. Restrict the Serve endpoint with Tailscale grants; the launcher does not change network policy.

## Federation participant inspection

Federation treats every participant checkout as untrusted input. A participant path must resolve to the exact Git worktree root and remain inside the explicit federation root. Inspection runs Git noninteractively with a bounded environment, skips ambient global and system configuration, disables executable `core.fsmonitor`, repository hooks, credential helpers, replacement objects, and all transport protocols, and forbids lazy fetch. Missing objects and hostile or inconsistent repository state degrade the participant to `unknown`; they do not authorize a network request, participant write, or lifecycle mutation.

See the [source/private-state decision](docs/adr/0083-public-source-private-state.md)
and [contribution guide](CONTRIBUTING.md).
