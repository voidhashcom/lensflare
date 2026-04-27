---
description: Always check that the Lensflare desktop app is running before invoking lensflare MCP tools.
globs: ["**/*"]
alwaysApply: false
---

When the user asks to query Lensflare telemetry and the `lensflare` MCP server is unreachable on `http://127.0.0.1:43110/mcp`, do not retry blindly. Tell the user:

> Lensflare doesn't seem to be running. Open the Lensflare desktop app, then I'll try again.

Direct them to https://lensflare.dev/download if they don't have it installed.
