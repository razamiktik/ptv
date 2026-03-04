FROM node:20-alpine
RUN apk add --no-cache wget tini
WORKDIR /app
COPY package.json ./
RUN npm install --production && npm cache clean --force
COPY src/ ./src/
RUN mkdir -p plugins logs
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/app.js"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD wget -qO- http://localhost:3000/health || exit 1
