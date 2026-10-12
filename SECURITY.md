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

See the [source/private-state decision](docs/adr/0083-public-source-private-state.md)
and [contribution guide](CONTRIBUTING.md).
