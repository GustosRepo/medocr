# Backend Dockerfile (Node 18 LTS)
FROM node:18-bullseye-slim
WORKDIR /usr/src/app
COPY package.json package-lock.json* ./
RUN npm ci --production
COPY . .
ENV NODE_ENV=production
EXPOSE 4387
CMD ["node", "backend/server.js"]
