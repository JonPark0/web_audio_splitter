# Multi-stage build:
#   dev  - Vite dev server with hot reload (FRONTEND_MODE=dev; compose
#          bind-mounts the source)
#   prod - static build served by nginx, which also proxies /api to the backend
#          (the published image)
# Building without --target yields prod (the last stage).

FROM node:24-alpine AS deps
WORKDIR /app
# Copy the manifests first so the install layer stays cached until dependencies
# change; `npm ci` installs exactly what package-lock.json pins.
COPY package.json package-lock.json ./
RUN npm ci


FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]


FROM deps AS build
COPY . .
RUN npm run build


# Non-root nginx (runs as uid 101); listens on 3000 like the dev server, so
# URLs and compose port mappings don't change between modes.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 3000
