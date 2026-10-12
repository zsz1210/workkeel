# ADR-0036: Use a dedicated listener for the private LAN Dashboard

## Status

Accepted.

## Context

ADR-0035 keeps the full control plane on loopback and permits a redacted viewer through a pinned Tailscale Serve adapter. At home, requiring a tablet to enable Tailscale for every observation adds friction. Binding the existing full server to a LAN interface would expose its Human Inbox, session secret, and local Agent Command gateway to a broader transport.

The home network is explicitly trusted by the project owner for read-only operational metadata, but private connectivity still must not grant mutation authority.

## Decision

Temple may start a second, opt-in HTTP listener for the redacted private Dashboard.

- The listener binds one exact operator-supplied RFC1918 IPv4 address, never a wildcard or hostname.
- It uses a distinct port, defaulting to `41741`.
- The listener itself assigns `private-viewer` authority. It does not trust Host, Origin, forwarded identity, or Tailscale headers to upgrade a LAN request.
- It reuses the redacted snapshot, refresh-only SSE, GET-only policy, and Inbox exclusion established by ADR-0035.
- The full Dashboard and mutation gateway remain on `127.0.0.1`.
- The Tailscale viewer remains optional and may run concurrently for away-from-home access.
- Temple does not configure a router, firewall, DHCP reservation, TLS certificate, login-time service, or public tunnel.

## Consequences

A device on the same home Wi-Fi can observe the Dashboard without a VPN, while the command surface remains local-only. Traffic is plain HTTP and project metadata is visible to any device that can reach the configured listener, so this mode is appropriate only for a trusted private LAN. Operators should use Tailscale on untrusted networks and may disable the LAN listener by omitting its flag.

The Mac Mini address may change under DHCP. Temple reports the exact URL at startup but does not silently select a new interface. Stable addressing is an operator concern and can be handled with a router reservation.

ADR-0035 remains authoritative for the private-viewer data and command boundary. This ADR adds a dedicated transport rather than weakening the loopback server rule.
