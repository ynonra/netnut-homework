FROM node:20-alpine

# Prisma's query engine needs OpenSSL/libssl on Alpine (musl); without it the
# engine fails to start. See prisma:warn "failed to detect libssl/openssl".
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm install

# Prisma schema is needed for `prisma generate`.
COPY prisma ./prisma
RUN npx prisma generate

# App source.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 4000

ENTRYPOINT ["./docker-entrypoint.sh"]
