# Usa un'immagine base Python
FROM python:3.10-slim

# Imposta la directory di lavoro
WORKDIR /usr/src/

# Copia le dipendenze
COPY requirements.txt ./

# Installa le dipendenze
RUN pip install --no-cache-dir -r requirements.txt

# Copia tutto il contenuto del progetto nella directory di lavoro del container
COPY . .

# Espone la porta 5000
EXPOSE 5000

# Comando per eseguire l'app Flask
CMD ["python", "main.py"]
