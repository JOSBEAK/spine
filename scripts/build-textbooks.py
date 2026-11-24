"""Fetch the list of current OpenStax textbooks into src/data/textbooks.json.

Run from the repo root:  python3 scripts/build-textbooks.py
OpenStax's API doesn't allow browser requests from other sites, so the list is baked in at build time.
"""
import html, json, re, subprocess, sys, urllib.parse

API = "https://openstax.org/apps/cms/api/v2/pages/?" + urllib.parse.urlencode({
    "type": "books.Book",
    "fields": "title,slug,cover_url,book_state,book_subjects,high_resolution_pdf_url,webview_rex_link,description,authors",
    "limit": 250,
})


def get(url, as_json=True):
    out = subprocess.run(["curl", "-s", "-L", "-m", "60", url], capture_output=True, text=True).stdout
    return json.loads(out) if as_json else out


def text(desc):
    t = html.unescape(re.sub(r"<[^>]+>", " ", desc or ""))
    t = re.sub(r"\s+", " ", t).strip()
    sentences = re.split(r"(?<=[.!?])\s+", t)
    out = ""
    for s in sentences:
        if len(out) + len(s) > 320:
            break
        out = (out + " " + s).strip()
    return out or t[:300]


def tone(svg_url):
    svg = get(svg_url, as_json=False)
    m = re.search(r"fill\s*[:=]\s*[\"']?(#[0-9a-fA-F]{6})", svg)
    return m.group(1).lower() if m else "#3c6e9e"


items = get(API).get("items", [])
books = []
for b in items:
    if b.get("book_state") != "live" or not b.get("webview_rex_link"):
        continue
    authors = [a["value"]["name"] for a in b.get("authors", []) if a.get("value", {}).get("senior_author")] or \
              [a["value"]["name"] for a in b.get("authors", []) if a.get("value")]
    subjects = [s["subject_name"] for s in b.get("book_subjects", [])]
    slug = b["meta"]["slug"]
    books.append({
        "id": "OX-" + slug,
        "kind": "textbook",
        "title": b["title"],
        "author": (authors[0] + (" and others" if len(authors) > 1 else "")) if authors else "OpenStax",
        "subject": subjects[0] if subjects else "Textbook",
        "subjects": subjects,
        "coverArt": b.get("cover_url"),
        "tone": tone(b["cover_url"]) if b.get("cover_url") else "#3c6e9e",
        "blurb": text(b.get("description")),
        "pdf": b.get("high_resolution_pdf_url"),
        "web": b["webview_rex_link"],
        "year": "",
    })
    print(f'{b["title"][:40]:41} {books[-1]["subject"]:22} {books[-1]["tone"]}', flush=True)

books.sort(key=lambda x: (x["subject"], x["title"]))
json.dump(books, open("src/data/textbooks.json", "w"), ensure_ascii=False, indent=0)
print(len(books), "textbooks", file=sys.stderr)
