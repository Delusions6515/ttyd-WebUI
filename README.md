# ttyd WebUI

A mobile-first browser interface for managed `ttyd` + `tmux` terminal sessions. It is an independent application; the upstream Web TTYd Hub source is not a runtime dependency.

## Requirements

Provide `pnpm`, a compatible JavaScript runtime, `ttyd`, `tmux`, and a POSIX shell on the server. The application starts one managed `ttyd` process per session and runs it as the service account; only the managed `ttyd` processes are stopped during service shutdown. No toolchain version is imposed by this repository.

## Configure and run

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Development serves Vite at `http://127.0.0.1:5173` and the API at `http://127.0.0.1:3000`. Vite proxies `/api`, `/ws`, and `/terminal` to the backend, including both WebSocket paths. The Vite origin and proxy target are configured in `.env`; if changing the Vite address, set `VITE_ORIGIN` to the exact browser origin. Do not expose the Vite development server to an untrusted network.

Build and run the production server on one origin:

```sh
pnpm run build
pnpm start
```

The backend serves `frontend/dist` and the API/notification/terminal endpoints from the same listener. It binds to `127.0.0.1:3000` by default. Set `HOST` and add exact browser origins to the comma-separated `TRUSTED_ORIGINS` only when enabling trusted private-network access. For example, use the interface address or `0.0.0.0` for `HOST` and `https://terminal.example.lan` in `TRUSTED_ORIGINS` when a trusted TLS reverse proxy serves that origin. Configure the proxy to preserve the intended `Host` and `Origin`; forwarded host/protocol headers are not trusted. ttyd processes always bind to loopback and require unpredictable per-process credentials. The backend injects those credentials into upstream HTTP and WebSocket requests only after Host/Origin validation; direct unauthenticated access to an internal ttyd port is rejected. These internal credentials are not a user authentication layer.

**This application has no user login or authorization layer.** Host/Origin checks reduce cross-origin access from hostile web pages; they are not authentication. Do not expose it to the public internet. Restrict private-network access to trusted users and networks, or put an authenticated access gateway in front of it.

The application and proxied ttyd HTML set the enforced response policy `Content-Security-Policy: frame-ancestors 'none'`; the Vite development entry also sets it. Terminal pages cannot be embedded by another site.

## Sessions and tmux

Each session uses a separate named tmux server socket, `ttyd-webui` by default. Inspect only that namespace with:

```sh
tmux -L ttyd-webui list-sessions
```

Do not use the host's default tmux socket to inspect or manage application sessions. Closing a browser, stopping web access, or restarting the service stops managed `ttyd` processes but preserves existing tmux tasks. The in-memory management list is intentionally empty after a service restart and does not rediscover old or external tmux sessions; this first release does not provide a recovery/import screen. New sessions cannot reuse names held by preserved tmux tasks; automatic naming skips them. Manage cleanup only through a session's Delete action or the application's own socket namespace.

## Browser limitations

Clipboard read/write APIs depend on browser permissions and secure-context rules; private-network HTTP pages may not receive those capabilities. The Tools panel offers a text-input fallback for paste and a selectable terminal-buffer view for copying. It does not write terminal text or drafts to browser storage. Mobile browser policy controls whether focusing/blur can open or close the system keyboard; the keyboard button requests that action but cannot force the operating system.

The interface provides terminal shortcuts and bundled JetBrains Mono Nerd Font Mono. It is not a complete native Termux replacement. Chinese IME, touch keyboard focus, clipboard UI, and font rendering must be checked on the actual target devices.

## Validation

```sh
pnpm run typecheck
pnpm run test:backend
pnpm run test:frontend
pnpm run test:integration
pnpm run test:e2e
pnpm run verify
```

The integration and browser suites require real `ttyd` and `tmux`; missing binaries fail the checks instead of silently skipping them. Browser tests use Playwright Chromium and WebKit; install those browser builds when needed with `pnpm exec playwright install chromium webkit`. On Linux systems missing browser libraries, Playwright reports the missing packages; install its OS dependencies with `pnpm exec playwright install-deps chromium webkit` where authorized. Integration fixtures use a private temporary tmux directory, an application-specific random socket, and test-owned ports/sessions; they never target the host's default tmux server. E2E projects exercise both Vite development proxying and the built production server. These software-browser checks do not establish physical-device keyboard or IME behavior.

Runtime combination exercised here: `ttyd 1.7.7-40e79c7` with `tmux 3.7c`. The real protocol check covered token-first WebSocket connection, shell state across ttyd stop/restart, resize reporting, and exact deletion in the isolated application socket. Chromium also drove managed Bash through virtual Ctrl+C, Tab completion, arrow editing, and Alt+word input in both serving modes. This records one observed combination; the project does not claim compatibility with every ttyd release.

### Physical-device acceptance checklist

Record each result on the actual device/browser before claiming support. Current repository automation does not run on physical devices; these items remain **unverified until manually completed**.

| Device/browser | Chinese IME commit / Ctrl and Alt | Keyboard open/close / rotation | System copy/paste over private HTTP | Nerd Font / mixed-width text | Result |
|---|---|---|---|---|---|
| Android Chrome | Pending | Pending | Pending | Pending | Not verified |
| iOS Safari | Pending | Pending | Pending | Pending | Not verified |

## Source and license

This project is licensed under the root [AGPL-3.0 license](LICENSE). The [public project repository](https://github.com/Delusions6515/ttyd-WebUI) contains only the versions actually published there; it does not automatically include local or otherwise unpublished deployment changes. Operators must offer users the complete source corresponding to the version they run, including any local modifications. For an unpublished build, provide that exact source with the deployment or through a stable operator-controlled source archive; do not present the public repository's `main` branch as containing unpublished changes. Reused backend code, bundled fonts, their original notices, and fixed upstream sources are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The About section in Settings links to the public project repository, notices, and fixed upstream sources; those links do not replace the deployment operator's offer of the exact deployed source.

## Implementation map

| Area | Source |
|---|---|
| Session HTTP API | `server/routes/sessions.js`, `frontend/src/api/sessions.ts` |
| Process, port and tmux ownership | `server/services/session-manager.js`, `server/services/port-manager.js` |
| Host/Origin trust and HTTP/WebSocket proxy | `server/middleware/trusted-origin.js`, `server/app.js`, `server/ws.js`, `frontend/vite.config.ts` |
| ttyd protocol and terminal lifecycle | `frontend/src/terminal/ttyd-client.ts`, `frontend/src/terminal/terminal-controller.ts` |
| Mobile layout, shortcuts and tools | `frontend/src/App.vue`, `frontend/src/components/`, `frontend/src/composables/useVisualViewport.ts` |
| Local preferences and bundled fonts | `frontend/src/stores/preferences.ts`, `frontend/public/fonts/` |
| Backend, real-runtime and browser tests | `tests/backend/`, `tests/integration/`, `tests/e2e/`, `tests/fixtures/` |
