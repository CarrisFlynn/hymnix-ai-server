# Security Policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's *Security -> Report a vulnerability* feature on this repository,
or email shayhymnix@gmail.com (PGP not required, but please avoid public disclosure).

Include: affected version or commit, steps to reproduce, expected vs actual behaviour, and an optional suggested fix.

You should receive a response within 7 days.

## Scope

In scope: gateway authentication bypass, path traversal in admin endpoints, remote code execution or file writes outside the data directory, secrets printed in logs or errors.

Out of scope: operator misconfiguration (for example sharing the admin key), vulnerabilities in Ollama, Cloudflare or third-party clients, denial of service caused by underpowered hardware.
