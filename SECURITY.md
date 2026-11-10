# Security Policy

## Supported versions

Only the latest commit on the `master` branch is supported.

## Reporting a vulnerability

Please do not open a public issue for security problems.

Use GitHub's private vulnerability reporting: open the **Security** tab of this repository and choose **Report a vulnerability**. Include the affected component (Electron Main, Preload, Renderer, Python Sidecar or coding agent), reproduction steps and the impact you observed. Remove document contents, local paths and credentials from any evidence you attach.

You can expect an acknowledgement within a few days. Confirmed issues are fixed on `master` and disclosed after a fix is available.

## Scope notes

- The Renderer has no direct Node.js or filesystem access; Main validates requests through the typed IPC contract.
- Ollama is local by default; a remote endpoint can be configured and then receives model requests. The coding agent can run permitted commands in a workspace and may use network tools depending on the active network profile.
- Do not place credentials in `.env.example` or in committed files.
- Dependencies are monitored with Dependabot and secret scanning with push protection.
