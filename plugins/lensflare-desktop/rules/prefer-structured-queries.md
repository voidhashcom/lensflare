---
description: When generating Lensflare queries, prefer structured field comparisons over free-text search.
globs: ["**/*"]
alwaysApply: false
---

The Lensflare query language supports both free-text terms and structured field comparisons. Prefer the structured form — it produces fewer false positives and is easier to refine. Use free-text only when no structured field fits.

Field cheat-sheet: `level`, `status`, `serviceName`, `name`, `message`, `traceId`, `spanId`, `durationUs`. Attributes use `attributes.<dotted.key>`. Operators include `=`, `!=`, `contains`, `~=` (regex), `>=`, `in`, `exists`.
