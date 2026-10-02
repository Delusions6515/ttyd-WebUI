# ttyd WebUI user guide

[简体中文](usage.zh-CN.md) · [Project README](../README.md)

Use a browser to work in a terminal on your server, with arrow keys, Tab, Ctrl, and Alt available on a phone. Each session runs in tmux: closing the page does not end the task, so you can reconnect later.

> **Decide who can reach the page before starting.** This application has no login or user permissions. Anyone who can access it can use a terminal as the service account. Do not expose it directly to the internet. For remote access, prefer an SSH tunnel or an authenticated HTTPS access gateway. Run the service as an ordinary user, not root.

## 1. Install and start

### What the server needs

- Node.js and pnpm to install dependencies, build the page, and run the service.
- [ttyd](https://github.com/tsl0922/ttyd) and [tmux](https://github.com/tmux/tmux) for terminal connections and background sessions.
- A POSIX shell, such as Bash or sh. The download commands below also need Git.

Install these programs on **the server running the service**. Phones and other clients only need a browser. Follow your operating system's installation instructions; this project does not prescribe Node.js or pnpm versions.

Check that the programs are available:

```sh
node --version
pnpm --version
ttyd --version
tmux -V
```

### Download and run

The application code is currently on the `dev` branch. These commands download that branch:

```sh
git clone --branch dev https://github.com/Delusions6515/ttyd-WebUI.git
cd ttyd-WebUI
pnpm install --frozen-lockfile
cp .env.example .env
pnpm run build
pnpm start
```

Open **http://127.0.0.1:3000** in a browser on the server. The service runs in the foreground, so keep that terminal open. Press `Ctrl+C` to stop the service; existing tmux tasks remain running.

If you already have a checkout, use its project directory instead of cloning again. Restart the service after changing `.env`.

### Access from another computer: SSH tunnel

Keep the default loopback listener and run this on the client computer:

```sh
ssh -N -L 3000:127.0.0.1:3000 user@server
```

Replace `user@server` with your server's SSH user and address. Keep the SSH connection open, then visit **http://127.0.0.1:3000** in the client browser. If port 3000 is already in use on the client, stop the program using it first.

## 2. Create and manage sessions

The interface currently uses both Chinese and English labels. This guide includes the visible labels so you can find the controls.

1. On a phone, tap **会话** (Sessions) at the top left. On a desktop, use the left sidebar.
2. Select **New session** and choose an available Shell on the server.
3. Leave the name blank for an automatic name. Custom names may contain English letters, numbers, underscores, and hyphens, such as `work-shell`.
4. Select **Create session**. Start typing commands once the terminal connects.

Select a name in the list to switch sessions. On a desktop, you can collapse the sidebar for more terminal space.

| Action | Result |
|---|---|
| Close or reload the page, or briefly lose connectivity | The tmux task stays running. You can continue after reconnecting. Input typed while disconnected is not replayed. |
| **Stop** | Stops this session's web terminal service, leaving its tmux task running. |
| **Resume** | Reopens web access to a stopped session and reconnects to its retained task. |
| **Delete**, then confirm | Ends this session's tmux task and removes the record. **This cannot be undone; programs inside the task also end.** |
| Stop or restart the whole WebUI service | Managed ttyd processes stop, but tmux tasks remain. The session list is empty after the service starts again. |

**Old tasks do not automatically reappear in the list after a service restart.** There is currently no import or recovery screen. A new session cannot adopt a preserved task with the same name; automatic naming skips occupied names. To reach an old task, see “Sessions disappeared after restarting the service” below.

## 3. Phone input and shortcuts

Tap the terminal to type, or use **显示键盘 / 隐藏键盘** (Show/Hide keyboard) at the top to request that the software keyboard opens or closes. The phone's browser and operating system decide whether that request takes effect.

The default bottom toolbar has two rows:

```text
ESC   /   -   HOME   ↑   END   PGUP
TAB   CTRL   ALT    ←   ↓    →    PGDN
```

- **TAB** sends Tab, commonly used for shell completion.
- **Arrow keys, HOME, END** edit a command or control a terminal program.
- **ESC, PGUP, PGDN** send those keys. Their effect depends on the active program.
- F1–F12 and common shortcuts live in the Tools panel, not in the bar, so the bar stays close to the keyboard.
- Tap **CTRL / ALT** to enable a modifier once, then type a character or tap a toolbar key. It clears after one send. Tap again to cancel it.
- Long-press **CTRL / ALT** to lock the modifier for repeated combinations. Tap it to unlock.

For example, tap **CTRL**, then type `c` to send `Ctrl+C`, or open **工具** (Tools) and select **Ctrl+C** there. This usually interrupts the active program; it does not copy text. Use Tools to copy.

Enabling virtual CTRL/ALT opens the **组合输入** (Combined input) field. Finish confirming an IME candidate before sending it. Chinese or multi-character commits are not forced into control characters. Paste and the long-text input preserve the original text without applying virtual modifiers. Physical keyboard Ctrl/Alt combinations use the actual pressed modifiers and do not consume the toolbar's one-shot state.

## 4. Copy, paste, and view history

Select **工具** (Tools) at the top right of the terminal.

### Copy

- Select terminal text, then choose **复制所选文本** (Copy selected text).
- If selecting text is awkward on a phone, choose **打开复制视图** (Open copy view), then select and copy text in that view.

The copy view is a snapshot of the terminal buffer when opened. It is not a live log and does not include history that has already left the buffer.

### Paste and long text

- Select **粘贴** (Paste) to try reading the system clipboard.
- If the browser denies clipboard access, follow the prompt to paste manually into the text input.
- Select **输入长文本** (Enter long text), edit your text, then choose **发送文本** (Send text) or **发送并回车** (Send and Enter).

Send text adds no extra Enter. Send and Enter appends a carriage return. Multiline text can already contain line breaks, and pasted commands may execute, so check the content before sending it.

Clipboard features depend on permission and browser secure-context rules. Automatic copy or paste may be unavailable when a phone opens a local-network HTTP address. Use the manual options above or deploy HTTPS.

### View output history

Use the mouse wheel or swipe vertically over the terminal to view tmux history. In Tools, **向上滚动 / 向下滚动** (Scroll up/down) moves 20 lines per tap, and **返回底部** (Return to bottom) returns to the latest output. All of these actions run through tmux on the server rather than the browser's local scrollback.

Scrolling enters tmux copy mode. **返回底部** leaves copy mode and returns to the latest output. Because this is a real tmux copy mode, the program keeps running and its own keys are not simulated; to scroll inside a full-screen editor or other terminal application, use that program's own controls.

## 5. Settings

Open **设置** (Settings) at the top to:

- Change the terminal font size (8–32 px).
- Show or hide the shortcut toolbar.
- Edit the labels and actions in the two shortcut rows: terminal keys, text, Ctrl/Alt modifiers, or shortcut sequences.
- Restore the defaults.

Select **保存** (Save) after editing. Preferences stay in the current browser for the current site. They do not carry over to another browser or survive clearing the site's data. Terminal output and input drafts are not written to browser local storage. The project includes a Nerd Font, so clients do not need to install the font separately.

## 6. Phone access on a trusted local network

Use this only when you trust the network and everyone who can access the service. It **does not add login protection**, and plain HTTP does not encrypt traffic.

For a server at `192.168.1.10`, edit `.env` in the project root:

```dotenv
HOST=0.0.0.0
PORT=3000
TRUSTED_ORIGINS=http://192.168.1.10:3000
```

Restart the service, restrict firewall access to port 3000 to the trusted network as needed, then open **http://192.168.1.10:3000** on the phone. Do not configure public port forwarding or expose the internal ttyd port range.

`TRUSTED_ORIGINS` accepts exact origins or a leftmost single-label domain wildcard, as shown below. The browser URL's scheme and port must match, and no path is allowed. Separate multiple origins with commas. This is an origin check, not user authentication. With a domain name or HTTPS gateway, use the final browser-facing origin and ensure the proxy supports WebSocket and preserves the correct `Host` and `Origin`. The page does not support iframe embedding.

## 7. Tailscale access

Use your own tailnet DNS suffix, found on the DNS page of the Tailscale admin console. For example, if the device address is `server.tail1234.ts.net`, use `tail1234.ts.net` as the suffix. Replace this example with your actual suffix, and open the full device domain rather than its short MagicDNS name.

### HTTPS through Tailscale Serve

With Tailscale installed and connected on the server and client, keep the WebUI listener on loopback. Set `.env` to:

```dotenv
HOST=127.0.0.1
PORT=3000
TRUSTED_ORIGINS=https://*.tail1234.ts.net
```

Restart WebUI. To make this local service available over HTTPS within the tailnet, run on the server:

```sh
tailscale serve --bg http://127.0.0.1:3000
```

If you already use Serve, check your existing configuration before changing its routes. Follow any prompts to enable HTTPS, then open the HTTPS address shown by Serve, for example `https://server.tail1234.ts.net`. Keep access restricted with your Tailscale access policy. Do not use Funnel to make this terminal publicly accessible.

Serve handles HTTPS in front of WebUI; the application itself still listens on HTTP at `127.0.0.1:3000`. The app does not trust forwarded host/protocol headers. See the official [Tailscale Serve documentation](https://tailscale.com/docs/reference/tailscale-cli/serve) for prerequisites and administration.

### Direct HTTP through the Tailscale interface

Alternatively, bind to the server's actual Tailscale IP. For example:

```dotenv
HOST=100.64.0.10
PORT=3000
TRUSTED_ORIGINS=http://*.tail1234.ts.net:3000
```

Replace the IP and suffix, restart WebUI, and open `http://server.tail1234.ts.net:3000` from a connected client with MagicDNS enabled. The wildcard does not allow access by a short hostname or IP address; add those as separate exact origins if you need them. Tailscale encrypts network traffic, but an HTTP page still does not satisfy browser HTTPS requirements for clipboard features.

### What the wildcard allows

`https://*.tail1234.ts.net` allows exactly one DNS label before the suffix:

| Browser origin | Allowed? |
|---|---|
| `https://server.tail1234.ts.net` | Yes |
| `https://other-device.tail1234.ts.net:443` | Yes; 443 is the default HTTPS port |
| `https://tail1234.ts.net` | No |
| `https://nested.server.tail1234.ts.net` | No |
| `https://server.another-tailnet.ts.net` | No |
| `http://server.tail1234.ts.net` | No |
| `https://server.tail1234.ts.net:8443` | No; configure that port separately |

The wildcard must be at the beginning of a DNS name. A bare `*`, wildcards in the middle, wildcard ports, and wildcard IP addresses are not supported. **Do not trust all of `*.ts.net`.** A wildcard trusts origins from all matching devices, not just this server. Only configure a suffix whose devices and users you trust. Tailscale access policies and origin checks do not add application-level user permissions or a login screen.

## 8. Troubleshooting

### The page will not open

Check that `pnpm start` is still running and read errors in its terminal. The default address accepts only connections on the server itself. For another device, use an SSH tunnel or the local-network setup above. If the port is occupied, change `PORT` in `.env` and update the browser address and corresponding `TRUSTED_ORIGINS`.

### Host or origin is not allowed

Check that the address bar's scheme and port match `TRUSTED_ORIGINS`, and that the hostname either matches exactly or fits your configured single-label wildcard. Restart after editing `.env`. Do not work around the error with a bare `*`, all of `*.ts.net`, or by disabling validation.

### A session cannot be created

Check that the service account can run `ttyd`, `tmux`, and the selected shell. A custom name may be held by a current or preserved task; choose another name or leave it blank. If no ttyd ports are available, stop unneeded sessions or check the configured range in `.env` and what is using those ports.

### Sessions disappeared after restarting the service

The list lives in memory and is cleared by a restart, but old tmux tasks may still be running. On the server, as the same account that runs WebUI, inspect them with:

```sh
tmux -L ttyd-webui list-sessions
tmux -L ttyd-webui attach-session -t '=work-shell'
```

Replace `work-shell` with the actual name. If you changed `TTYD_TMUX_SOCKET`, replace `ttyd-webui` with that value. Inside tmux, press `Ctrl+B`, release it, then press `D` to detach without ending the task. Do not manage these tasks with commands that omit `-L`; those operate on the default tmux server.

### The terminal does not respond after a disconnection

Check the connection status at the top, then the server and network. Temporary failures trigger reconnect attempts. A confirmed stopped session needs **Resume**; a deleted session needs a new session. Disconnected input is never replayed automatically. After reconnecting, check whether your command actually ran.

### Phone keyboard or IME behavior differs

A browser cannot guarantee control over the system keyboard. Tap the terminal or Show keyboard again; for longer text, use the Tools text input. Physical-device acceptance on Android Chrome and iOS Safari is still pending. Automated browser tests do not establish compatibility with every phone or input method.

## For developers and operators

Use `pnpm dev` for development, at **http://127.0.0.1:5173** by default rather than the production port 3000. For deployment, use the build and start steps above. See the [README](../README.md) for all test commands, the source layout, and licensing details.

This project uses [AGPL-3.0](../LICENSE). Operators should offer users the complete source corresponding to the deployed version. A modified deployment cannot offer only a link to a version that lacks those modifications. See [Third-party notices](../THIRD_PARTY_NOTICES.md) for reused code and font licenses.
