#!/usr/bin/env python3
import sys
import subprocess
import tempfile
from pathlib import Path
from audio_extractor import extract_audio_url
import asyncio

async def main(page_url: str):
    hls_url = await extract_audio_url(page_url)
    if not hls_url:
        print("❌ Impossibile estrarre il flusso HLS.")
        return

    print("✅ Trovato HLS:", hls_url)

    # Genera file .acelive temporaneo
    acelive = Path(tempfile.gettempdir()) / "stream.acelive"
    engine_cmd = "C:\\Users\\paulb\\AppData\\Roaming\\ACEStream\\engine\\ace_engine.exe"  # o "start-engine" su Linux

    cmd_create = [
        engine_cmd,
        "--create-hls-transport",
        "--url", hls_url,
        "--title", "RadioLive",
        "--output-public", str(acelive)
    ]
    print("⏳ Creo transport AceStream…")
    subprocess.run(cmd_create, check=True)
    print(f"✅ Transport creato: {acelive}")

    # Avvia broadcast P2P
    cmd_stream = [
        engine_cmd,
        "--stream-source-node",
        "--source", str(acelive),
        "--name", "IlMioCanale"
    ]
    print("⏳ Avvio broadcast AceStream…")
    subprocess.Popen(cmd_stream)
    print("✅ Broadcast avviato. Controlla il Content ID in console.")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Uso: python {sys.argv[0]} <url_pagina>")
    else:
        asyncio.run(main(sys.argv[1]))
