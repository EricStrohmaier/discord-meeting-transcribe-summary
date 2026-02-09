# Multi-stage build for optimized production image
FROM node:22-slim AS base

# Install pnpm and system ffmpeg (needed for audio processing)
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@9.0.0

# Stage 1: Install dependencies and build
FROM base AS build

WORKDIR /app

# Copy package files and pnpm config
COPY package.json pnpm-lock.yaml* .npmrc ./

# Install all dependencies (including dev for TypeScript build)
RUN pnpm install --frozen-lockfile

# Copy source code and config
COPY . .

# Build TypeScript to JavaScript
RUN pnpm run build

# Stage 2: Production runtime
FROM node:22-slim AS production

# Install system ffmpeg (reliable, no build-script issues)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@9.0.0

WORKDIR /app

# Copy package files and pnpm config
COPY package.json pnpm-lock.yaml* .npmrc ./

# Install only production dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy built application from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/config ./config

# Create meetings directory with correct permissions
RUN mkdir -p /app/meetings

# Set node environment to production
ENV NODE_ENV=production

# Expose health check port
ENV HEALTH_PORT=3006
EXPOSE 3006

# Run as non-root user for security
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -m nodejs && \
    chown -R nodejs:nodejs /app

USER nodejs

# Health check — hits the real HTTP health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3006/ || exit 1

# Start the bot
CMD ["node", "dist/index.js"]
