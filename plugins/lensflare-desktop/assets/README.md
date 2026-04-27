# Plugin assets

Static assets referenced by the per-harness `plugin.json` manifests.

| File                          | Used by                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| `logo.svg`                    | `.cursor-plugin/plugin.json` and `.codex-plugin/plugin.json`   |
| `screenshot-traces.png`       | `.codex-plugin/plugin.json` (Codex marketplace screenshot row) |
| `screenshot-query.png`        | `.codex-plugin/plugin.json`                                    |
| `screenshot-trace-detail.png` | `.codex-plugin/plugin.json`                                    |

The screenshot PNGs are marketplace assets for the Codex listing. Keep these files present so plugin validation catches stale manifest references.
