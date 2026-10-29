# aireOS web image (Next.js standalone server).
#
# Build from frontend/aireos/, passing the domain users open:
#   docker build -t aireos-web \
#     --build-arg NEXT_PUBLIC_API_URL=https://aireos.example.com \
#     --build-arg NEXT_PUBLIC_AUTH_ENABLED=true \
#     --build-arg BACKEND_API_URL=https://aireos-api.example.com frontend/aireos
# deploy/deploy.ps1 (or .sh) does this with the values in deploy/<env>/web.build.env.
#
# NEXT_PUBLIC_* values are compiled into the browser bundle, so they are build
# arguments, not Cloud Run env vars. It must be the same domain the app is
# served from, so API calls are same-origin through the load balancer.

# ---- Build ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG NEXT_PUBLIC_API_URL
# Compiled in like the API URL. "true" turns on the route guard (proxy.js) and
# the Sign out button; it must match AUTH_ENABLED on the API.
ARG NEXT_PUBLIC_AUTH_ENABLED=false
# Optional. When set, the web server forwards /api/* to this URL (rewrites in
# next.config.mjs), so the browser and the session cookie stay on one origin.
ARG BACKEND_API_URL=
# next.config.mjs loads .env.frontend (the one frontend env loader), so write
# it from the build args rather than adding a second way to pass settings.
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "NEXT_PUBLIC_API_URL build arg is required" && exit 1)
RUN printf 'NEXT_PUBLIC_API_URL=%s\nNEXT_PUBLIC_AUTH_ENABLED=%s\nBACKEND_API_URL=%s\n' \
        "$NEXT_PUBLIC_API_URL" "$NEXT_PUBLIC_AUTH_ENABLED" "$BACKEND_API_URL" > .env.frontend \
    && npm run build

# ---- Run ----
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

# The standalone output has server.js and the node_modules it needs; static
# assets and public/ are copied beside it.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

USER node

# server.js listens on PORT, which Cloud Run sets (8080).
CMD ["node", "server.js"]
