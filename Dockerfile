FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY src/ ./src/
COPY version.json ./
COPY config.js ./

EXPOSE 3000

CMD ["node", "src/index.js"]
