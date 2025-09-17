import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    server: {
        host: true,              // opzionale: raggiungibile anche da altri device in LAN
        proxy: {
            "/acestream": {
                target: "http://192.168.1.10:5000",
                changeOrigin: true,
                secure: false,
            },
            "^/tv($|/)": {
                target: "http://192.168.1.10:5000",
                changeOrigin: true,
                secure: false,
            },
            "/auth": {
                target: "http://192.168.1.10:5000",
                changeOrigin: true,
                secure: false,
            },
        },
    },
});
