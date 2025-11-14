# Multi-stage build for optimized production image
FROM node:18-alpine AS base

# Install pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@9.0.0

# Stage 1: Install dependencies
FROM base AS dependencies

WORKDIR /app

# Copy package files
COPY package.json ./
COPY pnpm-lock.yaml* ./

# Install dependencies (including dev dependencies for building)
RUN pnpm install --frozen-lockfile

# Stage 2: Build TypeScript
FROM base AS build

WORKDIR /app

# Copy dependencies from previous stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy source code and config
COPY . .

# Build TypeScript to JavaScript
RUN pnpm run build

# Stage 3: Production runtime
FROM node:18-alpine AS production

# Install pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@9.0.0

WORKDIR /app

# Copy package files
COPY package.json ./
COPY pnpm-lock.yaml* ./

# Install only production dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy built application from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/config ./config

# Create meetings directory
RUN mkdir -p /app/meetings

# Set node environment to production
ENV NODE_ENV=production

# Run as non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('healthy')" || exit 1

# Start the bot
CMD ["node", "dist/index.js"]
