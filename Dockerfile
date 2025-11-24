# Production-friendly image (TLS Render/Railway terminatsiya qiladi, shuning uchun HTTP)
FROM node:20-alpine AS base
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server ./server
COPY client ./client

# Default: HTTPS yo'q, platforma TLS terminatsiya qiladi
ENV USE_HTTPS=false \
    HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080
CMD ["node", "server/index.js"]
