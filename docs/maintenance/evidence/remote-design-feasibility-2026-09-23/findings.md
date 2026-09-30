# Remote design feasibility — Tailscale and iPhone notifications (2026-09-23)

Research date: 2026-09-23. This bounded review covers the selected personal-use route
(Mac at home, iPhone/web away from home). It does not install Tailscale, enroll a device,
configure a tailnet, send a notification, or run a live cellular test.

## Verified Tailscale facts

- **Serve** proxies a local HTTP service to devices in the same tailnet. It requires HTTPS
  enabled for the tailnet and the tailnet's `device-name.tailnet-name.ts.net` DNS name; normal
  ACLs still apply. The documented reverse-proxy form is `tailscale serve 3000` (targeting
  `http://127.0.0.1:3000`). See [Serve](https://tailscale.com/docs/features/tailscale-serve),
  [Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve).
- Serve adds Tailscale identity headers to a backend for tailnet traffic, but recommends that
  the backend listen only on localhost so callers cannot spoof those headers. Funnel is public
  internet access and does not add identity headers; it is not the selected default. See
  [Serve identity headers](https://tailscale.com/docs/features/tailscale-serve#identity-headers)
  and [Funnel](https://tailscale.com/docs/features/tailscale-funnel).
- On macOS, the App Store and Standalone variants can Serve **ports**; serving files/directories
  requires the open-source CLI variant. Tailscale recommends the Standalone app. See
  [macOS variants](https://tailscale.com/docs/concepts/macos-variants) and the [Serve CLI
  macOS limitation](https://tailscale.com/docs/reference/tailscale-cli/serve#use-https-and-http-servers).
- The current Personal plan is $0 indefinitely for personal/non-commercial use, with unlimited
  user devices and up to six users. This makes the Mac + personal iPhone route free at the
  Tailscale subscription level, subject to current plan terms. See [Tailscale pricing](https://tailscale.com/pricing).

## CEDIA compatibility finding

The existing CEDIA host server is deliberately a native loopback API: it listens on
`127.0.0.1`, accepts only the listener's `127.0.0.1:<port>` or `localhost:<port>` Host, and
rejects every request carrying an `Origin` header. This is visible in
[`apps/host/src/server.ts`](../../../../apps/host/src/server.ts) (lines 55–62, 89–92), and the
behavior is locked by [`apps/host/test/http.test.ts`](../../../../apps/host/test/http.test.ts)
(browser-origin and Host rejection tests). Therefore a Tailscale Serve proxy can reach the
loopback port at the network layer, but the existing API is **not yet a browser/web gateway**.

The safe implementation route is an explicit CEDIA remote gateway: Serve forwards the tailnet
HTTPS URL to a localhost gateway that serves the remote web surface and proxies only the approved
`/v1` API. The gateway must validate the paired CEDIA device token and, if used, the trusted
Tailscale identity header; the existing native loopback API checks should remain intact. Do not
open the host listener on the LAN or simply remove the Origin/Host checks. This is a design
finding, not an implemented change.

The current iOS seam is relay-based (`apps/ios/src/core/relay.ts`): it connects to the paired
CEDIA relay offer and sends the CEDIA API over the encrypted channel. A future Tailscale mode can
use the same API client through the gateway, but no physical iPhone or cellular path has been
verified here.

## Notification boundary

- Apple local notifications are created by the app and can be delivered while the app is in the
  background or not running after the app schedules them. They do not provide a channel for a
  Mac at home to wake an unrelated iPhone. See [Scheduling a local
  notification](https://developer.apple.com/documentation/usernotifications/scheduling-a-notification-locally-from-your-app).
- Remote notifications require a provider server, an APNs device token, Push Notifications
  enabled for the App ID, and the APNs provider connection. See [Registering with
  APNs](https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns)
  and [Setting up a remote notification server](https://developer.apple.com/documentation/usernotifications/setting-up-a-remote-notification-server).
- Apple states that available capabilities depend on program membership and identifies the Apple
  Developer Program as a paid program; consequently, reliable lock-screen completion/error
  notifications through APNs are a later paid/developer-account gate. Local in-app/foreground
  status notifications can remain in the free-first scope. See [supported iOS
  capabilities](https://developer.apple.com/help/account/reference/supported-capabilities-ios).

## Plan implication

Select **Tailscale Serve + CEDIA remote gateway** as the personal-use default. Preserve the existing Paseo source and enrollment records for migration analysis, but keep
that route inactive for the selected mode. It is not an automatic fallback; another transport
requires an explicit future direction change. Mark gateway implementation, device pairing/revocation, HTTPS
enablement, and real Mac-to-iPhone cellular verification as open work. Mark APNs as optional and
paid-gated; do not promise remote lock-screen notifications from local notifications alone.
