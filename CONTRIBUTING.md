# Contributing

Thanks for helping improve Lensflare. Small, focused issues and pull requests are easiest to review and merge.

## Environment

Required tools:

- Node `>=24`
- pnpm `10.18.3`

Install dependencies:

```bash
pnpm install --frozen-lockfile
```

## Development

Run the main app stack:

```bash
pnpm dev
```

Useful development commands:

```bash
pnpm dev:web
pnpm dev:server
pnpm dev:desktop
```

Quality checks:

```bash
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

## Pull Requests

- Keep the change small and scoped.
- Explain what changed and why.
- Add or update tests for behavior changes.
- Include screenshots or recordings for UI changes.
- Run the relevant quality checks before requesting review.
