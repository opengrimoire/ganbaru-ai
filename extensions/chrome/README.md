# GanbaruAI Chrome extension

This is the Chrome and Chromium-based browser implementation of the procrastination stopper.

During development it runs as an unpacked extension and talks to the local native messaging host named `org.opengrimoire.ganbaruai.stopper`.

## What gets installed

There are two local pieces:

- The extension folder: `extensions/chrome`. This is what Chrome, Chromium, Brave, or Edge loads in developer mode.
- The native host binary: `target/debug/ganbaruai-native-messaging`. This small local program lets the browser ask GanbaruAI whether a page should be blocked.

The browser also needs a native host manifest that contains the extension id. That id is created by the browser after the unpacked extension is loaded.

## First install in a Chromium-based browser

The flow is the same for Chrome, Chromium, Brave, and Edge:

1. Build the native host.
2. Load `extensions/chrome` as an unpacked extension.
3. Copy the browser-generated extension id.
4. Register the native host for that browser.

For Brave, from the repo root, run:

```sh
pnpm -w run setup:brave-extension
```

The command builds the native host and opens `brave://extensions`.

In Brave:

1. Enable developer mode.
2. Click **Load unpacked**.
3. Select this folder:

   ```text
   extensions/chrome
   ```

4. Copy the extension id from the GanbaruAI extension card.

Back in the repo root, register the native host with that id:

```sh
node apps/client/scripts/install-chrome-native-host.mjs <extension-id> brave
```

For another Chromium-based browser, open its extensions page manually and use the matching browser argument:

```sh
node apps/client/scripts/install-chrome-native-host.mjs <extension-id> <chrome|chromium|brave|edge>
```

Then start the app:

```sh
cd apps/client
pnpm tauri dev
```

Open GanbaruAI, go to Settings > Stopper, enable blocking, and add hosts such as:

```text
reddit.com
youtube.com
```

Start a Pomodoro focus phase and open one of those sites in the browser.

## Daily development loop

You do not need to remove the extension for normal changes.

- App UI changes usually hot reload while `pnpm tauri dev` is running.
- Rust command changes need `pnpm tauri dev` stopped with `Ctrl+C` and started again.
- Native host changes need:

  ```sh
  pnpm -w run build:native-host
  ```

- Extension HTML, CSS, JS, manifest, or icon changes need the reload button on the GanbaruAI card in the browser's extensions page.
- Removing and adding the unpacked extension gives it a new id. If that happens, run the native host registration command again with the new id.

## Smoke test checklist

1. Start GanbaruAI with `pnpm tauri dev`.
2. Confirm the extension popup says connected.
3. In GanbaruAI, open Settings > Stopper.
4. Enable blocking and add `reddit.com` to blocked hosts.
5. Start a Pomodoro focus phase.
6. Open `https://reddit.com`.
7. Confirm the browser redirects to the GanbaruAI block page.
8. Click the extension popup and confirm the last blocked host is shown.
9. Stop the Pomodoro session and confirm the site is allowed again.

## Manual install

1. Build the native host:

   ```sh
   pnpm -w run build:native-host
   ```

2. Open the browser's extensions page, enable developer mode, and load this folder as an unpacked extension:

   ```text
   extensions/chrome
   ```

3. Copy the extension id from the browser.

4. Register the native messaging host for your browser:

   ```sh
   node apps/client/scripts/install-chrome-native-host.mjs <extension-id>
   ```

   Add `chromium`, `brave`, or `edge` as the second argument when testing in those browsers.

5. Start GanbaruAI, open Settings, then Stopper. Enable blocking and add blocked hosts such as:

   ```text
   reddit.com
   youtube.com
   ```

6. Start a Pomodoro focus phase and open one of the blocked sites.

The extension defaults to fail open. If the native host is not registered, Stopper is disabled, no focus phase is active, or the app has not written a fresh runtime state, it will not block pages.

## Troubleshooting

**The popup says disconnected.**

Check that the native host was registered with the exact extension id shown by the browser. The id is 32 characters and uses only letters from `a` to `p`.

```sh
node apps/client/scripts/install-chrome-native-host.mjs <extension-id> <chrome|chromium|brave|edge>
```

**The extension is loaded but never blocks.**

Check that GanbaruAI is running, Settings > Stopper is enabled, the blocked host is saved without `https://`, and a Pomodoro focus phase is active.

**The app window opens but looks blank.**

Stop `pnpm tauri dev` with `Ctrl+C` and start it again. If this happens after a frontend dependency changes, also reload the app window.

**A changed extension file does not show up.**

Click the reload button on the GanbaruAI extension card in the browser's extensions page.
