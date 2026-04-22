<!-- effect-solutions:start -->
## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `~/.local/share/effect-solutions/effect` for real implementations

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.
<!-- effect-solutions:end -->

## Local Effect Source

The Effect v4 repository is cloned to `~/.local/share/effect-solutions/effect` for reference.
Use this to explore APIs, find usage examples, and understand implementation
details when the documentation isn't enough.

## TSRX

For UI work in this repo, use TSRX and `.tsrx` files instead of JSX/TSX where
you would normally create React components.

- Prefer `export component Name(...) { ... }` over `function` components that
  return JSX.
- Keep markup and scoped styles in TSRX component bodies rather than separate
  JSX + CSS patterns when adding or rewriting UI.
- Treat `https://tsrx.dev/llms.txt` as the primary reference for TSRX syntax,
  control flow, scoped styles, and other language rules before making TSRX
  changes.
