import React, {useEffect, useLayoutEffect, useRef, useState} from "react";
import {AnimatePresence, motion} from "framer-motion";
import {FaArrowRight, FaCopy, FaGooglePlay, FaMoon, FaSearch, FaSun} from "react-icons/fa";
import {MdCast, MdCastConnected} from "react-icons/md";
import Cookies from "js-cookie";
import {CircleFlag} from 'react-circle-flags';

const TV_APP_URL = "https://play.google.com/store/apps/details?id=com.acetvpair";
const API_BASE = import.meta.env.VITE_API_URL || ""

export default function App() {
    const [searchTerm, setSearchTerm] = useState("");
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [searched, setSearched] = useState(false);
    const [barPosition, setBarPosition] = useState(window.innerWidth < 768 ? 20 : 30);
    const [firstSearchDone, setFirstSearchDone] = useState(false);
    const [mobileMoving, setMobileMoving] = useState(false);
    const [desktopSecondSearch, setDesktopSecondSearch] = useState(false);
    const [darkMode, setDarkMode] = useState(() => {
        return Cookies.get("darkMode") === "true";
    });
    const inputRef = useRef(null);
    // pairing TV
    const [pairedDeviceId, setPairedDeviceId] = useState(() => Cookies.get("pairedDeviceId") || null);
    const [showPairModal, setShowPairModal] = useState(false);
    const [pairCode, setPairCode] = useState("");

    const DIGITS = 6;
    const [pairDigits, setPairDigits] = useState(Array(DIGITS).fill(""));
    const digitRefs = useRef([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [pairError, setPairError] = useState("");
    const resetDigits = () => {
        const empty = Array(DIGITS).fill("");
        setDigitsAndPairCode(empty);
        setTimeout(() => digitRefs.current[0]?.focus(), 0);
    };

    const setDigitsAndPairCode = (next) => {
        setPairDigits(next);
        setPairCode(next.join(""));
    };

    useEffect(() => {
        if (!showPairModal) return;
        setPairError("");
        resetDigits(); // resetDigits già setta cifre vuote e focus sul primo
    }, [showPairModal]);

    // userId locale (solo per demo/back-end semplice)
    const [userId, setUserId] = useState(() => Cookies.get("userId") || null);
    const abortRef = useRef(null);
    const requestIdRef = useRef(0);

    const authRef = useRef({uid: null, sig: null});

    // --- TOASTS ---
    const [toasts, setToasts] = useState([]);
    const toastIdRef = useRef(0);
    const showToast = (message, variant = "info") => {
        const id = ++toastIdRef.current;
        setToasts(t => [...t, {id, message, variant}]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2600);
    };
    const toastClass = (v) =>
        v === "success" ? "bg-green-600" :
            v === "error" ? "bg-red-600" :
                v === "warn" ? "bg-amber-600" : "bg-gray-800";

    // --- CONFIRM MODAL ---
    // Nota: onConfirm (opzionale) viene eseguito *nel click del bottone OK* (→ user gesture)
    const [confirmState, setConfirmState] = useState({open: false, text: "", onConfirm: null, resolve: null});
    const askConfirm = (text, onConfirm) => new Promise((resolve) => {
        setConfirmState({open: true, text, onConfirm, resolve});
    });
    const handleConfirmClose = (ans) => {
        // se ans === true, prima eseguo l’azione “gesture-safe” (es. openCastChooser)
        if (ans === true && typeof confirmState.onConfirm === "function") {
            try {
                confirmState.onConfirm();
            } catch {
            }
        }
        confirmState.resolve?.(!!ans);
        setConfirmState({open: false, text: "", onConfirm: null, resolve: null});
    };

    const [isSwitching, setIsSwitching] = useState(false);

    useLayoutEffect(() => {
        document.documentElement.classList.toggle("dark", darkMode);
    }, [darkMode]);

    // Salva preferenza
    useEffect(() => {
        Cookies.set("darkMode", String(darkMode), {expires: 365});
    }, [darkMode]);

    // Abilita animazione globale solo durante il cambio tema (300–400ms)
    const smoothThemeSwitch = () => {
        const root = document.documentElement;
        root.classList.add("theme-anim");     // abilita transizioni globali
        setIsSwitching(true);                  // attiva micro-motion (scale)
        setTimeout(() => {
            root.classList.remove("theme-anim");
            setIsSwitching(false);
        }, 400); // un filo più lungo della durata delle transition
    };

    const toggleTheme = () => {
        smoothThemeSwitch();
        setDarkMode(v => !v);
    };

    // --- Cast wake management ---
    const castInitRef = useRef(false);
    const openedByUsRef = useRef(false);
    const [autoWakeCast, setAutoWakeCast] = useState(() => Cookies.get("autoWakeCast") === "true");
    const [casting, setCasting] = useState({}); // es: { "0-2-1": "loading" | "success" | "error" | "idle" }

    useEffect(() => {
        Cookies.set("autoWakeCast", String(autoWakeCast), {expires: 365});
    }, [autoWakeCast]);

    const initCastContextOnce = () => {
        try {
            if (!(window.cast && cast.framework)) return false;
            const ctx = cast.framework.CastContext.getInstance();
            if (!castInitRef.current) {
                ctx.setOptions({
                    receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
                    autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
                    language: "it",
                });
                castInitRef.current = true;
                // opzionale: log
                ctx.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, (e) =>
                    console.log("[Cast] state:", e.castState)
                );
                ctx.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, (e) =>
                    console.log("[Cast] session:", e.sessionState)
                );
            }
            return true;
        } catch {
            return false;
        }
    };

    // attende che ci sia una sessione Cast attiva (TV accesa/receiver pronto)
    const waitForCastReady = (timeoutMs = 8000) => new Promise((resolve) => {
        try {
            if (!(window.cast && cast.framework)) return resolve(false);
            const ctx = cast.framework.CastContext.getInstance();
            // già connessi
            if (ctx.getCurrentSession()) return resolve(true);

            let done = false;
            const cleanup = (val) => {
                if (done) return;
                done = true;
                ctx.removeEventListener(
                    cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
                    onState
                );
                resolve(val);
            };
            const onState = (e) => {
                if (e.sessionState === cast.framework.SessionState.SESSION_STARTED ||
                    e.sessionState === cast.framework.SessionState.SESSION_RESUMED) {
                    // pronto
                    cleanup(true);
                } else if (e.sessionState === cast.framework.SessionState.SESSION_START_FAILED ||
                    e.sessionState === cast.framework.SessionState.SESSION_ENDED) {
                    cleanup(false);
                }
            };

            ctx.addEventListener(
                cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
                onState
            );
            setTimeout(() => cleanup(!!ctx.getCurrentSession()), timeoutMs);
        } catch {
            resolve(false);
        }
    });

    // callback loader + fallback polling (sostituisci il tuo useEffect di init)
    useEffect(() => {
        window.__onGCastApiAvailable = (isAvailable) => {
            if (!isAvailable) return;
            initCastContextOnce();
        };
        let tries = 0;
        const t = setInterval(() => {
            if (initCastContextOnce() || ++tries > 50) clearInterval(t); // ~10s
        }, 200);
        return () => clearInterval(t);
    }, []);

    useEffect(() => {
        const saved = JSON.parse(localStorage.getItem("auth") || "null");
        if (saved?.uid && saved?.sig) {
            authRef.current = saved;
            return;
        }
        fetch("/auth/anon", {method: "POST"})
            .then(r => r.json())
            .then(d => {
                authRef.current = d;
                localStorage.setItem("auth", JSON.stringify(d));
            })
            .catch(() => {
            });
    }, []);

    useEffect(() => {
        if (!userId) {
            const rand = crypto.getRandomValues(new Uint32Array(4));
            const uid = "web-" + Array.from(rand).map(n => n.toString(16)).join("");
            Cookies.set("userId", uid, {expires: 365});
            setUserId(uid);
        }
    }, [userId]);

    useEffect(() => {
        Cookies.set("darkMode", darkMode, {expires: 365});
    }, [darkMode]);

    // focus sulla search SOLO quando la modale non è aperta
    useEffect(() => {
        if (window.innerWidth < 768) return;

        const focusSearch = () => inputRef.current?.focus();

        if (!showPairModal) {
            focusSearch();               // focus iniziale
        } else {
            inputRef.current?.blur();    // togli focus quando apro la modale
        }

        const handleClick = () => {
            if (!showPairModal) {
                setTimeout(focusSearch, 200);
            }
        };

        document.addEventListener("click", handleClick);
        return () => document.removeEventListener("click", handleClick);
    }, [showPairModal]);

    useEffect(() => {
        if (loading && window.innerWidth >= 768) {
            const interval = setInterval(() => {
                setBarPosition((prev) => (prev > -30 ? prev - 0.8 : prev));
            }, 50);
            return () => clearInterval(interval);
        }
    }, [loading]);

    // funzione condivisa per verificare se il device nel cookie è ancora paired
    const checkPaired = React.useCallback(async ({signal} = {}) => {
        const id = Cookies.get("pairedDeviceId");
        if (!id) {
            setPairedDeviceId(null);
            return false;
        }

        // aspetta che authRef sia pronto (uid/sig da /auth/anon), max ~5s
        for (let i = 0; i < 50 && !authRef.current?.uid; i++) {
            await new Promise(r => setTimeout(r, 100));
            if (signal?.aborted) return false;
        }
        const {uid, sig} = authRef.current || {};
        if (!uid || !sig || signal?.aborted) return false;

        try {
            const r = await fetch(`${API_BASE}/tv/status?deviceId=${encodeURIComponent(id)}`, {
                headers: {"X-Auth-Uid": uid, "X-Auth-Sig": sig},
                cache: "no-store",
                signal
            });

            if (signal?.aborted) return false;

            if (r.ok) {
                setPairedDeviceId(id);   // è ancora valido
                return true;
            }
            const isJson = r.headers.get("content-type")?.includes("application/json");
            if (isJson && (r.status === 403 || r.status === 404)) {
                // non più tuo / inesistente → pulisci
                Cookies.remove("pairedDeviceId");
                setPairedDeviceId(null);
                return false;
            }
            // per altri status/errore rete: non tocco il cookie
        } catch {
            // rete/timeout: ignora, ritenteremo più tardi
        }
        return !!Cookies.get("pairedDeviceId");
    }, []);

    useEffect(() => {
        const ctrl = new AbortController();
        checkPaired({signal: ctrl.signal});  // run on mount
        return () => ctrl.abort();
    }, [checkPaired]);

    useEffect(() => {
        const ctrl = new AbortController();
        const onVis = () => {
            if (!document.hidden) {
                checkPaired({signal: ctrl.signal});
            }
        };
        document.addEventListener("visibilitychange", onVis);
        return () => {
            document.removeEventListener("visibilitychange", onVis);
            ctrl.abort();
        };
    }, [checkPaired]);

    const handleDigitChange = (idx, e) => {
        if (isSubmitting) return;
        setPairError("");

        const raw = e.target.value;
        const only = raw.replace(/\D/g, "");
        const next = [...pairDigits];

        if (only.length === 0) {
            next[idx] = "";
            setDigitsAndPairCode(next);
            return;
        }
        if (only.length > 1) {
            for (let i = 0; i < only.length && idx + i < DIGITS; i++) next[idx + i] = only[i];
            setDigitsAndPairCode(next);
            const last = Math.min(idx + only.length, DIGITS - 1);
            digitRefs.current[last]?.focus();
        } else {
            next[idx] = only;
            setDigitsAndPairCode(next);
            if (idx < DIGITS - 1) digitRefs.current[idx + 1]?.focus();
        }

        const complete = next.join("");
        if (complete.length === DIGITS) {
            setTimeout(() => handlePairSubmit(complete), 0);
        }
    };

    const handlePaste = (idx, e) => {
        const txt = (e.clipboardData?.getData("text") || "").replace(/\D/g, "");
        if (!txt) return;
        e.preventDefault();

        const next = [...pairDigits];
        for (let i = 0; i < txt.length && idx + i < DIGITS; i++) {
            next[idx + i] = txt[i];
        }
        setDigitsAndPairCode(next);

        const last = Math.min(idx + txt.length, DIGITS - 1);
        digitRefs.current[last]?.focus();

        const complete = next.join("");
        if (complete.length === DIGITS) {
            setTimeout(() => handlePairSubmit(complete), 0);
        }
    };

    const handleDigitKeyDown = (idx, e) => {
        if (e.key === "Backspace" && !pairDigits[idx] && idx > 0) digitRefs.current[idx - 1]?.focus();
        if (e.key === "ArrowLeft" && idx > 0) {
            e.preventDefault();
            digitRefs.current[idx - 1]?.focus();
        }
        if (e.key === "ArrowRight" && idx < DIGITS - 1) {
            e.preventDefault();
            digitRefs.current[idx + 1]?.focus();
        }
        if (e.key === "Enter") {
            e.preventDefault();
            const complete = pairDigits.join("");
            if (complete.length === DIGITS) handlePairSubmit(complete);
        }
    };

    const handleSearch = async () => {
        if (!searchTerm) return;
        if (window.innerWidth < 768) {
            inputRef.current?.blur();
        }

        // Incremento ID richiesta e salvo il corrente
        requestIdRef.current += 1;
        const thisReqId = requestIdRef.current;

        // annullo eventuale fetch precedente
        if (abortRef.current) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setError(null);
        setSearched(false);

        if (!firstSearchDone) {
            if (window.innerWidth < 768) {
                setMobileMoving(true);
                setBarPosition(0);
            }
        } else if (window.innerWidth >= 768) {
            setDesktopSecondSearch(true);
            setBarPosition(35);
            setTimeout(() => {
                setBarPosition(0);
            }, 400);
        }

        try {
            const response = await fetch(`${API_BASE}/acestream?term=${encodeURIComponent(searchTerm)}`, {
                signal: controller.signal,
                cache: "no-store"
            });
            const data = await response.json();
            if (thisReqId !== requestIdRef.current) return;
            setResults(data);
            setSearched(true);
            setBarPosition(0);
            setMobileMoving(false);
            setDesktopSecondSearch(false);
            setFirstSearchDone(true);
            // Rimuovo il focus dall'input solo in caso di successo
            if (window.innerWidth < 768) {
                setBarPosition(prev => (prev === 0 ? 0.001 : 0));
                inputRef.current?.blur();
            }
        } catch (err) {
            if (err.name === "AbortError" || thisReqId !== requestIdRef.current) return;

            setError("Errore nel recupero dei dati");
            setBarPosition(0);
            setMobileMoving(false);
            setDesktopSecondSearch(false);
            setFirstSearchDone(true);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyPress = (event) => {
        if (event.key === "Enter") {
            handleSearch();
        }
    };

    const handleCopy = (text) => {
        navigator.clipboard.writeText(text);
    };

    // pairing: invia il codice mostrato in TV
    const handlePairSubmit = async (codeArg) => {
        if (isSubmitting) return;
        const code = (codeArg ?? pairCode).trim();
        if (code.length !== DIGITS) return;

        setIsSubmitting(true);
        setPairError("");
        try {
            const res = await fetch(`${API_BASE}/tv/pair`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Auth-Uid": authRef.current?.uid || "",
                    "X-Auth-Sig": authRef.current?.sig || ""
                },
                body: JSON.stringify({pairCode: code, userId})
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "Codice non valido o scaduto");
            Cookies.set("pairedDeviceId", data.deviceId, {expires: 365});
            setPairedDeviceId(data.deviceId);
            setShowPairModal(false);          // ✅ chiude solo su successo
        } catch (e) {
            setPairError(e.message || "Codice non valido o scaduto");
            resetDigits();                    // ✅ svuota cifre e rifocalizza
        } finally {
            setIsSubmitting(false);
        }
    };

    const unpairTv = async () => {
        if (!pairedDeviceId) return true; // già scollegata lato FE

        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 8000); // timeout 8s

        try {
            const res = await fetch(`${API_BASE}/tv/unlink`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Auth-Uid": authRef.current?.uid || "",
                    "X-Auth-Sig": authRef.current?.sig || ""
                },
                body: JSON.stringify({deviceId: pairedDeviceId}),
                signal: controller.signal
            });
            const isJson = res.headers.get("content-type")?.includes("application/json");
            const data = isJson ? await res.json().catch(() => ({})) : {};

            // 200 → ok
            if (res.ok) {
                showToast("TV scollegata", "success");
                Cookies.remove("pairedDeviceId");
                setPairedDeviceId(null);
                return true;
            }

            // 404 → device inesistente → consideriamo già scollegata
            if (res.status === 404) {
                showToast("TV non trovata: considerata già scollegata", "warn");
                Cookies.remove("pairedDeviceId");
                setPairedDeviceId(null);
                return true;
            }

            // 403 → non hai più accesso a quella TV → pulizia locale
            if (res.status === 403) {
                showToast("Accesso negato: TV rimossa dal tuo account", "warn");
                Cookies.remove("pairedDeviceId");
                setPairedDeviceId(null);
                return true;
            }

            // Altri errori
            const detail = data?.detail || `Errore ${res.status}`;
            showToast(detail, "error");
            return false;

        } catch (e) {
            if (e?.name === "AbortError") {
                showToast("Timeout durante lo scollegamento", "error");
            } else {
                showToast(e?.message || "Errore di rete durante lo scollegamento", "error");
            }
            return false;
        } finally {
            clearTimeout(t);
        }
    };

    const extractCid = (raw) => {
        if (!raw) return null;
        // acestream://<CID>
        const a = raw.match(/^acestream:\/\/([A-Za-z0-9]+)/i);
        if (a) return a[1];
        // magnet:?xt=urn:btih:<INFOHASH>
        const b = raw.match(/btih:([A-F0-9]{40})/i);
        if (b) return b[1];
        // stringa nuda 40 hex
        const c = raw.match(/^([A-F0-9]{40})$/i);
        if (c) return c[1];
        return null;
    };

    // apre il chooser (gesto utente!) e ricorda se l'abbiamo aperta noi
    const openCastChooser = () => {
        try {
            if (!initCastContextOnce()) return false;
            const ctx = cast.framework.CastContext.getInstance();
            openedByUsRef.current = !ctx.getCurrentSession(); // se non c'era, l'apriremo noi
            const p = ctx.requestSession();
            if (p && p.catch) p.catch(() => {
                openedByUsRef.current = false;
            });
            return true;
        } catch {
            return false;
        }
    };

    // chiudi la sessione solo se l'abbiamo aperta noi (dopo breve delay per il CEC)
    const endCastIfOpenedByUs = (delay = 1500) => {
        if (!openedByUsRef.current) return;
        setTimeout(() => {
            try {
                const s = cast.framework.CastContext.getInstance().getCurrentSession();
                if (s) s.endSession(true);
            } catch {
            }
            openedByUsRef.current = false;
        }, delay);
    };

    const castLink = async (key, url) => {
        setCasting(s => ({...s, [key]: "loading"}));
        try {
            await sendToTv(url, [key]);
            setCasting(s => ({...s, [key]: "success"}));
            setTimeout(() => setCasting(s => ({...s, [key]: "idle"})), 1200);
        } catch (e) {
            setCasting(s => ({...s, [key]: "error"}));
            setTimeout(() => setCasting(s => ({...s, [key]: "idle"})), 1500);
        }
    };

    // invio comando alla TV: 1° giro senza Cast; se 202 → apri Cast, aspetta connessione, poi ritenta una volta
    const sendToTv = async (rawLink, [key]) => {
        if (!pairedDeviceId) {
            setShowPairModal(true);
            return;
        }

        const cid = extractCid(rawLink);
        if (!cid) {
            showToast("Non riesco a estrarre il CID da questo link.", "error");
            return;
        }

        // helper: singolo invio + parsing "status" dal backend
        const doSend = async () => {
            const res = await fetch(`${API_BASE}/tv/send`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Auth-Uid": authRef.current?.uid || "",
                    "X-Auth-Sig": authRef.current?.sig || ""
                },
                body: JSON.stringify({deviceId: pairedDeviceId, action: "acestream", cid})
            });

            const isJson = res.headers.get("content-type")?.includes("application/json");
            const data = isJson ? await res.json().catch(() => ({})) : {};
            const status = data?.status;

            // pairing perso
            if (res.status === 403 || res.status === 404) {
                Cookies.remove("pairedDeviceId");
                setPairedDeviceId(null);
                setShowPairModal(true);
                throw new Error("TV non più collegata");
            }

            // ok + consegnato
            if (res.status === 200 && status === "delivered") return true;

            // 202 = no ack / offline / invio fallito → segnalo per fallback
            if (res.status === 202) {
                const err = new Error("TV non raggiungibile al momento");
                err.code = 202;
                err.reason = status;
                throw err;
            }

            if (!res.ok) throw new Error("Invio fallito");
            return true;
        };

        try {
            // 1) primo giro senza Cast
            await doSend();
            showToast("Inviato alla TV!", "success"); // opzionale
        } catch (e) {
            // 2) solo se è il caso "non raggiungibile": apri Cast, *aspetta connessione*, poi ritenta
            if (e?.code === 202) {
                setCasting(s => ({...s, [key]: "success"}));
                const want = await askConfirm(
                    "Nessuna risposta rapida dalla TV. Provo ad attivarla via Cast e ritentare?",
                    () => openCastChooser()
                );
                if (want) {
                    const ready = await waitForCastReady(8000);
                    if (!ready) {
                        showToast("Non sono riuscito a collegarmi via Cast.", "error");
                        endCastIfOpenedByUs();
                        return;
                    }
                    await new Promise(r => setTimeout(r, 1000));
                    try {
                        await doSend();         // retry una volta, ora che la TV è accesa
                        showToast("Inviato alla TV!", "success");
                    } catch (e2) {
                        showToast(e2.message || "Invio non riuscito", "error");
                    } finally {
                        endCastIfOpenedByUs();  // chiudi la sessione Cast solo se l’abbiamo aperta noi
                    }
                }
            } else
                showToast(e.message || "Errore invio", "error");
        } finally {
            // no-op se non l’abbiamo aperta noi
            endCastIfOpenedByUs();
        }
    };

    return (
        <>
            {/* BACKGROUND CROSSFADE — due layer sempre presenti */}
            <div className="theme-crossfade">
                <motion.div
                    key="light-bg"
                    initial={false}
                    animate={{opacity: darkMode ? 0 : 1}}
                    transition={{duration: 0.35, ease: "easeInOut", delay: darkMode ? 0.12 : 0}}
                    className="bg-gray-100"
                />
                <motion.div
                    key="dark-bg"
                    initial={false}
                    animate={{opacity: darkMode ? 1 : 0}}
                    transition={{duration: 0.35, ease: "easeInOut"}}
                    className="bg-gray-950"
                />
            </div>
            <motion.div
                animate={{scale: isSwitching ? 0.985 : 1}}
                transition={{duration: 0.30, ease: "easeOut"}}
                className="theme-root relative isolate flex flex-col items-center min-h-screen p-4 select-none text-black dark:text-white will-change-transform"
            >
                <div className="w-full flex items-center justify-end p-4 gap-4">
                    {/* Stato TV */}
                    {pairedDeviceId ? (
                        <button
                            className="inline-flex items-center gap-2
                             rounded-full md:rounded-md
                             p-2 md:px-3 md:py-1
                             focus:outline-none focus:ring-2  text-green-600 md:border md:border-green-600 hover:bg-green-600/10 md:hover:bg-green-600 md:hover:text-white"
                            title={`TV collegata (${pairedDeviceId}) — clicca per scollegare`}
                            aria-label="TV collegata: scollega"
                            onClick={() =>
                                askConfirm("Vuoi scollegare la TV?", () => {
                                    unpairTv().then();
                                })
                            }
                        >
                            <MdCastConnected className="shrink-0 text-3xl md:text-xl"/>
                            <span className="hidden md:inline">TV collegata</span>
                        </button>
                    ) : (
                        <button
                            className="inline-flex items-center gap-2
                             rounded-full md:rounded-md
                             p-2 md:px-3 md:py-1
                             focus:outline-none focus:ring-2 text-purple-600 md:border md:border-purple-600 hover:bg-purple-600/10 md:hover:bg-purple-600 md:hover:text-white"
                            title="Connetti TV"
                            aria-label="Connetti TV"
                            onClick={() => setShowPairModal(true)}
                        >
                            <MdCast className="shrink-0 text-3xl md:text-xl"/>
                            <span className="hidden md:inline">Connetti TV</span>
                        </button>
                    )}

                    {/* (opzionale) pulsante ufficiale Cast */}
                    {/*<google-cast-launcher style={{width: 36, height: 36}}/>*/}

                    <motion.button
                        onClick={toggleTheme}
                        aria-pressed={darkMode}
                        className="relative inline-flex items-center justify-center h-10 w-10 rounded-full focus:outline-none"
                        whileTap={{scale: 0.9}}
                        whileHover={{scale: 1.08}}
                        transition={{type: "spring", stiffness: 500, damping: 26}}
                        title={darkMode ? "Passa a chiaro" : "Passa a scuro"}
                    >
                        <AnimatePresence initial={false} mode="wait">
                            {darkMode ? (
                                <motion.span
                                    key="sun"
                                    initial={{rotate: -90, opacity: 0, scale: 0.7}}
                                    animate={{rotate: 0, opacity: 1, scale: 1}}
                                    exit={{rotate: 90, opacity: 0, scale: 0.7}}
                                    transition={{duration: 0.30, ease: "easeInOut"}}
                                    className="inline-flex"
                                >
                                    <FaSun className="text-purple-600 text-2xl"/>
                                </motion.span>
                            ) : (
                                <motion.span
                                    key="moon"
                                    initial={{rotate: 90, opacity: 0, scale: 0.7}}
                                    animate={{rotate: 0, opacity: 1, scale: 1}}
                                    exit={{rotate: -90, opacity: 0, scale: 0.7}}
                                    transition={{duration: 0.30, ease: "easeInOut"}}
                                    className="inline-flex"
                                >
                                    <FaMoon className="text-purple-600 text-2xl"/>
                                </motion.span>
                            )}
                        </AnimatePresence>
                    </motion.button>
                </div>
                <motion.div
                    initial={{y: window.innerWidth < 768 ? "20vh" : "30vh"}}
                    animate={{y: `${barPosition}vh`}}
                    transition={{
                        duration: searched ? 0.4 : mobileMoving || desktopSecondSearch ? 1.5 : 2.5,
                        ease: "easeOut"
                    }}
                    className={`w-full z-10 max-w-3xl ${darkMode ? 'bg-gray-800 shadow-purple-900' : 'bg-white shadow-purple-300'} p-4 rounded-full flex items-center shadow-lg focus-within:ring-2 focus-within:ring-purple-600 transition relative`}
                >
                    <motion.div className="ml-4 opacity-50">
                        <FaSearch className="text-2xl text-purple-600"/>
                    </motion.div>
                    <div className="w-full flex">
                        <input
                            ref={inputRef}
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={handleKeyPress}
                            placeholder="Acestream..."
                            className={`flex-grow p-2 bg-transparent border-none outline-none text-lg ${darkMode ? 'text-white placeholder-gray-400' : 'text-black placeholder-gray-600'}`}
                        />
                    </div>
                    <div className="absolute right-6">
                        {loading ? (
                            <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-purple-600"></div>
                        ) : (
                            <FaArrowRight className="text-2xl text-purple-600 cursor-pointer" onClick={handleSearch}/>
                        )}
                    </div>
                </motion.div>
                {error && <p className="mt-4 text-red-500">{error}</p>}
                {results && (
                    <div className="mt-6 w-full max-w-xl">
                        {results.every(source => !Array.isArray(source.events) || source.events.length === 0) ? (
                            <div
                                className={`p-4 mb-4 mt-4 rounded-xl shadow-lg ${darkMode ? 'bg-gray-800 text-white shadow-purple-900' : 'bg-white text-black shadow-purple-300'} transform transition-transform mouse:hover:scale-[1.03]`}
                            >
                                <p className="text-gray-500">Nessun link trovato</p>
                            </div>
                        ) : (
                            results.map((source, index) => (
                                Array.isArray(source.events) && source.events.length > 0 && source.events.map((event, j) => (
                                    <div
                                        key={`${index}-${j}`}
                                        className={`p-4 mb-4 rounded-xl shadow-lg ${darkMode ? 'bg-gray-800 text-white shadow-purple-900' : 'bg-white text-black shadow-purple-300'} transform transition-transform mouse:hover:scale-[1.02]`}
                                    >
                                        <p className="text-gray-400 text-sm font-semibold">{event.event_title || "Senza titolo"}</p>
                                        <ul className="mt-2">
                                            {Array.isArray(event.acestream_links) && event.acestream_links.length > 0 ? (
                                                event.acestream_links.map((link, i) => {
                                                    const keyId = `${index}-${j}-${i}`;
                                                    const state = casting[keyId] ?? "idle";
                                                    const isLoading = state === "loading";
                                                    return (
                                                        <li
                                                            key={i}
                                                            className="mt-2 flex items-center gap-2"
                                                        >
                                                            <span
                                                                className={`quality ${darkMode ? 'shadow-purple-900' : 'shadow-purple-300'} shadow-md ${link.quality ? `quality-${link.quality.toLowerCase()}` : 'quality-none'}`}
                                                            >
                                                                {link.quality || ""}
                                                            </span>
                                                            <CircleFlag className={`rounded-full ${darkMode ? 'shadow-purple-900' : 'shadow-purple-300'} shadow-md`} countryCode={link.language} width="27"/>
                                                            <a
                                                                href={link.link}
                                                                className="font-mono flex-1 min-w-0 text-purple-500 hover:underline truncate"
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                            >
                                                                {link.link}
                                                            </a>
                                                            <div className="flex items-center gap-2 flex-none">
                                                                <FaCopy
                                                                    className="text-purple-600 cursor-pointer shrink-0 text-2xl"
                                                                    onClick={() => handleCopy(link.link)}
                                                                    title="Copia"
                                                                />
                                                                {pairedDeviceId && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => castLink(keyId, link.link)}
                                                                        disabled={isLoading}
                                                                        aria-busy={isLoading}
                                                                        title={isLoading ? "Invio in corso…" : "Invia alla TV collegata"}
                                                                        className={`shrink-0 p-0.5 rounded ${isLoading ? "cursor-wait opacity-70" : "cursor-pointer"}`}
                                                                    >
                                                                        {isLoading ? (
                                                                            // stesso spinner della ricerca, solo più piccolo
                                                                            <div
                                                                                className="animate-spin rounded-full h-6 w-6 border-t-2 text-3xl border-purple-600"/>
                                                                        ) : (
                                                                            <MdCast
                                                                                className="text-purple-600 text-3xl"/>
                                                                        )}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </li>
                                                    );
                                                })
                                            ) : (
                                                <p className="text-gray-500">Nessun link trovato</p>
                                            )}
                                        </ul>
                                    </div>
                                ))
                            ))
                        )}
                    </div>
                )}
                {showPairModal && (
                    <div
                        className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-[20dvh] md:pt-[25dvh] lg:items-center lg:pt-0"
                        onClick={() => setShowPairModal(false)}>
                        <div
                            className={`${darkMode ? "bg-gray-900 text-white" : "bg-white text-black"} w-[92vw] max-w-md rounded-2xl p-5`}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div
                                className={`mb-4 text-center rounded-xl border ${darkMode ? "border-gray-700 bg-gray-800/60" : "border-gray-200 bg-gray-50"}
                            p-2.5 flex flex-col items-center sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3`}
                            >
                                <p className="m-0 font-semibold text-lg sm:text-xl leading-tight">Collega TV</p>
                                <a
                                    href={TV_APP_URL}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition focus:outline-none focus:ring-2
                             ${darkMode ? "bg-purple-700 hover:bg-purple-600 text-white" : "bg-purple-600 hover:bg-purple-700 text-white"}`}
                                >
                                    <FaGooglePlay className="text-base"/>
                                    Scarica l’app
                                </a>
                            </div>
                            <p className="text-sm opacity-80 mb-3 text-center">
                                Inserisci il <strong>codice a 6 cifre</strong>
                            </p>

                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    handlePairSubmit(pairDigits.join(""));
                                }}
                                className="flex flex-col gap-4"
                            >
                                <div className="flex justify-center gap-2">
                                    {Array.from({length: DIGITS}).map((_, idx) => (
                                        <input
                                            key={idx}
                                            ref={(el) => (digitRefs.current[idx] = el)}
                                            value={pairDigits[idx]}
                                            onChange={(e) => handleDigitChange(idx, e)}
                                            onPaste={(e) => handlePaste(idx, e)}
                                            onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                                            type="tel"
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            autoComplete="one-time-code"
                                            autoFocus={idx === 0}
                                            maxLength={1}
                                            className={`w-12 h-14 text-center text-2xl rounded-lg border outline-none
                                          ${pairError
                                                ? "border-red-500 focus:border-red-500"
                                                : darkMode
                                                    ? "bg-gray-800 border-gray-700 focus:border-purple-500"
                                                    : "bg-white border-gray-300 focus:border-purple-600"
                                            }`}
                                        />
                                    ))}
                                </div>
                                {pairError && (
                                    <div className="text-red-500 text-sm text-center -mt-2">
                                        {pairError}
                                    </div>
                                )}
                            </form>
                        </div>
                    </div>
                )}

                {/* TOASTS */}
                <div className="fixed bottom-4 inset-x-0 z-[60] pointer-events-none flex justify-center">
                    <div className="space-y-2 w-full max-w-sm px-4">
                        {toasts.map(t => (
                            <div key={t.id}
                                 className={`pointer-events-auto ${toastClass(t.variant)} text-white rounded-xl px-4 py-3`}>
                                {t.message}
                            </div>
                        ))}
                    </div>
                </div>

                {/* CONFIRM MODAL */}
                {confirmState.open && (
                    <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4"
                         onClick={() => handleConfirmClose(false)}>
                        <div className={`${darkMode ? "bg-gray-900 text-white" : "bg-white text-black"}
                    w-full max-w-md rounded-2xl p-5`} onClick={(e) => e.stopPropagation()}>
                            <p className="text-lg font-semibold mb-3">Conferma</p>
                            <p className="opacity-80 mb-5">{confirmState.text}</p>
                            <div className="flex gap-2 justify-end">
                                <button
                                    className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700"
                                    onClick={() => handleConfirmClose(false)}
                                >Annulla
                                </button>
                                <button
                                    className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700"
                                    onClick={() => handleConfirmClose(true)}
                                >OK
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </motion.div>
        </>
    );
}
