# Security

## Supported version

Workkeel is an experimental beta. The published prerelease is
`0.1.0-beta.1`. Security fixes target the latest supported prerelease;
older versions may need an upgrade.

## Report a vulnerability

Use GitHub's private **Security → Report a vulnerability** flow when it is
available for this repository. Do not place a vulnerability, token, private
prompt, customer record, or task evidence in a public issue. If private
reporting is unavailable, email `zsz1210+oss.temple@gmail.com` with
`[Workkeel][SECURITY]` in the subject. There is no response-time
service-level agreement.

## Boundaries

- Workkeel records permissions and attribution; the execution host enforces
  filesystem, tool, network, and model access. Recorded identities are not
  authentication.
- Do not commit secrets, actual task records, approvals, raw execution output,
  `.ai-org/`, or `workkeel.lock` to public source history. Keep a separate
  private backup of needed state.
- Optional adapters and observers must stay within their documented access
  and authority boundaries. Review their specific guides before enabling them.

See the [source/private-state decision](docs/adr/0083-public-source-private-state.md)
and [contribution guide](CONTRIBUTING.md).
