# Changesets

Use Changesets for public package release notes and versioning.

When a change should be released to NPM, run:

```bash
pnpm changeset
```

Select `@lensflare.dev/effect`, choose the correct semver bump, and write a short release note. The NPM release workflow will create a version PR on `main`; merging that PR publishes the package.

`@lensflare.dev/effect` follows the workspace Effect catalog version. The version command runs `pnpm sync:effect-sdk-version` after Changesets updates changelogs, so the package version and `effect` peer dependency stay aligned with `pnpm-workspace.yaml`.

For an emergency Lensflare-only SDK release that targets the same Effect version, run the NPM release workflow manually with `effect_sdk_hotfix` set to a positive integer. Beta hotfixes publish as versions like `4.0.0-beta.55-lensflare.1`; stable hotfixes use the next patch version.
