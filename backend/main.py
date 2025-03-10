from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
import unicodedata
import re
import logging
import time
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor

app = Flask(__name__, static_folder="frontend/build", static_url_path="/")
CORS(app, resources={r"/*": {"origins": "*"}})
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Creiamo una sessione globale per riutilizzare le connessioni
session = requests.Session()

def make_request_with_retry(url, retries=3, delay=0.3, timeout=1.2):
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
    logging.error(f"Impossibile ottenere una risposta da {url} dopo {retries} tentativi")
    return None  # Se tutte le richieste falliscono

@app.route("/")
def serve():
    return send_from_directory(app.static_folder, "index.html")


@app.route('/acestream', methods=['GET'])
def acestream_scraper():
    logging.info(f"Ricevuta richiesta con termine di ricerca: {request.args.get('term')}")

    result = []
    search_term = request.args.get('term')
    if not search_term:
        logging.error("Parametro 'term' mancante")
        return jsonify({"error": "Parameter 'term' is required"}), 400

    start_time = time.time()

    with ThreadPoolExecutor() as executor:
        future_livetv = executor.submit(livetv_scraper, search_term)
        future_platinsport = executor.submit(platinsport_scraper, search_term)

        result = [
            future_livetv.result(),
            future_platinsport.result()
        ]

    elapsed_time = time.time() - start_time
    logging.info(f"Tempo totale per l'elaborazione della richiesta: {elapsed_time:.2f} secondi")

    return jsonify(result)

def normalize_string(s):
    return unicodedata.normalize('NFKD', s).encode('ASCII', 'ignore').decode('utf-8')

def livetv_scraper(search_term):
    logging.info(f"Inizio scraping LiveTV per: {search_term}")
    start_time = time.time()

    base_url = 'https://livetv'
    domain_suffix = '.me'
    max_attempts = 2
    base_attempt = 822
    attempt = base_attempt

    while attempt <= base_attempt + max_attempts:
        site_url = f'{base_url}{attempt}{domain_suffix}'
        path_upcoming = site_url + '/it/allupcoming/'

        try:
            response = make_request_with_retry(path_upcoming)
            response.raise_for_status()
            logging.info(f"LiveTV risposta ricevuta in {time.time() - start_time:.2f}s")

            soup = BeautifulSoup(response.text, 'html.parser')

            partite = soup.find_all('a', href=True)
            link_partite = [a['href'] for a in partite if search_term.lower() in a.text.lower()]

            acestream_links = []
            game_title = None

            if link_partite:
                url_partita = site_url + link_partite[0]
                response_partita = make_request_with_retry(url_partita)
                response_partita.raise_for_status()
                logging.info(f"LiveTV dettagli partita ricevuti in {time.time() - start_time:.2f}s")

                soup_partita = BeautifulSoup(response_partita.text, 'html.parser')

                links = soup_partita.find_all('a', href=lambda href: href and 'acestream://' in href)

                for link in links:
                    tr = link.find_parent('tr')

                    if tr:
                        language_img = tr.find('td').find('img') if tr.find('td') else None
                        language = language_img['title'] if language_img and 'title' in language_img.attrs else None

                        bitrate_td = tr.find('td', class_='bitrate')
                        bitrate = bitrate_td.get_text(strip=True) if bitrate_td else None

                        acestream_links.append({
                            "link": link['href'],
                            "language": language,
                            "bitrate": bitrate
                        })

                game_title_tag = soup_partita.find('h1', class_='sporttitle', itemprop='name')
                if game_title_tag:
                    game_title = game_title_tag.find('b').text.strip()

            match = re.search(r"livetv(\d+)\.me", response.url)
            elapsed_time = time.time() - start_time
            logging.info(f"Scraping LiveTV completato in {elapsed_time:.2f}s")

            return {
                "source": f"LiveTV{match.group(1)}",
                "search_term": search_term,
                "game_title": game_title,
                "acestream_links": acestream_links
            }
        except requests.exceptions.RequestException as e:
            logging.error(f"Errore LiveTV: {e}")
            attempt += 1
            continue

    return {
        "source": f"LiveTV{attempt - 1}",
        "error": "Unable to connect to LiveTV"
    }

def platinsport_scraper(search_term):
    logging.info(f"Inizio scraping PlatinSport per: {search_term}")
    start_time = time.time()

    site_url = 'https://www.platinsport.com/'
    try:
        response = make_request_with_retry(site_url)
        response.raise_for_status()
        logging.info(f"PlatinSport risposta ricevuta in {time.time() - start_time:.2f}s")

        soup = BeautifulSoup(response.text, 'html.parser')

        button_element = soup.find('button', string="ACESTREAM")

        link_element = None
        if button_element:
            parent_link = button_element.find_parent('a', href=True)
            if parent_link:
                link_element = parent_link['href']

        if link_element:
            detailed_link = link_element.split("https://")[-1]
            detailed_link = "https://" + detailed_link.strip()

            detailed_response = make_request_with_retry(detailed_link)
            detailed_response.raise_for_status()
            logging.info(f"PlatinSport dettagli partita ricevuti in {time.time() - start_time:.2f}s")

            detailed_soup = BeautifulSoup(detailed_response.text, 'html.parser')

            div_content = detailed_soup.find('div', class_='myDiv1')
            if not div_content:
                return {"source": "PlatinSport", "error": "myDiv1 Content not found"}

            acestream_links = []
            game_title = None
            found_title = False

            for element in div_content.contents:
                if isinstance(element, str) and normalize_string(search_term.lower()) in normalize_string(element.lower()):
                    if found_title:
                        break
                    game_title = normalize_string(element.strip())
                    found_title = True
                elif found_title and element.name == 'a':
                    href = element.get('href', '')
                    if 'acestream://' in href:
                        language_span = element.find('span', class_=lambda c: c and c.startswith('fi fi-'))
                        language_code = None
                        if language_span:
                            language_code = language_span['class'][1].split('-')[-1]
                        acestream_links.append({
                            "link": href.strip(),
                            "language": language_code
                        })
                elif found_title and isinstance(element, str) and element.strip() == '':
                    continue
                elif found_title and isinstance(element, str) and element.strip() != '':
                    break

        elapsed_time = time.time() - start_time
        logging.info(f"Scraping PlatinSport completato in {elapsed_time:.2f}s")

        return {
            "source": "PlatinSport",
            "search_term": search_term,
            "game_title": game_title,
            "acestream_links": acestream_links
        }
    except Exception as e:
        logging.error(f"Errore PlatinSport: {e}")
        return {"source": "PlatinSport", "error": str(e)}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, threaded=True)
