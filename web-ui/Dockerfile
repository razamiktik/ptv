FROM node:20-alpine AS builder
WORKDIR /app
ARG VITE_API_URL=http://localhost/api
ENV VITE_API_URL=$VITE_API_URL
COPY package.json ./
RUN npm install
COPY . .
# Si no hay src/, crear un placeholder mínimo
RUN if [ ! -f src/main.jsx ]; then \
  mkdir -p src && \
  echo 'import React from "react"; import { createRoot } from "react-dom/client"; createRoot(document.getElementById("root")).render(<h1>WISP System</h1>);' > src/main.jsx && \
  echo '<!DOCTYPE html><html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>' > index.html; \
fi
RUN npm run build

FROM nginx:1.25-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / { try_files $uri $uri/ /index.html; }\n}\n' \
    > /etc/nginx/conf.d/default.conf
EXPOSE 80
