FROM node:18-alpine

# Install curl for container healthcheck verification
RUN apk add --no-cache curl

WORKDIR /app

# Copy dependency manifests
COPY app/package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application code into app/ directory
COPY app/server.js ./app/

# Configure environment and port
ENV NODE_ENV=production
EXPOSE 3000

# Healthcheck hitting /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start Express server
CMD ["node", "app/server.js"]
