FROM node:20-bookworm-slim

WORKDIR /app

# better-sqlite3 has no prebuild for some ARM mini PCs, so keep a compiler available.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

RUN mkdir -p /app/data

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
