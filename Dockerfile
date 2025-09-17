# --- Frontend (Debian) ---
FROM node:22-slim AS frontend
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY frontend ./
ENV CI=true
RUN npm run build

# --- Backend (Python Debian slim) ---
FROM python:3.12-slim
WORKDIR /usr/src/

ENV PIP_NO_CACHE_DIR=1 PYTHONDONTWRITEBYTECODE=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && update-ca-certificates

COPY backend/requirements.txt ./
# Installa senza compilare bytecode per risparmiare spazio
RUN pip install -U pip setuptools wheel certifi --no-cache-dir --no-compile \
 && pip install --no-cache-dir --no-compile -r requirements.txt \
 && python -m pip uninstall -y pip setuptools wheel || true

# (opzionale) forza requests a usare il trust store di sistema
ENV REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

COPY backend/ ./
COPY --from=frontend /app/dist ./frontend/dist

# directory per SQLite
RUN mkdir -p /usr/src/data
ENV DATA_DIR=/usr/src/data

EXPOSE 5000
CMD ["gunicorn", "-b", "0.0.0.0:5000", "--workers", "2", "--threads", "4", "main:app"]
