FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core fonts-noto-cjk python3-venv && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/search-python && /opt/search-python/bin/pip install --no-cache-dir curl_cffi==0.16.3
WORKDIR /app
COPY scripts/google-search.py ./scripts/google-search.py
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/web-dist ./web-dist
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir -p /app/data && chown node:node /app/data
ENV GHTRENDS_SEARCH_PYTHON=/opt/search-python/bin/python3
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3721 GHTRENDS_DATA_DIR=/app/data
USER node
EXPOSE 3721
CMD ["node","--disable-warning=ExperimentalWarning","dist/server/index.js"]
