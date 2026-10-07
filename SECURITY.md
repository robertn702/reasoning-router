# Security policy

reasoning-router is alpha software, and nothing is published to npm yet.
Only the latest commit on `main` is supported.

## Reporting a vulnerability

Do not open a public issue. A private reporting route has not been set up yet
and will be listed here before the first public release.

## Scope

The standalone proxy is meant for a single trusted machine. It listens on
loopback only, rejects requests whose `Host` is not the proxy's own loopback
address and port, and has no caller authentication. Its
[trust model](packages/proxy/README.md#trust-model) describes what that does
and does not protect.
