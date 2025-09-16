import {useEffect, useRef, useState} from "react";
import {motion} from "framer-motion";
import {FaArrowRight, FaCopy, FaMoon, FaSearch, FaSun, FaTv, FaUnlink} from "react-icons/fa";
import Cookies from "js-cookie";

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
        if (showPairModal) {
            setPairError("");
            resetDigits();
        }
    }, [showPairModal]);

    // quando apro la modale: reset e focus sul primo
    useEffect(() => {
        if (showPairModal) {
            const empty = Array(DIGITS).fill("");
            setDigitsAndPairCode(empty);
            setTimeout(() => digitRefs.current[0]?.focus(), 0);
        }
    }, [showPairModal]);

    // userId locale (solo per demo/back-end semplice)
    const [userId, setUserId] = useState(() => Cookies.get("userId") || null);

    const BASE_URL = process.env.NODE_ENV === "development" ? "http://localhost:5000" : "";

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
            const response = await fetch(`${BASE_URL}/acestream?term=${encodeURIComponent(searchTerm)}`);
            const data = await response.json();
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
            const res = await fetch(`${BASE_URL}/tv/pair`, {
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
            const res = await fetch(`${BASE_URL}/tv/send?userId=${encodeURIComponent(userId)}`, {
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
                        className="flex items-center gap-3 px-3 py-1 rounded-md border border-green-600 text-green-600 hover:bg-green-600 hover:text-white transition"
                        title={`TV collegata (${pairedDeviceId}) — clicca per scollegare`}
                        onClick={unpairTv}
                    >
                        <FaTv className="shrink-0"/>
                        <span className="hidden sm:inline">TV collegata</span>
                        <FaUnlink className="opacity-80 ml-1"/>
                    </button>
                ) : (
                    <button
                        className="flex items-center gap-3 px-3 py-1 rounded-md border border-purple-600 text-purple-600 hover:bg-purple-600 hover:text-white transition"
                        title="Collega una TV"
                        onClick={() => setShowPairModal(true)}
                    >
                        <FaTv className="shrink-0"/>
                        <span className="hidden sm:inline">Collega TV</span>
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
                                        <li key={i}
                                            className="mt-2 flex justify-between items-center text-ellipsis overflow-hidden">
                                            <a
                                                href={link.link}
                                                className="text-purple-500 hover:underline truncate"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                {link.language ? `${link.language} - ` : ""} {link.link}
                                            </a>
                                            <FaCopy className="text-purple-600 cursor-pointer ml-2"
                                                    onClick={() => handleCopy(link.link)}/>
                                            {/* INVIA ALLA TV */}
                                            {pairedDeviceId && (
                                                <FaTv
                                                    className="text-purple-600 cursor-pointer ml-2"
                                                    onClick={() => sendToTv(link.link)}
                                                    title="Invia alla TV collegata"
                                                />
                                            )}
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
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
                     onClick={() => setShowPairModal(false)}>
                    <div
                        className={`${darkMode ? "bg-gray-900 text-white" : "bg-white text-black"} w-[92vw] max-w-md rounded-2xl p-5`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 className="text-lg font-semibold mb-2">Collega una TV</h2>
                        <p className="text-sm opacity-80 mb-3">
                            Inserisci il <strong>codice a 6 cifre</strong> mostrato sulla TV (puoi anche incollarlo).
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
