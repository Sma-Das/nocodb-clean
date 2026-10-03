# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=24.14.0
FROM node:${NODE_VERSION}-bookworm-slim AS toolchain
ARG PNPM_VERSION=12.8.1
ENV PNPM_HOME=/pnpm \
    CI=true \
    PATH=/pnpm:$PATH \
    npm_config_store_dir=/pnpm/store \
    npm_config_manage_package_manager_versions=false
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@${PNPM_VERSION}
WORKDIR /build

# Keep dependency installation independent of application source.
FROM toolchain AS dependencies
ENV npm_config_cache_dir=/pnpm/store/metadata
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/nc-gui/.patches/ packages/nc-gui/.patches/
COPY packages/nocodb/.patches/ packages/nocodb/.patches/
# The container already has the pinned Node version; don't download another.
RUN sed -i '/^use-node-version=/d' .npmrc
COPY package.json ./
COPY packages/nocodb/package.json packages/nocodb/package.json
COPY packages/nc-gui/package.json packages/nc-gui/package.json
COPY packages/nocodb-sdk/package.json packages/nocodb-sdk/package.json
COPY packages/nocodb-sdk-v2/package.json packages/nocodb-sdk-v2/package.json
COPY packages/nc-secret-mgr/package.json packages/nc-secret-mgr/package.json
COPY scripts/docker/prepare-workspace.cjs scripts/docker/prepare-workspace.cjs
RUN node scripts/docker/prepare-workspace.cjs
# Skip install hooks and explicitly rebuild approved workspace native modules.
# Disable Git hooks in the container; Nuxt regenerates its files during the build.
RUN --mount=type=cache,id=nocodb-pnpm,target=/pnpm/store,sharing=locked \
    pnpm install --prefer-offline --frozen-lockfile --ignore-scripts
RUN --mount=type=cache,id=nocodb-pnpm,target=/pnpm/store,sharing=locked \
    HUSKY=0 pnpm -r rebuild

FROM dependencies AS sdk
COPY packages/nocodb-sdk/ packages/nocodb-sdk/
COPY packages/nocodb-sdk-v2/ packages/nocodb-sdk-v2/
RUN pnpm --filter nocodb-sdk run build:docker \
    && pnpm --filter nocodb-sdk-v2 run build

FROM sdk AS frontend
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=4096 \
    NUXT_TELEMETRY_DISABLED=1
COPY packages/nc-gui/ packages/nc-gui/
RUN pnpm --filter nc-gui run build

FROM sdk AS backend
COPY packages/noco-integrations/ packages/noco-integrations/
RUN node scripts/docker/prepare-workspace.cjs packages/noco-integrations
RUN --mount=type=cache,id=nocodb-pnpm,target=/pnpm/store,sharing=locked \
    pnpm --dir packages/noco-integrations --filter @noco-integrations/core install \
      --prod --frozen-lockfile --ignore-scripts
COPY packages/nocodb/ packages/nocodb/
RUN pnpm --filter nocodb run build:docker
RUN --mount=type=cache,id=nocodb-pnpm,target=/pnpm/store,sharing=locked \
    pnpm --filter nocodb deploy --prod /production

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    NC_TOOL_DIR=/usr/app/data \
    NC_GUI_DIST_PATH=/usr/app/nc-gui \
    NC_DISABLE_TELE=true \
    NC_DISABLE_ERR_REPORTS=true \
    NC_DISABLE_ONBOARDING_FLOW=true
WORKDIR /usr/app
COPY --from=backend /production/node_modules/ node_modules/
COPY --from=backend /production/package.json ./
COPY --from=backend /build/packages/nocodb/dist/ ./
COPY --from=frontend /build/packages/nc-gui/.output/public/ nc-gui/
COPY packages/nocodb/docker/healthcheck.cjs ./
COPY LICENSE.md ./
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD ["node", "healthcheck.cjs"]
CMD ["node", "main.js"]
