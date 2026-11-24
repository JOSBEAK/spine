# Spine

**Free books to read, see as first printed, or listen to.**

Spine is a web app for public-domain books, built the way Stremio works for video. It doesn't host anything. It searches free libraries and lists every way to read each book:

| Way to read | Comes from |
| --- | --- |
| Read in Spine: clean typeset text with 3D page turns | [Project Gutenberg](https://www.gutenberg.org), via its mirror on the Internet Archive |
| Original printed pages: page-by-page scans | [Internet Archive](https://archive.org) |
| Borrow free: modern books, one reader per copy | [Open Library](https://openlibrary.org/borrow)'s lending library |
| Free university textbooks | [OpenStax](https://openstax.org) |
| Listen: full audiobooks | [LibriVox](https://librivox.org) |
| Catalogue, covers, descriptions | [Open Library](https://openlibrary.org) |

That adds up to about 4.8 million books:
- **About 1.8 million public-domain books** you can open straight away. Around 8,000 English titles have clean Gutenberg text for the Spine reader; the rest open as scans.
- **About 2.9 million modern books** you can borrow with a free Internet Archive account. This covers self-help, business, programming, engineering, science, cooking and biography, plus modern fiction.
- **84 OpenStax textbooks** covering maths, science, computer science, business, nursing and more.

## What it does

- **Read here or in your browser, for every book.** Each way to read on a book page opens inside Spine, with a separate ↗ button to open the original site in a new tab. You only leave Spine if you choose to.
- **One reader for clean text and scanned pages.**
  - Gutenberg text and Internet Archive page images (through its IIIF image service) open in the same reader.
  - Page turns are 3D, in **Book view** (two pages on the book's cloth boards) or **Page view**.
  - Page size is adjustable, and there's a **full screen** mode (F).
- **Dictionary, highlights, notes and bookmarks.**
  - Tap any word to see its meaning (Free Dictionary, with Wiktionary as a fallback).
  - Select text to highlight it in four colours or add a note.
  - Press B (or the ribbon) to bookmark a page.
  - Contents, bookmarks and highlights share one panel.
- **Borrowing inside Spine.**
  - Modern books from the Internet Archive's lending library open in a Spine panel, on an English edition.
  - Readers sign in to the Archive on the Archive's own page, inside that panel; Spine never sees the password.
  - Safari blocks sign-in inside other sites, so Spine tells Safari users to use "Open in browser".
- **Textbooks inside Spine.** OpenStax books open in a panel, with the PDF one click away.
- **An endless Home, like Stremio.**
  - Personal shelves come first: "Because you read…", "More by…".
  - Curated and subject shelves follow, then new shelves keep arriving as you scroll: about 60 subjects, every decade since 1800, then random picks.
  - Every shelf keeps loading as you scroll it sideways.
- **Taste, history and activity.**
  - Every sitting with a book is recorded once, not per page.
  - Opens, shelving, borrowing, listening, highlights and finishes feed a taste profile. Scores fade with a 60-day half-life, so recent reading counts more.
  - Each book page shows your time read, sittings, last read, highlights and bookmarks.
- **Accounts (optional).** Spine works fully without one: everything is stored in the browser first. Signing in syncs your shelf, progress, highlights, bookmarks, history and taste across devices, and lets you:
  - import your public Open Library reading log
  - import a Goodreads or StoryGraph CSV export
  - mark your Internet Archive account as connected
  - download all your data, or delete your account
- **Discover:** filter by how you want to read, by shelf, period and language, with infinite scroll.
- **Library:** a real bookshelf of spines coloured from each cover.
- **Audiobooks:** a player that stays at the bottom while you browse.

## Run it

```bash
npm install
npm run dev              # the web app, at http://localhost:5173/spine/
```

The web app works on its own. To switch accounts on, run the server (see `server/README.md`):

```bash
cd server && npm install && npm run dev      # API at http://localhost:8787, embedded Postgres
```

Then build the web app with `VITE_API_URL=http://localhost:8787` (or set it in `.env.local`). To try a server from an already-built copy, run `localStorage.setItem('spine.api', 'http://localhost:8787')` in the browser console.

```bash
npm run build   # static site in dist/
```

Pushing to `main` deploys the web app to GitHub Pages through `.github/workflows/deploy.yml`. Set the repository variable `VITE_API_URL` to your deployed server's URL to switch accounts on there.

## How it's built

Plain JavaScript modules and CSS, bundled with Vite. There's no framework and no backend.

- `src/lib/openlibrary.js`: search and book records from Open Library
- `src/lib/archive.js`: finds the Gutenberg text, LibriVox recording, scan and EPUB for a book on the Internet Archive
- `src/lib/gutenberg.js`: turns a Gutenberg `.txt` file into chapters (strips licence text, finds chapter headings, handles verse, curly quotes)
- `src/lib/store.js`: local-first storage: shelf, progress, highlights, bookmarks, sittings, events, taste, and the queue of changes to sync
- `src/lib/sync.js`, `src/lib/api.js`: batched sync with the server (last writer wins per row)
- `src/lib/recs.js`: personal shelves from your taste
- `src/lib/dictionary.js`: word meanings
- `src/ui/reader.js`: the reader (text and scans, highlights, dictionary, bookmarks, views)
- `src/ui/panel.js`: borrowed books, textbooks and the Archive sign-in, inside Spine
- `src/ui/`: the 3D book, motion, player, rows, search
- `server/`: the API (Hono + Postgres); see `server/API.md` for the data model and endpoints
- `src/views/`: Home, Discover, Library, Sources and the book page
- `src/lib/shelves.js`: the Open Library subject queries behind every shelf
- `src/data/seed.json`: 71 hand-picked classics with their sources resolved ahead of time, so Home loads instantly
- `src/data/textbooks.json`: the OpenStax catalogue, refreshed with `python3 scripts/build-textbooks.py`

## Notes

- Public-domain books are public domain in the United States; copyright rules differ by country. Borrowed books stay under copyright and are lent by the Internet Archive, not by Spine.
- Open Library search can take a few seconds when it's busy. Spine shows placeholders while it waits.
