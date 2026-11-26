FROM mcr.microsoft.com/playwright:v1.52.0-noble

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy server files and static web app
COPY server/package.json ./server/
RUN cd server && npm install --omit=dev

COPY server/ ./server/
COPY Pulso/Web/wa-main.js ./server/wa-main.js
COPY docs/app/ ./docs/app/

ENV NODE_ENV=production
ENV PORT=8787
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=""

EXPOSE 8787

CMD ["node", "server/server.mjs"]
