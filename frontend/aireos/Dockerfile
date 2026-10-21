# aireOS web image (Next.js standalone server).
#
# Build from frontend/aireos/, passing the domain users open:
#   docker build -t aireos-web --build-arg NEXT_PUBLIC_API_URL=https://aireos.example.com frontend/aireos
#
# NEXT_PUBLIC_API_URL is compiled into the browser bundle, so it is a build
# argument, not a Cloud Run env var. It must be the same domain the app is
# served from, so API calls are same-origin through the load balancer.

# ---- Build ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG NEXT_PUBLIC_API_URL
# next.config.mjs loads .env.frontend (the one frontend env loader), so write
# it from the build arg rather than adding a second way to pass settings.
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "NEXT_PUBLIC_API_URL build arg is required" && exit 1)
RUN printf 'NEXT_PUBLIC_API_URL=%s\n' "$NEXT_PUBLIC_API_URL" > .env.frontend \
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
