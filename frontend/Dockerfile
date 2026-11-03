# Rijeka web image: the Vite build served by nginx, with /auth/v1 and /api proxied to the compose services.
# Build context is the REPOSITORY ROOT (the prebuild copies docs/methodology/rijeka_methodology.pdf into
# public/); docker-compose.yml passes the VITE_* values as build arguments, which Vite bakes in.
FROM node:20-alpine AS build
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_URL
ARG VITE_COMMIT=selfhost
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_API_URL=$VITE_API_URL VITE_COMMIT=$VITE_COMMIT
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci --no-audit --no-fund
COPY frontend ./frontend
COPY docs/methodology/rijeka_methodology.pdf ./docs/methodology/rijeka_methodology.pdf
RUN cd frontend && npm run build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1/version.json >/dev/null || exit 1
