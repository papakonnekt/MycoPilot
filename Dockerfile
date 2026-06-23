# =============================================================
# Stage 1: Build the React + Vite frontend
# =============================================================
FROM node:20-alpine AS client-builder
WORKDIR /app
COPY shared/ ./shared/
COPY client/package*.json ./client/
RUN cd client && npm ci
COPY client/ ./client/
RUN cd client && npm run build

# =============================================================
# Stage 2: Build the Express backend
# =============================================================
FROM node:20-alpine AS server-builder
WORKDIR /app
COPY shared/ ./shared/
COPY server/package*.json ./server/
RUN cd server && npm ci
COPY server/ ./server/
RUN cd server && npm run build
# Prune node_modules to keep only production dependencies
RUN cd server && npm prune --production

# =============================================================
# Stage 3: Runner stage
# =============================================================
FROM node:20-alpine AS runner
WORKDIR /app

# Install lightweight dependencies:
# - sqlite: database CLI needed by backup.sh
# - git, bash, openssh-client: required by backup.sh to push to GitHub
RUN apk add --no-cache sqlite git bash openssh-client

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/app/data/myco.db
ENV PUBLIC_DIR=/app/server/public

# Copy compiled backend code and dependencies
COPY --from=server-builder /app/server/dist ./server/dist
COPY --from=server-builder /app/server/node_modules ./server/node_modules
COPY --from=server-builder /app/server/package.json ./server/package.json
COPY --from=server-builder /app/server/src/db/schema.sql ./server/dist/server/src/db/
# Copy built frontend assets to be served by Express
COPY --from=client-builder /app/client/dist ./server/public

EXPOSE 3001

WORKDIR /app/server
CMD ["node", "dist/server/src/index.js"]
