import {useEffect, useRef, useState} from "react";
import Hls from "hls.js";

export default function AceStreamPlayer({cid, onClose, dark = false}) {
    const videoRef = useRef(null);
    const [status, setStatus] = useState("Verifico Engine locale…");
    const [engineBase, setEngineBase] = useState(null);

    // prova a trovare l'engine in locale
    useEffect(() => {
        setEngineBase("http://127.0.0.1:6878");
        setStatus("Provo a collegarmi all'Engine…");
    }, []);

    // avvia la riproduzione quando abbiamo engineBase
    useEffect(() => {
        if (!engineBase || !cid || !videoRef.current) return;
        const manifest = `/ace/manifest.m3u8?id=${encodeURIComponent(cid)}`;
        const video = videoRef.current;

        if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = manifest;
            video.play().catch(() => {
            });
            return;
        }

        if (Hls.isSupported()) {
            const hls = new Hls({maxBufferLength: 30});
            hls.loadSource(manifest);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {
            }));
            hls.on(Hls.Events.ERROR, (_, data) => {
                console.warn("HLS error:", data);
                setStatus("Errore HLS. Controlla che il contenuto sia disponibile.");
            });
            return () => hls.destroy();
        } else {
            setStatus("Questo browser non supporta HLS né hls.js.");
        }
    }, [engineBase, cid]);

    return (
        <div
            className={`fixed inset-0 z-50 flex items-center justify-center ${dark ? "bg-black/80" : "bg-black/60"}`}
            onClick={onClose}
        >
            <div
                className={`${dark ? "bg-gray-900 text-white" : "bg-white text-black"} rounded-2xl p-4 w-[92vw] max-w-4xl`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-2">
                    <div className="text-sm opacity-70">{status}</div>
                    <button className="px-3 py-1 rounded-md border" onClick={onClose}>Chiudi</button>
                </div>
                <div className="w-full aspect-video bg-black rounded-lg overflow-hidden">
                    <video ref={videoRef} controls playsInline className="w-full h-full bg-black"/>
                </div>
                <div className="mt-3 text-xs opacity-70">
                    Se l’Engine non è avviato, apri anche <code>acestream://{cid}</code> dall’app AceStream.
                </div>
            </div>
        </div>
    );
}
