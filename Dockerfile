FROM node:24-bookworm-slim AS assets
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY game/package.json game/package-lock.json ./game/
RUN npm ci --prefix game
COPY game/index.html game/vite.config.js ./game/
COPY game/src ./game/src
COPY game/server ./game/server
COPY game/public ./game/public
RUN npm --prefix game run build

FROM python:3.11-slim-bookworm
ENV PYTHONUNBUFFERED=1 \
    PORT=8000
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 libglib2.0-0 libgl1 fonts-dejavu-core fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
COPY --from=assets /usr/local/bin/node /usr/local/bin/node
COPY requirements.txt ./
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt
COPY . .
COPY --from=assets /build/node_modules ./node_modules
COPY --from=assets /build/game/dist ./game/dist
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/healthz',timeout=4)"
CMD ["python", "start.py"]
