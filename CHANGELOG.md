# Changelog

## Unreleased

- Add a free Render demo Blueprint backed by Neon PostgreSQL, SSL database configuration, and setup instructions.
- Remove welcome inbox notifications and exclude previously stored welcomes from notification lists and unread counts.
- Remove the onboarding questionnaire and signup detours, make the workspace tour manual, and disable browser/server error reporting and Sentry integrations.
- Add a production Docker build with cached dependency/SDK stages, separate frontend and backend builds, a slim runtime image, health checks, and persistent-storage Compose setup.
- Remove cloud signup and gift promotions, newsletter signup, product feeds, purchase prompts, default form advertising, and automatic vendor telemetry/support-chat connections.
- Reduce startup metadata work, reuse source-scoped table listings, load table/view metadata with bounded concurrency, and cache frozen-column widths during canvas rendering.
