import React, {useEffect, useRef, useState} from "react";
import {motion} from "framer-motion";
import {FaArrowRight, FaCopy, FaGooglePlay, FaMoon, FaSearch, FaSun} from "react-icons/fa";
import {MdCast, MdCastConnected} from "react-icons/md";
import Cookies from "js-cookie";

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
                headers: {"Content-Type": "application/json"},
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

    const unpairTv = () => {
        Cookies.remove("pairedDeviceId");
        setPairedDeviceId(null);
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

    // invio comando alla TV (apre AceStream con CID)
    const sendToTv = async (rawLink) => {
        if (!pairedDeviceId) {
            setShowPairModal(true);
            return;
        }
        const cid = extractCid(rawLink);
        if (!cid) {
            alert("Non riesco a estrarre il CID da questo link.");
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/tv/send?userId=${encodeURIComponent(userId)}`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({deviceId: pairedDeviceId, action: "acestream", cid})
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || "Invio fallito");
            // feedback semplice
            alert("Inviato alla TV!");
        } catch (e) {
            alert(e.message || "Errore invio");
        }
    };

    return (
        <div
            className={`flex flex-col items-center min-h-screen p-4 select-none ${darkMode ? 'bg-gray-950 text-white' : 'bg-gray-100 text-black'}`}>
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
                        onClick={unpairTv}
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

                <button onClick={() => setDarkMode(!darkMode)} className="text-2xl focus:outline-none">
                    {darkMode ? <FaSun className="text-purple-600"/> : <FaMoon className="text-purple-600"/>}
                </button>
            </div>
            <motion.div
                initial={{y: window.innerWidth < 768 ? "20vh" : "30vh"}}
                animate={{y: `${barPosition}vh`}}
                transition={{
                    duration: searched ? 0.4 : mobileMoving || desktopSecondSearch ? 1.5 : 2.5,
                    ease: "easeOut"
                }}
                className={`w-full max-w-xl ${darkMode ? 'bg-gray-800' : 'bg-white'} p-4 rounded-full flex items-center shadow-lg focus-within:ring-2 focus-within:ring-purple-600 transition border border-gray-300 relative shadow-[0px_4px_10px_rgba(0,0,0,0.1)]`}
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
                <div className="mt-6 w-full max-w-lg">
                    {results.map((source, index) => (
                        <motion.div
                            key={index}
                            initial={{opacity: 0, y: 20}}
                            animate={{opacity: 1, y: 0}}
                            transition={{duration: 0.4, delay: index * 0.1}}
                            className={`p-4 mb-4 rounded-xl shadow-lg ${darkMode ? 'bg-gray-800 text-white' : 'bg-white text-black'} border border-gray-600 transform transition-transform hover:scale-[1.03] hover:shadow-[0px_6px_14px_rgba(0,0,0,0.3)] shadow-[0px_4px_10px_rgba(0,0,0,0.1)]`}
                        >
                            <p className="text-gray-400 text-sm font-semibold">{source.game_title || "Senza titolo"}</p>
                            <ul className="mt-2">
                                {Array.isArray(source.acestream_links) && source.acestream_links.length > 0 ? (
                                    source.acestream_links.map((link, i) => (
                                        <li
                                            key={i}
                                            className="mt-2 flex items-center gap-2"
                                        >
                                            {/* Link a sinistra che trunca, prende lo spazio */}
                                            <a
                                                href={link.link}
                                                className="flex-1 min-w-0 text-purple-500 hover:underline truncate"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                {link.language ? `${link.language} - ` : ""} {link.link}
                                            </a>

                                            {/* Azioni a destra, dimensione fissa */}
                                            <div className="flex items-center gap-2 flex-none">
                                                <FaCopy
                                                    className="text-purple-600 cursor-pointer shrink-0 text-xl"
                                                    onClick={() => handleCopy(link.link)}
                                                    title="Copia"
                                                />
                                                {pairedDeviceId && (
                                                    <MdCast
                                                        className="text-purple-600 cursor-pointer shrink-0 text-xl"
                                                        onClick={() => sendToTv(link.link)}
                                                        title="Invia alla TV collegata"
                                                    />
                                                )}
                                            </div>
                                        </li>
                                    ))
                                ) : (
                                    <p className="text-gray-500">Nessun link trovato</p>
                                )}
                            </ul>
                        </motion.div>
                    ))}
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
        </div>
    );
}
