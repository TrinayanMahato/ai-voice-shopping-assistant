FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .

ENV NODE_ENV=production

RUN npm run build

EXPOSE 4173
CMD ["npm", "run", "preview"]
