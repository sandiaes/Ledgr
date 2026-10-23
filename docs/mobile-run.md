# Running the Android app (Expo Go and APK)

How to run `apps/mobile` on your phone during development (Expo Go), what to do when the
company Wi-Fi gets in the way, and how to build an installable APK with EAS. All commands
are for **Git Bash** on Windows, run from the repository folder unless a step says
`cd apps/mobile`. Nothing here needs admin rights.

The app uses only the Supabase **anon** key. It refuses to start if the anon slot holds a
secret or service-role key, or if any `EXPO_PUBLIC_…` service-role, secret or provider key
is set, and says which variable is wrong (never its value). Only `EXPO_PUBLIC_` variables
are built into the app, so keys without that prefix never reach the phone.

## 0. Once: tools and certificates

- **Node.js 22 LTS** (22.15 or newer) from nodejs.org, and **Git for Windows** (Git Bash).
- **pnpm**: `corepack enable` (the repo pins the pnpm version).
- **Behind the company TLS inspection** (errors like `unable to get local issuer
certificate` or `SELF_SIGNED_CERT_IN_CHAIN` from `pnpm`, `npx expo` or `eas`): make Node
  trust the company root certificate, as in `docs/prices.md` §0. Never turn verification
  off (`NODE_TLS_REJECT_UNAUTHORIZED=0`).
  ```bash
  export NODE_OPTIONS=--use-system-ca        # Node 22.15+: use the Windows certificate store
  ```
  If that is not enough, export the root once (`certmgr.msc` → Trusted Root Certification
  Authorities → Certificates → your company's root → All Tasks → Export → Base-64 X.509,
  save as `~/corp-root.cer`) and use:
  ```bash
  export NODE_EXTRA_CA_CERTS=~/corp-root.cer
  ```
  Put the line in `~/.bashrc` to keep it.
- **Two-factor sign-in must already be set up** in the desktop app (README, "Desktop: sign
  in and TOTP enrollment"). The phone never enrolls a factor; without one it shows "Set up
  two-factor sign-in first".

## 1. Configure

```bash
git pull
pnpm install
cp apps/mobile/.env.example apps/mobile/.env
notepad apps/mobile/.env
```

Fill in the same two values as the desktop app (Supabase Dashboard → Project Settings →
API Keys):

```
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<the anon / publishable key>
```

The file is git-ignored. Do not put any other key in it.

## 2. Expo Go on the phone

Install **Expo Go** from the Play Store. The app is on **Expo SDK 58**, and Expo Go opens
only projects of its own SDK. If Expo Go says _"Project is incompatible with this version
of Expo Go"_, the store version is not on SDK 58 yet: connect the phone by USB (step 4B) and
run `npx expo start --android`, which offers to install the matching Expo Go, or download
the SDK 58 Expo Go APK from https://expo.dev/go and install it.

## 3. Run it (same Wi-Fi as the PC)

```bash
cd apps/mobile
npx expo start
```

In Expo Go tap **Scan QR code** and scan the QR code in the terminal. The first time,
Windows Firewall asks about Node.js: allow it on **Private networks**. Press `r` in the
terminal to reload, `Ctrl+C` to stop.

What you should see: Sign in → **Two-factor code** (every sign-in, a 6-digit code from your
authenticator) → Dashboard. On the first sign-in the app lock is turned on if the phone has
a screen lock or fingerprint; from then on Ledgr asks for it when it opens and after 1
minute in the background (More → Security to change it). Screenshots are blocked by default
(More → Block screenshots). The eye icon at the top hides every amount.

After changing `.env`, restart with `npx expo start --clear` (the values are built into the
bundle).

## 4. When the phone cannot reach the PC (company Wi-Fi or laptop)

Signs: Expo Go spins on the loading screen and then shows _"Uncaught Error:
java.io.IOException: Failed to download remote update"_, _"Could not connect to the
server"_ or a timeout, and the terminal never prints `Android Bundling …`. The phone cannot
reach the PC's port 8081. On a company-managed laptop this happens on your home Wi-Fi too:
its firewall blocks incoming connections; use the USB cable (B).

Check it first: in the terminal, under the QR code, Expo prints `Metro waiting on
exp://<address>:8081`. On the phone, open `http://<address>:8081/status` in Chrome.

- **It shows `packager-status:running`**: the network is fine; reload in Expo Go (shake the
  phone → Reload, or close Expo Go and scan again).
- **The address is not your PC's Wi-Fi address** (compare with `ipconfig` → "Wireless LAN
  adapter Wi-Fi" → IPv4 Address; company laptops often have VPN, Hyper-V or WSL adapters,
  and Expo can pick one of them): start Expo with the right one,
  ```bash
  REACT_NATIVE_PACKAGER_HOSTNAME=<Wi-Fi IPv4 address> npx expo start
  ```
- **The page does not load at all**: Windows Firewall or the company Wi-Fi is in the way.
  On a home network marked Private, allow Node.js there (Windows Security → Firewall &
  network protection → Allow an app through firewall → Node.js → Private). On the company
  network (usually marked Public, and often keeping devices from reaching each other) do
  not open the firewall: use one of the three ways below, the USB cable (B) being the most
  reliable.

### A. Tunnel

Since SDK 58, `--tunnel` uses Expo's own tunnel, which needs you logged in to your
(free) Expo account; you need the account for the APK anyway (step 5):

```bash
cd apps/mobile
npx expo login                      # once; sign up at https://expo.dev first
npx expo start --tunnel
```

Without an account, use ngrok instead: `npx expo start --tunnel ngrok` (the first time it
asks to install `@expo/ngrok`: answer yes). Either way, scan the new QR code. The company
proxy may block the tunnel service as well; then use B.

### B. USB cable (`adb reverse`)

1. Phone: Settings → About phone → tap **Build number** 7 times; then Settings → System →
   Developer options → turn on **USB debugging**.
2. PC: download **Android SDK Platform-Tools for Windows**
   (https://developer.android.com/tools/releases/platform-tools), unzip it to
   `C:\platform-tools`, and in Git Bash:
   ```bash
   export PATH="$PATH:/c/platform-tools"
   ```
3. Connect the phone by USB, accept **Allow USB debugging** on the phone, then:

   ```bash
   adb devices                       # must list the phone as "device" (its serial number)
   adb reverse tcp:8081 tcp:8081     # the phone's port 8081 now reaches the PC
   adb reverse --list                # check: <serial> tcp:8081 tcp:8081
   cd apps/mobile
   npx expo start
   ```

   Then in Expo Go tap **Enter URL manually** and open `exp://127.0.0.1:8081`. Do not scan
   the QR code or press `a`: those use the PC's Wi-Fi address, which is what is blocked.
   Check first, if you like: `http://127.0.0.1:8081/status` in Chrome on the phone must
   show `packager-status:running`.

   Do **not** add `--localhost` here: on Windows it makes Metro listen on IPv6 `::1` only,
   while `adb reverse` connects to IPv4 `127.0.0.1`, so the phone gets _"Failed to download
   remote update"_ although the PC's own browser reaches Metro.

   Run `adb reverse` again after you unplug the cable. The warnings _"Failed to resolve the
   Android SDK path"_ are harmless (Expo then uses the `adb` on your PATH); with
   `export ANDROID_HOME=/c` they go away, since Expo looks for `platform-tools\adb` there.

### C. Phone hotspot

Connect the PC to the phone's hotspot and use step 3 as is. The bundle is a few MB.

**If the app opens but shows "Cannot check your sign-in (…)" or "Could not load the
dashboard (…)" on the company Wi-Fi**, the network is intercepting the phone's HTTPS to
Supabase. Switch the phone to mobile data.

## 5. An installable APK with EAS

EAS builds the APK in Expo's cloud; you need a free account at https://expo.dev. The
`preview` profile in `apps/mobile/eas.json` builds an APK (not a Play Store bundle).

1. Install the CLI and sign in (with the certificate settings from step 0 in the same
   shell):
   ```bash
   npm install -g eas-cli
   cd apps/mobile
   eas login
   ```
2. Link the project once. This creates it on expo.dev and writes its id into
   `apps/mobile/app.json`; commit that change.
   ```bash
   eas init
   ```
3. Give EAS the two public values. Your `.env` is git-ignored and is **not** uploaded, so
   the build reads them from EAS environment variables:
   ```bash
   eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value "https://<project-ref>.supabase.co" --visibility plaintext
   eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<anon key>" --visibility plaintext
   ```
   `EXPO_PUBLIC_` values are part of the app anyway, so "plaintext" is right. Never create
   a service-role or provider key variable there.
4. Build:
   ```bash
   eas build --platform android --profile preview
   ```
   It uploads the repository (the whole pnpm workspace) and builds in the cloud, typically
   10–20 minutes. At the end it prints a link and a QR code: open it on the phone, download
   the APK and install it (Android asks you to allow installs from your browser once).
5. For a new version later: `git pull`, raise `version` in `apps/mobile/app.json` (and add
   `"versionCode": 2`, 3, … under `android` so it installs over the old one), and run step 4
   again.

**TLS-certificate workaround for EAS.** `eas` is a Node program, so behind the company TLS
inspection `eas login`, `eas init` and the upload in `eas build` fail with `unable to get
local issuer certificate` / `self-signed certificate in certificate chain` until Node
trusts the company root: `export NODE_OPTIONS=--use-system-ca`, or
`export NODE_EXTRA_CA_CERTS=~/corp-root.cer` (step 0), in the same Git Bash window before
running `eas`. The build itself runs on Expo's servers, outside the company network. If the
proxy blocks expo.dev altogether, run the `eas` commands on the phone's hotspot.

## Quick reference

```bash
# every time, from the repository folder
git pull && pnpm install
cd apps/mobile
npx expo start                      # same Wi-Fi: scan the QR code with Expo Go
npx expo start --tunnel             # company Wi-Fi: through a tunnel (after npx expo login)
adb reverse tcp:8081 tcp:8081 && npx expo start   # USB cable, then exp://127.0.0.1:8081 in Expo Go

# installable APK
eas build --platform android --profile preview
```

## Troubleshooting

| Message                                                          | What to do                                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| "java.io.IOException: Failed to download remote update"          | The phone cannot reach the PC: step 4 (check `http://<address>:8081/status` on the phone first).                                                 |
| `npx expo start` stops with "Cannot find module 'async-limiter'" | Leftovers from the old SDK 52 install: `rm -rf node_modules apps/*/node_modules packages/*/node_modules scripts/*/node_modules && pnpm install`. |
| "Cannot start: EXPO_PUBLIC_… is set / is not set"                | Fix `apps/mobile/.env` (or the EAS variables), then `npx expo start --clear`.                                                                    |
| "Project is incompatible with this version of Expo Go"           | Install the SDK 58 Expo Go (step 2).                                                                                                             |
| "Set up two-factor sign-in first"                                | Enroll an authenticator in the desktop app, then sign in again.                                                                                  |
| "That code did not work"                                         | Use the current code; check the phone's clock is set automatically.                                                                              |
| App lock switch is greyed out                                    | Set a screen lock (PIN, pattern or fingerprint) on the phone.                                                                                    |
| "live prices unavailable" under the total                        | value-now did not answer; the dashboard uses the latest stored quotes and closes.                                                                |
| "Figures do not reconcile: … value-now … differs"                | The deployed functions run an older core: redeploy them (`docs/prices.md`, "After a core change").                                               |
| Screenshots come out black                                       | That is screenshot blocking; turn it off in More if you need one.                                                                                |
