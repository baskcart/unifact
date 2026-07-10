FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 4110
ENV PORT=4110
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/store.db

RUN mkdir -p /data

CMD ["node", "dist/api.js"]
