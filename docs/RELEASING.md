# Releasing a new version

Every version is published as a GitHub release with a zip and a tar.gz of the server, the way MCGalaxy does
it. The release workflow (`.github/workflows/release.yml`) does the work when a new version reaches `master`.

## Version numbers

MCScript uses [semantic versioning](https://semver.org):

- **patch** (2.0.1): bug fixes only.
- **minor** (2.1.0): new commands, plugins or settings that don't break anything.
- **major** (3.0.0): changes that break plugins or need server owners to change their config.

Pre-releases use a suffix, for example `2.1.0-beta.1`. They are marked as pre-releases on GitHub and the
update check doesn't announce them to servers on a final release.

## Steps

1. Make sure CI is green on `master`.
2. On a new branch, rename the `## Unreleased` section of `CHANGELOG.md` to the new version and date, for
   example `## 2.2.0 (2026-11-02)`, and start a new empty `## Unreleased` section above it.
3. Update the version in `package.json` and `package-lock.json`:
   ```bash
   npm version 2.2.0 --no-git-tag-version
   ```
4. Commit both files as `Release 2.2.0`, open a pull request and merge it once CI passes.

That's it. When `master` gets a `package.json` version that has no release yet, the release workflow runs
the lint and tests, creates the `v2.2.0` tag on that commit, builds `MCScript-v2.2.0.zip` and `.tar.gz`
(without the tests and GitHub files) and publishes the release with the changelog section as its notes. The
release appears under **Releases** a couple of minutes after the merge. Merges that don't change the version
don't publish anything.

Pushing a `v*` tag by hand also works: the workflow then releases that tag, as long as `package.json` has the
same version.

If the workflow fails, fix the cause and merge the fix; the next push to `master` tries again, since that
version still has no release.

Servers running an older version print a message in the console with a link to the new release when they start
(unless `checkForUpdates` is off).
