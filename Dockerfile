FROM node:18-alpine

# Install curl for container healthcheck verification
RUN apk add --no-cache curl

WORKDIR /app

# Copy dependency manifests
COPY app/package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application source code and public assets
COPY app/server.js ./app/
COPY app/checker.js ./app/
COPY app/public/ ./app/public/

# Build number argument and environment variable
ARG BUILD_NUMBER=local
ENV BUILD_NUMBER=$BUILD_NUMBER
ENV NODE_ENV=production
EXPOSE 3000

# Container healthcheck hitting /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the Sentinel server
CMD ["node", "app/server.js"]
