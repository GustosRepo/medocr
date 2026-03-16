# Backend Dockerfile (Node 18 LTS)
FROM node:18-bullseye-slim

# Install system dependencies for canvas & sharp
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libexpat1 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY package.json package-lock.json* ./
RUN npm ci --production
COPY . .
ENV NODE_ENV=production
EXPOSE 4387
CMD ["node", "backend/server.js"]
