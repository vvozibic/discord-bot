# Discord SDK dependency note

The pinned official Embedded App SDK 2.5.0 bundles Zod 3 and also declares it as
a dependency. A full build dependency audit currently reports
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
The SDK has no compatible upstream release fixing that audit finding.

The Activity installs `discord-message-guard.js` before constructing the SDK.
Only messages from its actual Discord parent and allowed Discord origins can
reach SDK validation. Collection sizes, nesting, aggregate nodes and string
content are bounded first, preventing unbounded per-element validation work.
Tests cover trusted replies, foreign senders, oversized payloads and cleanup.

The server uses Node built-ins and repository modules only; build dependencies
and `node_modules` are not copied into the production image. The compiled
frontend still contains the SDK, so its guard must be retained and reevaluated
when upgrading the SDK. A clean production dependency audit does not mean the
upstream frontend advisory has disappeared.
