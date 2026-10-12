# Home-LAN private Temple Workspace

Temple can expose the redacted read-only Temple Workspace on one exact private IPv4 address. Use this mode when a trusted tablet or computer is on the same home Wi-Fi and enabling a VPN for every observation would add unnecessary friction.

The full control plane still listens only on `127.0.0.1`. The LAN address belongs to a separate GET-only listener with no Human Inbox, Agent Commands, session secret, daemon path, raw event payload, or mutation route.

## Trust boundary

```text
Trusted home tablet
    │  plain HTTP on the same Wi-Fi
    ▼
Mac private IPv4:41741
    │  dedicated read-only listener
    ▼
redacted snapshot + refresh-only events

Mac browser ── 127.0.0.1:<port> ── full local Temple Workspace
```

This mode does not authenticate another device or encrypt traffic. Any device that can reach the listener can view its project operational metadata. Use it only on a trusted LAN; use the [Tailscale private Temple Workspace](tailscale-private-dashboard.md) away from home or on an untrusted network.

## Find the Mac address

On macOS, identify the interface used by the default route and then read its IPv4 address:

```bash
route -n get default | awk '/interface:/{print $2}'
ipconfig getifaddr en1
```

Replace `en1` with the interface printed by the first command. Temple accepts only exact addresses in `10.0.0.0/8`, `172.16.0.0/12`, or `192.168.0.0/16`. It rejects hostnames, wildcard binds, loopback, link-local, multicast, carrier-grade NAT, and public addresses.

## Start

From the project repository, store the Mac's current private address in a task-specific shell variable, then start the listener:

```bash
TEMPLE_LAN_IP="$(ipconfig getifaddr en1)"
node ./templew.mjs control-plane start . \
  --lan-viewer-host "$TEMPLE_LAN_IP"
```

The LAN listener uses port `41741` by default. Choose another available port when necessary:

```bash
node ./templew.mjs control-plane start . \
  --lan-viewer-host "$TEMPLE_LAN_IP" \
  --lan-viewer-port 41742
```

Add live Codex observation and the away-from-home Tailscale viewer independently:

```bash
node ./templew.mjs control-plane start . \
  --codex \
  --lan-viewer-host "$TEMPLE_LAN_IP" \
  --tailscale-viewer
```

Temple prints the full local URL, the home-LAN URL, and the Tailscale URL that were actually started. A LAN port of `0` requests an ephemeral port for tests or one-run diagnostics.

## Stop and address changes

Press `Ctrl-C` in the terminal running Temple. Shutdown closes the LAN and loopback listeners and then releases generated control-plane state; an enabled Tailscale Serve mapping is also reset by its owning adapter.

Temple does not start at login, edit the macOS firewall, configure a router, or reserve a DHCP address. If the Mac's address changes, restart with the new private address. A router-side DHCP reservation can keep a bookmarked tablet URL stable, but remains an operator decision outside Temple.

## Authority check

The LAN listener derives its read-only authority from the exact socket that accepted the request. A caller cannot obtain loopback authority by supplying a localhost Host header, a Tailscale identity header, an Origin, or a forwarded header. Every non-GET request is rejected before body parsing, and `GET /api/v1/inbox` remains forbidden.
