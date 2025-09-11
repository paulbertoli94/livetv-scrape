# --- Frontend (Debian) ---
FROM node:18-slim AS frontend
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps
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
 # (opzionale) rimuovi tool build se non servono a runtime
 && python -m pip uninstall -y pip setuptools wheel || true

# (opzionale) forza requests a usare il trust store di sistema
ENV REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

COPY backend/ ./
COPY --from=frontend /app/build frontend/build

# (opzionale hardcore trimming — usa con cautela)
# RUN find /usr/local/lib/python3.12 -name "__pycache__" -type d -exec rm -rf {} + \
#  && find /usr/local/lib/python3.12 -name "tests" -type d -exec rm -rf {} +

EXPOSE 5000
CMD ["python", "main.py"]
