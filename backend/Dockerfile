FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# ITEM 009 (auditoria do Assistente, 2026-09-28): SHA do commit builda a
# imagem, exposto por HealthController — só assim dá pra comparar "o que
# está no ar" com `git rev-parse HEAD` sem entrar no container pra ler o
# .js compilado. Vazio/"unknown" é seguro: nunca derruba o build.
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY db ./db
EXPOSE 4000
CMD ["node", "dist/src/main.js"]
