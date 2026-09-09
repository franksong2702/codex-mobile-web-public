# ChatGPT Shared Launcher on macOS

## Purpose

`ChatGPT Shared.app` launches the official ChatGPT application with the
repository's shared app-server mux environment. Codex Mobile remains a strict
consumer of the endpoint at `~/.codex/app-server-mux/endpoint.json` and can
reattach when the endpoint becomes available.

The installed application uses the official ChatGPT icon from
`/Applications/ChatGPT.app/Contents/Resources/icon-chatgpt.icns`. It has a
separate bundle identifier and does not modify or re-sign `ChatGPT.app`.

## Two entry paths

1. The user LaunchAgent runs once per Aqua login. A healthy shared ChatGPT is a
   no-op. If an ordinary ChatGPT Login Item wins the startup race, the launcher
   waits ten seconds, then performs one graceful shared-mode relaunch.
2. Opening `~/Applications/ChatGPT Shared.app` is an explicit repair action. A
   healthy shared runtime is a no-op; an unhealthy running ChatGPT is gracefully
   relaunched through `start-codex-desktop-shared-macos.sh --force-quit`.

Neither path uses `KeepAlive`, process signals, or a recurring watcher. It
cannot create a restart loop after an intentional user quit.

The launcher explicitly handles the zero-argument path used when ChatGPT is
not running. This avoids macOS Bash 3.2 treating an empty array expansion as an
unbound variable before the Desktop shared launcher can run.

Running-state detection uses the full command line reported by `ps`, matched
against the exact official ChatGPT executable path. M15's `pgrep` does not
return the live ChatGPT GUI process even when `ps` and LaunchServices do, so it
must not be used as the authority for this launcher.

## Install and remove

```bash
bash scripts/macos/install-chatgpt-shared-launcher.sh --apply
bash scripts/macos/install-chatgpt-shared-launcher.sh --remove
```

Runtime logs contain only timestamps and bounded state labels:

```text
~/Library/Application Support/ChatGPT Shared/launcher.log
```

The launcher does not log endpoint contents, Session data, messages, tokens, or
credentials.

## Acceptance boundary

Installation and a healthy-runtime no-op do not prove the login path. Final
acceptance requires a real logout/login or M15 reboot, followed by confirmation
that ChatGPT owns a fresh mux endpoint and Codex Mobile reports the strict
shared transport. Do not force that disruptive test while active Sessions are
running.
