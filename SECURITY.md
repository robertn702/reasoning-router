# Security policy

Please report suspected vulnerabilities privately using GitHub's
[Report a vulnerability](https://github.com/robertn702/reasoning-router/security/advisories/new)
form. Include a minimal reproduction, affected versions, and the potential
impact; remove API keys, prompts, and other private data from examples.

Do not open a public issue for an unpatched vulnerability. Maintainers will
coordinate disclosure and a fix through the security advisory.

reasoning-router is alpha software. Only the latest published version of each
package and the latest commit on `main` are supported.

## Scope

The standalone proxy is meant for a single trusted machine. It listens on
loopback only, rejects requests whose `Host` is not the proxy's own loopback
address and port, and has no caller authentication. Its
[trust model](packages/proxy/README.md#trust-model) describes what that does
and does not protect.
