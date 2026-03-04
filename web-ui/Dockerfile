FROM node:20-alpine AS builder
WORKDIR /app
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.25-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / { try_files $uri $uri/ /index.html; }\n  gzip on;\n  gzip_types text/css application/javascript application/json image/svg+xml;\n}\n' \
    > /etc/nginx/conf.d/default.conf
EXPOSE 80
