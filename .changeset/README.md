# Changesets

Use Changesets for public package release notes and versioning.

When a change should be released to NPM, run:

```bash
pnpm changeset
```

Select `@lensflare/effect`, choose the correct semver bump, and write a short release note. The NPM release workflow will create a version PR on `main`; merging that PR publishes the package.
