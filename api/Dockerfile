# The api image. Built from the repository root:
#   docker build -f api/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) .

FROM node:24-alpine AS build
WORKDIR /build

# Manifests first, so a change to source does not invalidate the install layer.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY ui/package.json ui/
COPY api/package.json api/
COPY app/package.json app/
RUN npm ci

# Every workspace tsconfig extends this. esbuild tolerates its absence with
# only a warning, which is worse than failing — the app build does fail on it.
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY api/ api/
RUN npm run build --workspace api

FROM node:24-alpine
# The commit this image was built from, served by GET /api/v1/version. CI polls
# that endpoint until it reports this value, which is how a deploy is known to
# have landed (docs/testing.md, Tier 4).
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app
# esbuild bundles the server and its dependencies into one file, so the runtime
# stage needs no node_modules at all.
COPY --from=build /build/api/dist ./dist

USER node
EXPOSE 8080

# Migrations run inside the process before it serves (src/index.ts), so a
# container that cannot migrate never accepts a request.
CMD ["node", "dist/index.js"]
