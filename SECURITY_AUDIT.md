# Security and privacy audit

Scope: the entire exported folder `israel-engineering-job-scanner/`. The concern is a public
release, so this checks for anything that should not leave a private environment: credentials,
identifiers, personal data, and hidden outbound traffic.

## Method

1. Listed every file in the folder and reviewed its purpose.
2. Searched all `.ts`, `.json` and `.md` files for credential-shaped strings:
   `api key`, `secret`, `token`, `password`, `bearer`, `authorization`, `cookie`, `session id`,
   `client secret`.
3. Searched for identifiers of the environment this code came from: platform names, provider
   names, entity/table names, internal service names, absolute app URLs.
4. Searched for personal data: email addresses, Israeli mobile numbers, personal names.
5. Extracted every hardcoded hostname and confirmed each one is a public career-site endpoint.
6. Type-checked the whole package with TypeScript in strict mode, then bundled it, then ran the CLI
   end to end against live public career sites.

## Findings

**Credentials: none.** The string matches for `token` are the Greenhouse / Lever / Comeet board
tokens, which are the public company identifiers that appear in the careers URL itself (for example
`job-boards.greenhouse.io/asteralabs`). No API keys, no bearer tokens, no client secrets, no
passwords, and no `.env` values are referenced. There is no environment variable read anywhere in
the package.

**Authentication: none by design.** Every adapter calls a public, unauthenticated listing endpoint.
No adapter sends an `Authorization` header or a cookie, and no adapter logs in anywhere. Where a
company requires a session, the source is simply not supported.

**Platform and environment identifiers: none.** No product, vendor, workspace, project or
application identifiers remain; no internal service URLs, no function or table names, no absolute
links to a private deployment. The only persistence touchpoint is a local JSON file the user names
themselves.

**Personal data: none.** No email addresses, phone numbers, personal names, user IDs or candidate
data. The scanner reads job advertisements only. Visitor tracking, cookies, fingerprints and
analytics calls are absent.

**Hardcoded hosts, all public career endpoints:**

- `boards-api.greenhouse.io`
- `api.lever.co`
- `join.com`
- `www.comeet.com`
- `www.amazon.jobs`
- `www.google.com`
- the Workday tenant host taken from the configured `career_url`
- `careers.example.com`, which appears only in an example string

No analytics host, no telemetry host, no third-party CDN, no shortener.

**Dependencies: none at runtime.** `package.json` has an empty `dependencies` block. The only
dev dependencies are `typescript`, `tsx` and `@types/node`. Nothing is executed from a remote
source, and no install-time script is defined.

**Outbound behaviour:** the only network calls are the adapter fetches for the sources a user
configures, plus the optional detail-page fetches those adapters need. Nothing contacts a server
the user did not list.

**File writes:** the CLI writes the output file, the optional state file, and nothing else. Both
paths are chosen by the user and both are covered by `.gitignore`.

## Verification performed

- `tsc --noEmit --strict` over the library entry point and the CLI: clean.
- `esbuild --bundle` over the CLI: clean, which confirms every import and export resolves.
- Live run against Lever (Mobileye), Greenhouse (Astera Labs) and Workday (NVIDIA): sources scanned
  successfully, postings normalized and classified, no errors.
- Two consecutive runs with `--state` on one source: first run reported `1 new`, second reported
  `0 new` and `1 duplicate`, with lifecycle refresh applied. State file contains only job records.

## Notes for a maintainer

- Do not add credentials, private board tokens or cookies to a source entry to "make it work". A
  source that needs them is out of scope.
- Keep the User-Agent descriptive and keep request batching small; a scanner that behaves like an
  attack will be treated like one.
- If you add a new adapter, re-check that it only reads public endpoints and that it sends no
  identifying headers beyond a normal User-Agent.
- The `.gitignore` already excludes `.env`, build output, scan output and local state files.