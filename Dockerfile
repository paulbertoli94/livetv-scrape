# Step 1: Costruzione del frontend React
FROM node:18-alpine as frontend

WORKDIR /app

# Copia solo i file necessari per installare i pacchetti
COPY frontend/package.json frontend/package-lock.json ./
RUN npm install --omit=dev --legacy-peer-deps

# Copia il codice del frontend e costruisci la build
COPY frontend ./
ENV CI=true
RUN npm run build

# Step 2: Backend Flask con Python
FROM python:3.12-alpine

WORKDIR /usr/src/

# Copia i requirements del backend e installa le dipendenze
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copia il backend e la build del frontend
COPY backend/ ./
COPY --from=frontend /app/build frontend/build

# Esponi la porta
EXPOSE 5000

# Avvia Flask
CMD ["python", "main.py"]
