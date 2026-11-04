# Contributing

Thanks for your interest in Hymnix.

## Before you start

- Search existing issues first.
- For non-trivial features, open an issue describing the problem before sending a large PR.
- Security problems: follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development setup

Requirements: Windows 10/11, Python 3.11+, Ollama with at least one model.

```powershell
git clone https://github.com/YOUR-ACCOUNT/hymnix-ai-server.git
cd hymnix-ai-server
pip install -r client/requirements.txt
python server/hymnix_main.py
python client/hymnix_client_app.py
```

## Code style

- Keep the gateway dependency-free (Python standard library only).
- Do not add third-party packages under server/ without discussion.
- UI code lives in server/hymnix_main.py; gateway logic in server/gateway_core.py.
- Run python -m py_compile on changed files before committing.

## Pull requests

1. One logical change per PR.
2. Update docs when behaviour or configuration changes.
3. Add a CHANGELOG.md entry under Unreleased.
4. Describe what you tested (model, client, OS).

## Commit messages

Short imperative subjects, for example:

```text
gateway: keep system prompts when trimming context
client: remember window geometry
docs: clarify tunnel quota behaviour
```
