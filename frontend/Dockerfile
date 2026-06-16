FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5173

# Run the Vite dev server; it proxies /api to the backend (see vite.config.ts).
CMD ["npm", "run", "dev"]
