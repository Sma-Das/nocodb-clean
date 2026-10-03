# Cleanup and performance

This checkout removes cloud signup and gift promotions, newsletter signup, social/product feeds, license purchase prompts, and the default promotional footer on forms. Custom deployment branding remains available. Documentation links and existing license activation, refresh, and management remain available.

Browser event instrumentation (`$e`, `$tele`, and `v-e`) and server telemetry calls remain callable but perform no collection or transmission. The dedicated telemetry socket gateway, heartbeat/flush timers, product-feed requests, and automatic vendor support-chat loading have been removed. App info reports these services disabled, regardless of the former environment toggles. The legacy feed and cloud-feature APIs return empty arrays, and the former feed page redirects to the application.

Signup opens the workspace directly. The onboarding questionnaire, answer collection, and navigation through `continueAfterOnboardingFlow` have been removed; existing new-user flags no longer block access. The workspace walkthrough is available only when requested from Help. Browser error reporting, Sentry tracing and initialization, and server error export are disabled even if the former environment settings specify a Sentry DSN. The legacy error-reporting API acknowledges requests without inspecting or forwarding their contents. Server errors remain in local logs.

New signups no longer create welcome inbox notifications. Existing welcome messages are excluded before notification pagination and from total/unread counts, so they do not leave an unread badge behind.

## Performance changes

- App info no longer scans instance usage to decide whether to offer a promotional gift. Startup no longer counts users for telemetry.
- Table listing queries models once and loads views only for the requested source and eligible junction-table setting.
- Metadata loads at most three tables at once; each table hydrates at most four views at once. Results retain table/view order. Role flags, table visibility checks, and shared-view password masking remain in place, and lookup errors propagate.
- Canvas rendering caches the combined frozen-column width using a reactive computed value. Width and frozen-state changes invalidate the cache; repeated drawing reads reuse it.
- Remove unused analytics, support-chat, GitHub-button, and product-video dependencies from the manifests and lockfile.

## Verification

After installing the workspace dependencies, run from the repository root:

```sh
node --test scripts/tests/clean-performance.test.cjs
```

The 20 regression checks evaluate the actual source methods with isolated collaborators, the project's concurrency queue, and Vue reactivity. They cover ordering, concurrency limits, source selection, junction tables, role and public-table permissions, password masking, errors, computed-cache invalidation, app-info defaults, direct signup navigation, and inert instrumentation/error reporting. Notification checks use SQLite in memory and the application's condition parser to verify pagination and counts with historical welcomes, and check invitation delivery. These checks do not boot the application or replace full database integration tests.

A controlled comparison used the before/after metadata methods, 12 tables with four views each, simulated 5 ms per-view hydration latency, and seven runs. Median time fell from 299.4 ms to 24.9 ms; model-list queries fell from two to one. This demonstrates the scheduling change, not a production performance guarantee.

The edited Vue templates and TypeScript syntax, removed-module references, and lockfile dependencies were checked. The full application was built and exercised in Docker on Linux ARM64, including API readiness, persisted admin login and SQLite storage, frontend assets, and native image processing. See [Docker verification](docker.md#verification). Browser interaction and external database integration checks have not been run. Local validation tools were installed separately under `/tmp`; Docker installs workspace dependencies inside its build stages.

These changes take effect in the local `nocodb-clean:local` image built from this checkout. Upstream container images do not contain these source changes.
