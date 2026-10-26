FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_DISCORD_CLIENT_ID=
ENV VITE_DISCORD_CLIENT_ID=$VITE_DISCORD_CLIENT_ID
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    GAME_BIND_HOST=0.0.0.0 \
    PORT=5179 \
    GAME_DATABASE_PATH=/data/forest-trail.sqlite
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 5179
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/main.js"]
