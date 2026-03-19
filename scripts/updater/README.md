# Upgrade Manifest Generator

This folder contains the helper script used to generate `.seajelly/upgrade-manifest.json`.

SEAJelly's one-click updater does not replay git commits one by one.
It applies a release manifest that describes the final file changes from one release tag to the next.

This script helps generate that manifest from your local git history.

## What it does

Given a previous release tag and a target ref, it will:

1. compare the two refs with git
2. detect added, modified, and deleted files
3. convert text diffs into the V4A patch format used by SEAJelly's patch harness
4. capture the old blob SHA for update and delete safety checks
5. write `.seajelly/upgrade-manifest.json`

## The simplest future-release workflow

Assume:

- current public release is `v0.1.0`
- you are about to publish `v0.1.1`

### Step 1: generate the first draft manifest

```bash
pnpm tsx scripts/updater/generate-upgrade-manifest.ts \
  --from v0.1.0 \
  --release-tag v0.1.1
```

This writes:

```text
.seajelly/upgrade-manifest.json
```

### Step 2: review the manifest

Check:

- `previous_supported_tag` is correct
- `patches` only include files you want to manage through one-click upgrades
- `required_env_keys` is set if the new release needs extra env vars
- `db.mode` is correct

### Step 3: commit the release prep

```bash
git add .seajelly/upgrade-manifest.json
git commit -m "release: prepare v0.1.1"
```

### Step 4: make `release_commit_sha` exact

Because the manifest itself is usually committed as part of the release prep commit, the most accurate flow is:

```bash
pnpm tsx scripts/updater/generate-upgrade-manifest.ts \
  --from v0.1.0 \
  --release-tag v0.1.1 \
  --release-commit-sha "$(git rev-parse HEAD)"
```

Then amend:

```bash
git add .seajelly/upgrade-manifest.json
git commit --amend --no-edit
```

### Step 5: push and create the release

```bash
git push origin main
git tag v0.1.1
git push origin v0.1.1
```

Then go to GitHub and create the `v0.1.1` Release.

## Initial release

For the very first public release, use `--initial-release`:

```bash
pnpm tsx scripts/updater/generate-upgrade-manifest.ts \
  --initial-release \
  --release-tag v0.1.0
```

That generates a baseline manifest with:

- no patches
- `previous_supported_tag` equal to the same release tag

## Database changes

If the release includes a database change, create a SQL file first, for example:

```text
.seajelly/migrations/v0.1.1.sql
```

Then run:

```bash
pnpm tsx scripts/updater/generate-upgrade-manifest.ts \
  --from v0.1.0 \
  --release-tag v0.1.1 \
  --db-mode manual_apply \
  --db-sql-path .seajelly/migrations/v0.1.1.sql \
  --db-summary "Create update_runs table"
```

## Required environment variables

If the release needs new runtime env keys:

```bash
pnpm tsx scripts/updater/generate-upgrade-manifest.ts \
  --from v0.1.0 \
  --release-tag v0.1.1 \
  --required-env NEXT_PUBLIC_APP_URL,CRON_SECRET
```

## Notes source

The script chooses notes in this order:

1. `--notes-file <path>` if provided
2. `release-notes/<release-tag>.md` if it exists
3. fallback git commit subjects between `from..to`

## Helpful options

```bash
--from <ref>
--to <ref>
--release-tag <tag>
--previous-supported-tag <tag>
--release-commit-sha <sha>
--commit-message <message>
--db-mode <none|manual_apply>
--db-sql-path <path>
--db-summary <text>
--required-env <a,b,c>
--notes-file <path>
--manual-review
--destructive-db
--initial-release
--output <path>
--stdout
```

## Important limitations

- This script only supports text patches.
- It intentionally ignores `.seajelly/upgrade-manifest.json` itself when building patch entries.
- It does not decide whether a file should be managed by one-click upgrades; you still need to review the output.
- For now, release discipline still matters more than automation. Keep releases small and forward-compatible.
