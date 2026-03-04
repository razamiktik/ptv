FROM node:20-alpine
RUN apk add --no-cache tini
WORKDIR /app
COPY package.json ./
RUN npm install --only=production && npm cache clean --force
COPY src/ ./src/
RUN mkdir -p plugins && addgroup -g 1001 wisp && adduser -u 1001 -G wisp -D wisp && chown -R wisp:wisp /app
USER wisp
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/worker.js"]
