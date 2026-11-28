# OnlyRag braces security fork

Private, source-controlled fork of MIT-licensed `braces` 3.0.3. This is a local
patch, not an upstream release. `UPSTREAM.json` records the exact source tarball,
registry integrity and SHA-256 of each original file; `LICENSE` is unchanged.

The root dependency pins this directory as `braces`, version `3.0.4+onlyrag.1`.
The build metadata identifies the private fork; this is not a published upstream
3.0.4 release. Its version satisfies micromatch's existing compatible range so
the lock deduplicates every request to the patched source without a file-path
override. `.npmrc` enables `install-links` so npm installs actual package bytes
and transitive dependencies rather than a development-directory link.
Keep this directory with the application sources and dependency closure.
Knip's single `braces` ignore marks this npm configuration anchor, whose real
use through depcheck/micromatch is exercised by the remediation tests.

## Patch

For [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm):

- Parser nesting is limited before pushing brace or parenthesis frames.
- Compile, expand and stringify validate ASTs with an iterative traversal before
  entering upstream recursive walkers, including caller-supplied ASTs.
- AST depth is capped at 64 edges and visited nodes at 131072. Depth rejection
  is a `SyntaxError` with code `ERR_BRACES_DEPTH`; callers cannot raise the cap.
- Existing APIs, range limits, normal pattern behavior and the `fill-range`
  dependency are retained. This patch addresses recursive stack exhaustion;
  it does not claim to bound every possible expansion's output size.

Upstream has no published patched version as of 2026-10-16. OnlyRag maintains
this fork until an upstream implementation can pass the same regression checks.
Run `node scripts/e2e/dependencySprintfExposure.mjs` and
`npx vitest run scripts/dependencySecurityRemediation.test.mts` from the repository
root. The native scanner/ASAR check is `node scripts/e2e/dependencyScannerIsolation.mjs`
after `npm run build`.
