import { useState } from "react";
import { motion } from "framer-motion";
import { FaSearch } from "react-icons/fa";

export default function App() {
    const [searchTerm, setSearchTerm] = useState("");
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [searched, setSearched] = useState(false);

    const handleSearch = async () => {
        if (!searchTerm) return;
        setLoading(true);
        setError(null);
        setSearched(true);

        try {
            const response = await fetch(`http://127.0.0.1:5000/acestream?term=${encodeURIComponent(searchTerm)}`);
            const data = await response.json();
            setResults(data);
        } catch (err) {
            setError("Errore nel recupero dei dati");
        } finally {
            setLoading(false);
        }
    };

    const handleKeyPress = (event) => {
        if (event.key === "Enter") {
            handleSearch();
        }
    };

    return (
        <div className="flex flex-col items-center min-h-screen p-4 bg-gray-100">
            <motion.div
                initial={{ y: "25vh" }}
                animate={{ y: searched ? 0 : "25vh" }}
                transition={{ duration: 0.5 }}
                className="w-full max-w-lg bg-white p-4 rounded-xl shadow-md flex items-center"
            >
                <motion.div
                    initial={{ y: 0 }}
                    animate={{ y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="mr-2"
                >
                    <FaSearch className="text-blue-600 text-3xl" />
                </motion.div>
                <div className="w-full flex">
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={handleKeyPress}
                        placeholder="Inserisci il nome della partita"
                        className="flex-grow p-2 border border-gray-300 rounded-l-lg focus:outline-none"
                    />
                    <button
                        onClick={handleSearch}
                        className="px-4 py-2 bg-blue-600 text-white rounded-r-lg hover:bg-blue-700"
                    >
                        Cerca
                    </button>
                </div>
            </motion.div>
            {loading && <p className="mt-4 text-gray-700">Caricamento...</p>}
            {error && <p className="mt-4 text-red-500">{error}</p>}
            {results && (
                <div className="mt-6 w-full max-w-lg">
                    {results.map((source, index) => (
                        <div key={index} className="bg-white p-4 mb-4 rounded-xl shadow">
                            <h2 className="text-xl font-bold mb-2">{source.source}</h2>
                            <p className="text-gray-700">{source.game_title || "Nessun titolo trovato"}</p>
                            <ul className="mt-2">
                                {source.acestream_links.length > 0 ? (
                                    source.acestream_links.map((link, i) => (
                                        <li key={i} className="mt-2">
                                            <a
                                                href={link.link}
                                                className="text-blue-600 hover:underline"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                {link.language ? `${link.language} - ` : ""} {link.link}
                                            </a>
                                        </li>
                                    ))
                                ) : (
                                    <p className="text-gray-500">Nessun link trovato</p>
                                )}
                            </ul>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
