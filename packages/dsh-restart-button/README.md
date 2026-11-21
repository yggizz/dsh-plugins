# dsh-restart-button

A restart control for the DeepSeek Harness Web GUI: one entry in the sidebar
footer, drawn as a labelled row while the column is wide and as an icon once it
collapses to the rail.

## Use

1. Find it in the sidebar footer, above the Settings seat.
2. Click once to arm it — the row turns amber and reads "Confirm restart".
3. Click again to restart. The row then reads "Restarting…" and this page
   reloads itself once the new process answers.

## What the restart really does

`mechanism: auto` (default):

- With `endpoint` and `accessToken` set, the Host calls UGREEN OpenCLI
  `docker.Docker/RestartContainer` for `containerId` in the
  `ugreen.dockerserv.internal.grpc` socket — a real `docker restart` issued to
  the Docker daemon on the NAS.
- If that call fails, or its settings are empty, the Host ends its own process.
  This image's compose file declares `restart: unless-stopped`, so Docker
  starts the container again immediately.

`mechanism: opencli` never falls back (a gateway error is reported instead);
`mechanism: exit` always takes the process-exit path.

## Configuration

The row's config in `cordis.patch.yml` (or **Plugins > Restart button >
Configure**):

| field | meaning |
| --- | --- |
| `mechanism` | `auto`, `opencli`, or `exit` |
| `endpoint` | OpenCLI base URL, e.g. `https://192.168.0.103:9443` |
| `accessToken` | OpenCLI access token with `docker_container_restart` permission |
| `containerId` | container to restart; empty means this container (kernel hostname) |
| `socketId` | OpenCLI socket id, default `ugreen.dockerserv.internal.grpc` |
| `rejectUnauthorized` | verify the gateway's TLS certificate |
| `requestTimeoutMs` | gateway request timeout |
| `exitDelayMs` | pause between the reply and the process exit |
| `cooldownMs` | window in which a second restart request is refused |

The token is the same UGREEN OpenCLI token the `dsh-ugreen-nas` row can use.
This package ships **no** credentials: leave `endpoint`/`accessToken` empty and
the button still restarts the container through the process-exit path; fill
them to get a real `docker restart` instead. Set `containerId` to empty to
target whichever container the Harness process is running in.

## Notes

- Both routes are same-origin only, POST requires JSON plus an explicit
  `confirm: true`, and requests are refused while a restart is already running.
- The button is user-only; no agent tool is registered for it.
- This bundle is linked into the profile from this workspace directory, so it
  keeps working as-is; its `node_modules/@deepseek-ai/schemastery` symlink only
  supplies the optional config schema, and the plugin still activates without
  it.
