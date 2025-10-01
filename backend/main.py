import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from datetime import datetime, timedelta
from pathlib import Path
from secrets import token_hex

import requests
import unicodedata
from bs4 import BeautifulSoup
from flask import Flask, request, send_from_directory
from flask import jsonify
from rapidfuzz import fuzz

from auth import sign_uid
from db import init_db
from pair import tv_bp
from word import SYNONYMS, STOPWORDS

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# Init DB all'avvio
init_db()

BASE_DIR = Path(__file__).resolve().parent

CANDIDATES = [
    BASE_DIR / "frontend" / "dist",  # docker / run dopo COPY
    BASE_DIR.parent / "frontend" / "dist",  # sviluppo locale: ../frontend/dist
]
FRONTEND_DIR = None
for p in CANDIDATES:
    if (p / "index.html").exists():
        FRONTEND_DIR = p.resolve()
        break

if not FRONTEND_DIR:
    raise RuntimeError(
        "index.html non trovato. Esegui la build del frontend:\n"
        "  cd ../frontend && npm run build\n"
        "Oppure verifica il COPY nel Dockerfile su ./frontend/dist"
    )


def _norm_simple(s: str) -> str:
    return re.sub(r"\s+", " ", normalize_string((s or "").lower())).strip()


def _apply_syn(s: str) -> str:
    text = s
    for k, v in SYNONYMS.items():
        text = re.sub(rf"\b{re.escape(k)}\b", v, text)
    return text


def _tokens(s: str) -> list[str]:
    return [t for t in s.split() if t and t not in STOPWORDS]


def _gate_ok(q_clean: str, t_clean: str) -> bool:
    """Accetta solo se c'è overlap serio: almeno un token ≥3 char in comune
    OPPURE substring di un token query (≥4 char) nel titolo
    OPPURE partial_ratio alto."""
    q_tokens = [tok for tok in _tokens(q_clean) if len(tok) >= 3]
    t_tokens = [tok for tok in _tokens(t_clean) if len(tok) >= 3]
    if set(q_tokens) & set(t_tokens):
        return True
    if any(tok in t_clean for tok in q_tokens if len(tok) >= 4):
        return True
    if fuzz.partial_ratio(q_clean, t_clean) >= 80:
        return True
    return False


def _score(q_clean: str, t_clean: str) -> float:
    """Score semplice e robusto ai typo/riordini."""
    s1 = fuzz.token_set_ratio(q_clean, t_clean)  # robusto a ordine/parole extra
    s2 = fuzz.partial_ratio(q_clean, t_clean)  # robusto a sottostringhe/typo
    # bonus se la query (pulita) è substring del titolo
    bonus = 6 if q_clean in t_clean and len(q_clean) >= 4 else 0
    return float(max(s1, s2) + bonus)


def search_events_pipeline(parsed_events: list[dict],
                           search_term: str,
                           top_n: int = 3,
                           strong_threshold_title: float = 90.0,
                           min_score_desc: float = 72.0) -> list[dict]:
    """
    1) Titolo: se esiste uno strong match (>= strong_threshold_title) → ritorna SOLO quello.
    2) Descrizione/Competition: se no, ritorna fino a top_n risultati sopra min_score_desc.
    """
    if not search_term:
        return []

    q_clean = _apply_syn(_norm_simple(search_term))

    # ---------- PASS 1: TITOLO (strong -> 1 solo risultato) ----------
    strong_hits = []
    for idx, ev in enumerate(parsed_events):
        title = ev.get("title") or ev.get("titolo") or ""
        t_clean = _apply_syn(_norm_simple(title))
        if not _gate_ok(q_clean, t_clean):
            continue
        s = _score(q_clean, t_clean)
        if s >= strong_threshold_title:
            strong_hits.append((idx, s))

    if strong_hits:
        best_idx, best_s = max(strong_hits, key=lambda x: x[1])
        ev = parsed_events[best_idx]
        return [{**ev, "_score": round(best_s, 2), "_match": "strong_title"}]

    # ---------- PASS 2: DESCRIZIONE / COMPETITION (multi risultati) ----------
    scored_desc = []
    for idx, ev in enumerate(parsed_events):
        comp = ev.get("competition") or ev.get("descrizione") or ""
        if not comp.strip():
            continue
        c_clean = _apply_syn(_norm_simple(comp))
        if not _gate_ok(q_clean, c_clean):
            continue
        s = _score(q_clean, c_clean)
        if s >= min_score_desc:
            scored_desc.append((idx, s))

    scored_desc.sort(key=lambda x: x[1], reverse=True)
    out = []
    for idx, s in scored_desc[:top_n]:
        ev = parsed_events[idx]
        out.append({**ev, "_score": round(s, 2), "_match": "desc"})
    return out


logging.info(f"[STATIC] Uso frontend da: {FRONTEND_DIR}")

app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="/")
app.register_blueprint(tv_bp)
session = requests.Session()


@app.get("/")
def _index():
    return send_from_directory(app.static_folder, "index.html")


@app.post("/auth/anon")
def auth_anon():
    uid = "u_" + token_hex(8)
    return jsonify({"uid": uid, "sig": sign_uid(uid)})


@app.route('/acestream', methods=['GET'])
def acestream():
    logging.info(f"Ricevuta richiesta con termine di ricerca: {request.args.get('term')}")

    result = []
    raw_term = request.args.get('term', '')
    search_term = ' '.join(raw_term.split())
    if not search_term:
        logging.error("Parametro 'term' mancante")
        return jsonify({"error": "Parameter 'term' is required"}), 400
    # ================TEST====================================================#
    res = test_link(search_term)
    if res:
        return res
    # ================TEST====================================================#

    start_time = time.time()
    with ThreadPoolExecutor(max_workers=2) as executor:
        f_ltv = executor.submit(livetv_scraper, search_term)
        f_ps = executor.submit(platinsport_scraper, search_term)

        results = []
        try:
            f_ltv_res = f_ltv.result(timeout=5)
            results.append(f_ltv_res)
        except FuturesTimeoutError:
            f_ltv.cancel()
            results.append({"source": "LiveTV", "error": "timeout"})

        try:
            f_ps_res = f_ps.result(timeout=5)
            results.append(f_ps_res)
        except FuturesTimeoutError:
            f_ps.cancel()
            results.append({"source": "PlatinSport", "error": "timeout"})

    logging.info(f"Tempo totale per l'elaborazione della richiesta: {time.time() - start_time:.2f} secondi")
    return jsonify(results)


LANG_CODE = {
    # ID -> code
    "1": "ru",
    "2": "uk",
    "3": "ua",
    "4": "nl",
    "5": "sa",  # "ae" se preferisci EAU
    "6": "cn",
    "7": "es",
    "8": "pl",
    "9": "br",
    "10": "tr",
    "11": "fr",
    "12": "it",
    "13": "de",
    "14": "ro",

    # name (lowercase) -> code
    "russian": "ru",
    "english": "uk",
    "ukrainian": "ua",
    "dutch": "nl",
    "arabic": "sa",
    "chinese": "cn",
    "spanish": "es",
    "polish": "pl",
    "portuguese": "pt",
    "turkish": "tr",
    "french": "fr",
    "italian": "it",
    "german": "de",
    "romanian": "ro",
}


def _s(x):  # safe str
    return (x or "").strip()


def resolve_lang_code(title: str | None, src: str | None) -> str | None:
    # prova dal title (nome lingua)
    if title:
        key = title.strip().lower()
        code = LANG_CODE.get(key)
        if code:
            return code
    # fallback: prova dall'ID nel src
    if src:
        m = re.search(r'/linkflag/(\d+)\.png', src)
        if m:
            return LANG_CODE.get(m.group(1))
    return None


def make_request_with_retry(url, retries=2, delay=0.3, timeout=0.2):
    """
    Effettua una richiesta HTTP con sessione, retry e timeout configurabili.
    """
    for attempt in range(retries):
        # per ogni tentativo aumento il timeout con il delay
        timeout = timeout + delay
        try:
            response = session.get(url, timeout=timeout)
            response.raise_for_status()
            return response
        except requests.exceptions.RequestException as e:
            logging.warning(f"Tentativo {attempt + 1} fallito per {url}: {e}")
            time.sleep(delay)
    raise requests.exceptions.RequestException(f"Impossibile ottenere una risposta da {url} dopo {retries} tentativi")


def normalize_string(s):
    return unicodedata.normalize('NFKD', s).encode('ASCII', 'ignore').decode('utf-8')


def parse_platin_table(html: str):
    soup = BeautifulSoup(html, "html.parser")
    items = []
    current_league = ""

    # la pagina reale ha più tabelle; qui prendiamo tutte le righe
    for tr in soup.select("div.entry table tbody tr"):
        # riga di intestazione lega
        stil = tr.select_one("td.stil")
        if stil:
            current_league = stil.get_text(" ", strip=True)
            continue

        tds = tr.find_all("td")
        if len(tds) < 3:
            continue

        # orario (preferisci <time>, fallback al testo del td)
        t_time = tr.select_one("td.boy time")
        time_txt = (t_time.get_text(strip=True) if t_time else tds[0].get_text(strip=True))

        # titolo partita
        title_txt = tds[1].get_text(" ", strip=True)

        # link bottone ACESTREAM
        a = tr.select_one("td.boy2 a[href]")
        if not a:
            continue
        href = a["href"].strip()

        # molti link sono del tipo bc.vc/.../https://www.platinsport.com/link/...
        # → estrai l'ultima https://
        if "https://" in href:
            target = "https://" + href.split("https://")[-1]
        else:
            target = href

        items.append({
            "league": current_league,
            "time": time_txt,
            "title": title_txt,
            "href": target,
        })

    return items


def test_link(search_term):
    if search_term == "test":
        return jsonify([
            {
                "search_term": search_term,
                "events": [{
                    "event_title": "Tuffi | Redbull | 00:00",
                    "acestream_links": [
                        {
                            "link": "acestream://963d5f09983d6816022fc2c45dd4d974337adb09",
                            "bitrate": "3000 kbps",
                            "language": "it"
                        }
                    ]
                }]
            }
        ])


def livetv_scraper(search_term: str):
    base_url = 'https://livetv'
    domain_suffix = '.me'
    max_attempts = 2
    base_attempt = 863
    livetv_number = base_attempt

    logging.info(f"Inizio scraping LiveTV{livetv_number} per: {search_term}")
    start_time = time.time()

    while livetv_number <= base_attempt + max_attempts:
        site_url = f'{base_url}{livetv_number}{domain_suffix}'
        path_upcoming = site_url + '/enx/allupcoming/'

        try:
            response = make_request_with_retry(path_upcoming)
            response.raise_for_status()
            logging.info(f"LiveTV{livetv_number} risposta in {time.time() - start_time:.2f}s")

            soup = BeautifulSoup(response.text, 'html.parser')

            risultati = []
            visti = set()

            for a in soup.select('a.live'):
                row = a.find_parent('tr')
                if not row:
                    continue

                left_td = row.select_one('td[width="34"]')
                descrizione = ""
                if left_td:
                    img = left_td.find('img', alt=True)
                    if img:
                        descrizione = img['alt'].strip()

                titolo = a.get_text(strip=True)
                url = a.get('href', '')
                if "_" in url:
                    url = url.split("_")[0]

                time_tag = row.find('span', class_='evdesc')
                time_raw = time_tag.get_text(" ", strip=True) if time_tag else ""
                orario = ""
                if "(" in time_raw and ")" in time_raw:
                    parts = time_raw.split("(", 1)
                    before_paren = parts[0].strip()
                    m = re.search(r"\b\d{1,2}:\d{2}\b", before_paren)
                    orario = m.group(0) if m else before_paren

                try:
                    orario_obj = datetime.strptime(orario, "%H:%M")
                    orario_obj = orario_obj + timedelta(hours=1)
                    orario_str = orario_obj.strftime("%H:%M")
                except Exception:
                    orario_str = orario

                if url in visti:
                    continue
                visti.add(url)

                risultati.append({
                    "title": titolo,
                    "competition": descrizione,
                    "time": orario_str,
                    "url": url
                })

            # 🔹 usa metodo comune per ranking
            selezionati = search_events_pipeline(
                risultati,
                search_term
            )

            events = []
            for i, risultato in enumerate(selezionati, start=1):
                url_partita = site_url + risultato["url"]
                response_partita = make_request_with_retry(url_partita)
                response_partita.raise_for_status()
                logging.info(f"LiveTV dettagli partita in {time.time() - start_time:.2f}s")

                soup_partita = BeautifulSoup(response_partita.text, 'html.parser')
                links = soup_partita.find_all('a', href=lambda href: href and 'acestream://' in href)

                event_title = f"{risultato['title']} | {risultato['competition']} | {risultato['time']}"
                acestream_links = []
                for link in links:
                    tr = link.find_parent('tr')
                    language, bitrate = None, None
                    if tr:
                        td = tr.find('td')
                        img = td.find('img') if td else None
                        if img:
                            language = resolve_lang_code(img.get('title'), img.get('src'))
                        bitrate_td = tr.find('td', class_='bitrate')
                        bitrate = bitrate_td.get_text(strip=True) if bitrate_td else None

                    acestream_links.append({
                        "link": link['href'],
                        "language": language,
                        "bitrate": bitrate
                    })

                events.append({
                    **risultato,
                    "event_title": f"{risultato['title']} | {risultato['competition']} | {risultato['time']}",
                    "acestream_links": acestream_links,
                })
                if i == 3:
                    break

            elapsed_time = time.time() - start_time
            logging.info(f"Scraping LiveTV{livetv_number} completato in {elapsed_time:.2f}s")

            return {"search_term": search_term, "events": events}

        except requests.exceptions.RequestException as e:
            logging.error(f"Errore LiveTV: {e}")
            livetv_number += 1
            continue

    return {"source": f"LiveTV{livetv_number - 1}", "error": "Unable to connect to LiveTV"}


def parse_platin_events(html: str):
    soup = BeautifulSoup(html, "html.parser")
    root = soup.select_one("div.myDiv1") or soup

    events = []
    current_competition = None

    for el in root.children:
        # competizione
        if getattr(el, "name", None) == "p":
            current_competition = el.get_text(strip=True)
            continue

        # evento
        if getattr(el, "name", None) == "time":
            dt = el.get("datetime") or el.get_text(strip=True)
            hhmm = ""
            if dt:
                try:
                    hhmm = datetime.fromisoformat(dt.replace("Z", "+00:00")).strftime("%H:%M")
                except Exception:
                    hhmm = el.get_text(strip=True)

            # titolo = testo fino al primo link
            match_title = ""
            links = []
            seen = set()

            nxt = el.next_sibling
            while nxt and getattr(nxt, "name", None) not in ("time", "p"):
                if isinstance(nxt, str) and nxt.strip():
                    if not match_title:
                        match_title = nxt.strip()
                elif getattr(nxt, "name", None) == "a":
                    href = (nxt.get("href") or "").strip()
                    if href.startswith("acestream://") and href not in seen:
                        seen.add(href)
                        lang = None
                        span = nxt.find("span")
                        if span:
                            for cls in span.get("class", []):
                                if cls.startswith("fi-"):
                                    lang = cls.split("-", 1)[-1]
                                    break
                        links.append({
                            "link": href,
                            "language": lang,
                            "channel": nxt.get_text(strip=True)
                        })
                nxt = nxt.next_sibling

            if match_title and links:
                events.append({
                    "competition": current_competition,
                    "time": hhmm,
                    "title": match_title,
                    "links": links
                })

    return events


def platinsport_scraper(search_term):
    logging.info(f"Inizio scraping PlatinSport per: {search_term}")
    start_time = time.time()
    site_url = "https://www.platinsport.com/"

    try:
        # 1) prendi link giornaliero
        response = make_request_with_retry(site_url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        button = soup.find("button", string="ACESTREAM")
        if not button:
            return {"source": "PlatinSport", "error": "ACESTREAM button not found"}

        parent_link = button.find_parent("a", href=True)
        if not parent_link:
            return {"source": "PlatinSport", "error": "Parent link not found"}

        detailed_link = "https://" + parent_link["href"].split("https://")[-1].strip()

        # 2) pagina con tutti gli eventi
        detailed_response = make_request_with_retry(detailed_link)
        detailed_response.raise_for_status()
        parsed_events = parse_platin_events(detailed_response.text)

        if not parsed_events:
            return {"search_term": search_term, "events": []}

        # 3) ranking dei risultati
        selezionati = search_events_pipeline(
            parsed_events,
            search_term
        )

        events = []
        for ev in selezionati:
            events.append({
                **ev,
                "event_title": f"{ev['title']} | {ev['competition']} | {ev['time']}",
                "acestream_links": ev["links"],
            })

        elapsed_time = time.time() - start_time
        logging.info(f"Scraping PlatinSport completato in {elapsed_time:.2f}s")

        return {"search_term": search_term, "events": events}

    except Exception as e:
        logging.error(f"Errore PlatinSport: {e}")
        return {"source": "PlatinSport", "error": str(e)}


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, threaded=True)
