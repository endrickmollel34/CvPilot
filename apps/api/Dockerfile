FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace manifests first for better layer caching
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/typescript-config/package*.json ./packages/typescript-config/
COPY packages/eslint-config/package*.json ./packages/eslint-config/
COPY packages/shared/package*.json ./packages/shared/

RUN npm ci

# Copy source and build
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=apps/api

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# npm workspaces hoist all dependencies to the repo-root node_modules — there
# is no apps/api/node_modules to copy. The monorepo directory layout is
# preserved here (rather than flattened) because node_modules/@cvpilot/shared
# is a symlink to ../packages/shared, which only resolves if that path
# structure still exists in this stage.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json

EXPOSE 3001

CMD ["node", "apps/api/dist/main.js"]
