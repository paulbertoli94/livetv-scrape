import {useEffect, useRef, useState} from "react";
import {motion} from "framer-motion";
import {FaArrowRight, FaCopy, FaMoon, FaSearch, FaSun} from "react-icons/fa";
import Cookies from "js-cookie";
import AceStreamPlayer from "./AceStreamPlayer";

export default function App() {
    const [searchTerm, setSearchTerm] = useState("");
    const [results, setResults] = useState(null);
    const [playerCid, setPlayerCid] = useState(null);
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
    const BASE_URL = process.env.NODE_ENV === "development" ? "http://localhost:5000" : "";

    useEffect(() => {
        Cookies.set("darkMode", darkMode, {expires: 365});
    }, [darkMode]);

    useEffect(() => {
        if (window.innerWidth >= 768) {
            inputRef.current?.focus();
            const handleClick = () => {
                setTimeout(() => inputRef.current?.focus(), 200);
            };
            document.addEventListener("click", handleClick);
            return () => document.removeEventListener("click", handleClick);
        }
    }, []);

    useEffect(() => {
        if (loading && window.innerWidth >= 768) {
            const interval = setInterval(() => {
                setBarPosition((prev) => (prev > -30 ? prev - 0.8 : prev));
            }, 50);
            return () => clearInterval(interval);
        }
    }, [loading]);

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

    // Estrae CID/InfoHash da vari formati di link
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

    const openInPlayer = (rawLink) => {
        const cid = extractCid(rawLink);
        if (cid) setPlayerCid(cid);
        else alert("Impossibile ricavare il CID da questo link.");
    };

    return (
        <div
            className={`flex flex-col items-center min-h-screen p-4 select-none ${darkMode ? 'bg-gray-950 text-white' : 'bg-gray-100 text-black'}`}>
            <div className="w-full flex justify-end p-4">
                <button onClick={() => setDarkMode(!darkMode)} className="text-xl focus:outline-none">
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
                                            <div className="flex items-center gap-2 ml-2 shrink-0">
                                                <button
                                                    className="text-sm px-2 py-1 rounded-md border border-purple-600 text-purple-600 hover:bg-purple-600 hover:text-white transition"
                                                    onClick={() => openInPlayer(link.link)}
                                                    title="Riproduci nel player integrato"
                                                >
                                                    Play
                                                </button>
                                                <FaCopy className="text-purple-600 cursor-pointer"
                                                        onClick={() => handleCopy(link.link)}
                                                        title="Copia il link"/>
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
            {/* overlay player dentro al root */}
            {playerCid && (
                <AceStreamPlayer
                    cid={playerCid}
                    dark={darkMode}
                    onClose={() => setPlayerCid(null)}
                />
            )}
        </div>
    );
}
