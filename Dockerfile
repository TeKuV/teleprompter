# Use the official Node.js 18 LTS image
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

# Fallback copy for runs without a bind mount.
# docker compose mounts the host project over /app so HTML/CSS/JS
# edits are served on the next request — no image rebuild needed.
COPY . .

EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8080) + '/controller.html', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# node itself as PID 1: npm in front of it swallows the stop signal and reports a
# failure exit code even on a clean shutdown.
CMD ["node", "server.js"]
