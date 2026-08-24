# The app image: the built PWA plus a Caddy that serves it and sets the
# security headers. Built from the repository root:
#   docker build -f app/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) .

FROM node:24-alpine AS build
WORKDIR /build

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY ui/package.json ui/
COPY api/package.json api/
COPY app/package.json app/
RUN npm ci

# Every workspace tsconfig extends this; without it the build fails resolving
# "extends" rather than producing a type error, which is a confusing way to
# find out.
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY ui/ ui/
COPY app/ app/

# Surfaced in the UI as the build line ("BUILD 7C39F2A") on the sign-in screen
# and under Account (docs/design/README.md §8, §11).
ARG GIT_SHA=unknown
ENV VITE_GIT_SHA=$GIT_SHA
RUN npm run build --workspace app

FROM caddy:2-alpine
COPY app/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /build/app/dist /srv
EXPOSE 80
