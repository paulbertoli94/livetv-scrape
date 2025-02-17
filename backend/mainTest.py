from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder="frontend/build", static_url_path="/")
CORS(app, resources={r"/*": {"origins": "*"}})


@app.route("/")
def serve():
    return send_from_directory(app.static_folder, "index.html")


@app.route('/acestream', methods=['GET'])
def acestream_scraper():
    result = {
        "acestream_links": [
            {
                "bitrate": "8000kbps",
                "language": "Russo",
                "link": "acestream://42fe2ce3ef6b92653a74d85b6e98c2ba0abee707"
            },
            {
                "bitrate": "8000kbps",
                "language": "inglese",
                "link": "acestream://efc60cfe5e3a349baa02bcc49f6647c21a9c3c5b"
            }
        ],
        "game_title": "NBA All-Star Game",
        "search_term": "nba",
        "source": "LiveTV819"
    }, {"acestream_links": [
        {
            "language": "pt",
            "link": "acestream://af3e4e9fcc5a69848b7f84d3fcf2c4de72bf1b4b"
        },
        {
            "language": "pt",
            "link": "acestream://8f5df73ad6e813e644779f24f8c126897b5aaffa"
        },
        {
            "language": "gb",
            "link": "acestream://efc60cfe5e3a349baa02bcc49f6647c21a9c3c5b"
        },
        {
            "language": "gb",
            "link": "acestream://06fd695a8353f40d6586db7c778a5862554c09d1"
        },
        {
            "language": "gb",
            "link": "acestream://384b797f666413af4769f8f0897474305d3f493d"
        }
    ],
        "game_title": "NBA ALL-STAR GAME",
        "search_term": "nba",
        "source": "PlatinSport"
    }

    return jsonify(result)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, threaded=True)
