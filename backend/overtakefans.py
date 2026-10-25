"""AceStream channels published by OvertakeFans for Formula 1."""

import re

import requests
from bs4 import BeautifulSoup


SOURCE_URL = (
    "https://overtakefans.com/f1-live-stream/"
    "sky-sport-f1-live-stream-via-ace-player/"
)


def is_f1_search(term: str) -> bool:
    return bool(re.search(r"\b(?:f\s*1|formula\s*(?:1|one|uno))\b", term, re.I))


def parse_overtakefans_links(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    links = []
    seen = set()
    for anchor in soup.select('a[href^="acestream://"]'):
        href = anchor["href"].strip()
        if not re.fullmatch(r"acestream://[a-fA-F0-9]{40}", href):
            continue
        href = href.lower()
        if href in seen:
            continue
        seen.add(href)
        links.append({
            "link": href,
            "language": None,
            "bitrate": None,
            "quality": None,
        })
    return links


def overtakefans_scraper(search_term: str) -> dict:
    result = {"source": "OvertakeFans", "search_term": search_term, "events": []}
    try:
        response = requests.get(SOURCE_URL, timeout=5)
        response.raise_for_status()
        links = parse_overtakefans_links(response.text)
        if links:
            result["events"].append({
                "title": "Formula 1 - OvertakeFans",
                "competition": "Formula 1",
                "time": "",
                "url": SOURCE_URL,
                "event_title": "Formula 1 | OvertakeFans",
                "acestream_links": links,
            })
    except requests.exceptions.RequestException as exc:
        result["error"] = str(exc)
    return result
