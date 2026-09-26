# Tailscale private observer

## Native Workkeel observer

The current task-first website uses the optional native private viewer described
in [Workkeel observer operations](../operations/workkeel-observer.md#private-access-over-tailscale).
It serves the same read-only task UI through Tailscale Serve and keeps the local
capability on the Mac. The route is restricted to the explicitly configured owner.
It does not require the historical Control Plane or Agent Command gateway.

## Historical Control Plane integration

The remaining instructions describe the retained Temple-compatible workspace.
Do not use this command to deploy the native Workkeel observer.

Temple can expose a redacted, read-only Temple Workspace to another device in the same Tailscale network. The full Human Inbox and Agent Command gateway remain available only at the Mac's loopback URL.

For a trusted tablet on the same home Wi-Fi, the [Home-LAN private Temple Workspace](home-lan-private-dashboard.md) provides a separate opt-in read-only listener without requiring the tablet to enable Tailscale. Both modes may run at the same time.

## Boundary

```text
Tablet browser
    │  tailnet HTTPS + Tailscale identity
    ▼
Tailscale Serve
    │  localhost reverse proxy
    ▼
Temple 127.0.0.1
    ├─ private Host → redacted GET-only viewer
    └─ loopback Host → full local Temple Workspace
```

The private viewer includes Work Items, provider health, conditions, usage observations already present in the live projection, and the combined timeline. It excludes:

- the Human Inbox and Agent Command UI;
- the per-process Inbox session secret;
- Inbox request and submission data;
- local daemon paths;
- raw journal event payloads;
- every mutation route.

## Requirements

- Tailscale CLI `1.98.8`, the exact version currently validated by Temple.
- The Mac and viewing device signed in to the same permitted tailnet.
- HTTPS enabled for the tailnet.
- No existing Tailscale Serve configuration on the Mac. Temple refuses to replace or merge one.
- A Tailscale grant that limits access to the intended user or device.

Tailscale documents that Serve is tailnet-only, injects user identity headers, removes spoofed incoming identity headers, and recommends a localhost-only backend when an application trusts those headers. See [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve). Access rules also apply to Serve; use [Tailscale grants](https://tailscale.com/docs/features/access-control/grants) rather than assuming every tailnet member should see project metadata.

## Start

From the project repository:

```bash
node ./templew.mjs control-plane start . --tailscale-viewer
```

Add `--codex` only when the project has deliberately opted into live registered-task observation:

```bash
node ./templew.mjs control-plane start . --codex --tailscale-viewer
```

To keep the home Wi-Fi and away-from-home links active in one process:

```bash
node ./templew.mjs control-plane start . \
  --codex \
  --lan-viewer-host "$TEMPLE_LAN_IP" \
  --tailscale-viewer
```

Temple prints two URLs. Open the URL currently labelled `Private read-only Dashboard` on the tablet while Tailscale is connected; it loads the read-only Temple Workspace. The local URL remains the only interactive surface.

The launcher:

1. verifies the exact Tailscale CLI version and online device identity;
2. refuses an existing Serve configuration;
3. starts Temple on an ephemeral `127.0.0.1` port;
4. configures tailnet-only HTTPS Serve for that loopback target;
5. verifies the private host and target, with Funnel disabled.

It does not install Tailscale, change access policy, enable Funnel, store credentials, or enable Agent Commands.

## Stop and rollback

Press `Ctrl-C` in the terminal running Temple. Temple records the first `SIGINT` or `SIGTERM` as the stop request, keeps both signal handlers active during cleanup, removes the Serve configuration it created, and then closes the local control plane and optional LAN listener. Repeated stop signals during cleanup are ignored so they cannot interrupt rollback. The handlers are removed only after every owned resource has closed.

A successful process exit therefore means the Temple-owned Serve mapping was reset and the local listener was closed. A cleanup failure exits unsuccessfully instead of claiming a clean stop.

If the process is terminated before cleanup, inspect before changing anything:

```bash
tailscale serve status --json
```

When the reported configuration is only the Temple loopback target, remove it with:

```bash
tailscale serve reset
```

Do not reset a device with unrelated Serve routes. Temple refuses to start when it detects such routes so it never has to guess their ownership.

## Dependency and license

Temple executes a user-installed binary and adds no Tailscale package. The validated open-source client release is `1.98.8`; the [Tailscale repository](https://github.com/tailscale/tailscale) is BSD-3-Clause licensed. Use of the hosted Tailscale service is governed separately by the operator's account and service terms.

## Agent Command boundary

Private Temple Workspace access is not remote-control authorization. `--tailscale-viewer` does not enable the Codex provider or `agent_commands`. Even if local Agent Commands are enabled separately, private-viewer requests cannot fetch Inbox state, receive a session secret, or call a POST route.
