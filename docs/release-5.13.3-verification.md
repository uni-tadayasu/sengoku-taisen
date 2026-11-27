# Ver.5.13.3 — operator recovery entry

## Scope

The settings version control can deliberately reveal the existing original-operator recovery form when a device has lost its local identity. Revealing the form does not change a saved game or grant a role. The existing server route still verifies the original registration key and resolves the original operator ID.

The entry exists only for the current recovery view and account context. Closing the view, leaving it, hiding the page, or changing accounts invalidates the entry and clears the input. Delayed key responses and save-file reads are discarded after cancellation. Adding a game save to a key-verified identity retains the operator-role check and cancellation behavior; importing a separate identity uses the established backup workflow.

The backend implementation, registration secret, existing sessions, live players, and live game saves are not changed by this release. A real operator recovery still requires the user to enter the original registration key and explicitly choose the progress to restore.

## Local verification

- `node tests/test-domain-recovery.cjs`: 439 assertions, including cancellation during a file read, cancellation during the following verification, role loss, retry, and ordinary backup compatibility.
- `node tests/test-settings-usability.cjs`: 10 checks, including the deliberate version gesture, expiry, other-action reset, and unchanged game saves.
- `node server/test-admin-recovery.mjs`: 123 local HTTP calls using synthetic keys and identities; existing-owner-only authentication, immutable saved progress and old credentials, idempotent retries, revoked sessions, CORS, and rate limits.
- `node tests/test-minified-runtime.cjs`: original/minified initialization parity and 62 campaign/save checkpoints.
- Production entry remains within the existing release budget: 3,696,053 raw bytes / 1,022,358 gzip bytes. No runtime dependency, image, or server-code addition.
- Recovery and settings checks are included in the GitHub Actions recovery job.

## Browser verification

The generated frontend was opened through the managed preview in Chromium. The normal settings control revealed the recovery form after the intended gesture, and closing the dialog removed the key input. The input and confirmation control were visible without horizontal clipping at desktop size, in a 390 × 844 phone-sized iframe, and in a 1024 × 768 landscape-tablet-sized iframe.

These checks cover browser rendering at the stated dimensions, not physical iOS/Android devices or an on-screen keyboard. No production key was entered and no real player account was recovered or modified.

## Publication

The release retains the existing GitHub Pages publication workflow. Backend redeployment and database migrations are not required for this frontend change. GitHub checks and the served release marker must be confirmed when the pull request is published.
