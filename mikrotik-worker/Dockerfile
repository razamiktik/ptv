FROM node:20-alpine
RUN apk add --no-cache tini
WORKDIR /app
COPY package.json ./
RUN npm install --production && npm cache clean --force
COPY src/ ./src/
RUN mkdir -p plugins
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/worker.js"]
