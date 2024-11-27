from flask import Flask, request, jsonify
import requests
from bs4 import BeautifulSoup

app = Flask(__name__)

@app.route('/acestream', methods=['GET'])
def acestream_scraper():
    # Ottieni il parametro di ricerca (ad esempio "girona") dall'URL
    search_term = request.args.get('term')
    if not search_term:
        return jsonify({"error": "Parameter 'term' is required"}), 400

    # URL della pagina principale
    url_principale = 'https://livetv817.me/it/allupcoming/'

    try:
        # Effettua la richiesta alla pagina principale
        response = requests.get(url_principale)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        # Filtra i link per la ricerca
        partite = soup.find_all('a', href=True)
        link_partite = [a['href'] for a in partite if search_term.lower() in a.text.lower()]
        base_url = 'https://livetv817.me'

        # Trova i link AceStream
        acestream_links = []
        game_title = None

        if link_partite:
            url_partita = base_url + link_partite[0]
            response_partita = requests.get(url_partita)
            response_partita.raise_for_status()
            soup_partita = BeautifulSoup(response_partita.text, 'html.parser')
            links = soup_partita.find_all('a', href=lambda href: href and 'acestream://' in href)
            acestream_links.extend([l['href'] for l in links])

            # Estrai il titolo della partita
            game_title_tag = soup_partita.find('h1', class_='sporttitle', itemprop='name')
            if game_title_tag:
                # Estrai il testo dentro <b> (il titolo delle squadre)
                game_title = game_title_tag.find('b').text.strip()

        return jsonify({
            "search_term": search_term,
            "game_title": game_title,
            "acestream_links": acestream_links
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
