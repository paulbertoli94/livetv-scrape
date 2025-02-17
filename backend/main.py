from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
import unicodedata
import re
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor

app = Flask(__name__, static_folder="frontend/build", static_url_path="/")
CORS(app, resources={r"/*": {"origins": "*"}})

@app.route("/")
def serve():
    return send_from_directory(app.static_folder, "index.html")

@app.route('/acestream', methods=['GET'])
def acestream_scraper():
    result = []
    # Ottieni il parametro di ricerca dall'URL
    search_term = request.args.get('term')
    if not search_term:
        return jsonify({"error": "Parameter 'term' is required"}), 400

    # Esegui i metodi in parallelo
    with ThreadPoolExecutor() as executor:
        future_livetv = executor.submit(livetv_scraper, search_term)
        future_platinsport = executor.submit(platinsport_scraper, search_term)

        # Ottieni i risultati
        result = [
            future_livetv.result(),
            future_platinsport.result()
        ]

    return jsonify(result)

def normalize_string(s):
    return unicodedata.normalize('NFKD', s).encode('ASCII', 'ignore').decode('utf-8')

def livetv_scraper(search_term):
    base_url = 'https://livetv'
    domain_suffix = '.me'
    max_attempts = 2  # Numero massimo di tentativi con domini successivi
    base_attempt = 819
    attempt = base_attempt

    while attempt <= base_attempt + max_attempts:
        site_url = f'{base_url}{attempt}{domain_suffix}'
        path_upcoming = site_url + '/it/allupcoming/'

        try:
            response = requests.get(path_upcoming, timeout=5)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')

            partite = soup.find_all('a', href=True)
            link_partite = [a['href'] for a in partite if search_term.lower() in a.text.lower()]

            acestream_links = []
            game_title = None

            if link_partite:
                url_partita = site_url + link_partite[0]
                response_partita = requests.get(url_partita)
                response_partita.raise_for_status()
                soup_partita = BeautifulSoup(response_partita.text, 'html.parser')

                links = soup_partita.find_all('a', href=lambda href: href and 'acestream://' in href)

                for link in links:
                    # Trova il tr padre del padre del link
                    tr = link.find_parent('tr')

                    if tr:
                        # Recupera il primo td con l'immagine per la lingua
                        language_img = tr.find('td').find('img') if tr.find('td') else None
                        language = language_img['title'] if language_img and 'title' in language_img.attrs else None

                        # Recupera il bitrate dal td con class="bitrate"
                        bitrate_td = tr.find('td', class_='bitrate')
                        bitrate = bitrate_td.get_text(strip=True) if bitrate_td else None

                        # Aggiungi il link con la lingua e il bitrate
                        acestream_links.append({
                            "link": link['href'],
                            "language": language,
                            "bitrate": bitrate
                        })

                game_title_tag = soup_partita.find('h1', class_='sporttitle', itemprop='name')
                if game_title_tag:
                    game_title = game_title_tag.find('b').text.strip()

            match = re.search(r"livetv(\d+)\.me", response.url)
            return {
                "source": f"LiveTV{match.group(1)}",
                "search_term": search_term,
                "game_title": game_title,
                "acestream_links": acestream_links
            }
        except requests.exceptions.RequestException as e:
            # Prova con il prossimo dominio
            attempt += 1
            continue

    # Se tutti i domini falliscono
    return {
        "source": f"LiveTV{attempt - 1}",
        "error": f"Unable to connect to LiveTV on all attempts from {base_url}{base_attempt}{domain_suffix} to {base_url}{base_attempt + max_attempts}{domain_suffix}"
    }

def platinsport_scraper(search_term):
    site_url = 'https://www.platinsport.com/'

    try:
        response = requests.get(site_url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        button_element = soup.find('button', string="ACESTREAM")

        link_element = None
        if button_element:
            # Trova il tag 'a' genitore del bottone e ottieni l'href
            parent_link = button_element.find_parent('a', href=True)
            if parent_link:
                link_element = parent_link['href']

        if link_element:
            detailed_link = link_element.split("https://")[-1]
            detailed_link = "https://" + detailed_link.strip()

            detailed_response = requests.get(detailed_link)
            detailed_response.raise_for_status()
            detailed_soup = BeautifulSoup(detailed_response.text, 'html.parser')

            div_content = detailed_soup.find('div', class_='myDiv1')
            if not div_content:
                return {"source": "PlatinSport", "error": "myDiv1 Content not found"}

            acestream_links = []
            game_title = None
            found_title = False

            # Itera sui nodi del contenuto HTML
            for element in div_content.contents:
                # Se è un titolo (stringa), controlla se contiene il search_term
                if isinstance(element, str) and normalize_string(search_term.lower()) in normalize_string(element.lower()):
                    if found_title:  # Se un altro titolo è stato trovato, fermati
                        break
                    game_title = normalize_string(element.strip())
                    found_title = True  # Abbiamo trovato il titolo
                elif found_title and element.name == 'a':  # Cerca i link AceStream successivi al titolo
                    href = element.get('href', '')
                    if 'acestream://' in href:
                        # Estrai il codice lingua
                        language_span = element.find('span', class_=lambda c: c and c.startswith('fi fi-'))
                        language_code = None
                        if language_span:
                            language_code = language_span['class'][1].split('-')[-1]
                        acestream_links.append({
                            "link": href.strip(),
                            "language": language_code
                        })
                elif found_title and isinstance(element, str) and element.strip() == '':
                    # Ignora le righe vuote ma continua a cercare i link
                    continue
                elif found_title and isinstance(element, str) and element.strip() != '':
                    # Se trovi un testo che non è vuoto, interrompi (altro titolo trovato)
                    break

        return {
            "source": "PlatinSport",
            "search_term": search_term,
            "game_title": game_title,
            "acestream_links": acestream_links
        }
    except Exception as e:
        return {"source": "PlatinSport", "error": str(e)}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, threaded=True)
