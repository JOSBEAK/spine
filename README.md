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

- **Home:** "Book of the day" or the book you're reading, curated shelves, free textbooks, and live shelves for non-fiction (self-help, money and business, programming, engineering, science, maths, biography, cooking) and fiction.
- **Discover:** filter by how you want to read (everything, read now, clean text, borrow), by shelf, by period and by language, with infinite scroll.
- **3D books:** every book has a cover, spine, page edges and back. On hover it lifts, leans toward your cursor and the cover opens a little. Click it and it flies into its own page. On the book page you can drag it around to read the back.
- **Opening a book:** the book moves to the centre, the cover swings open, pages riffle, and the reader takes over.
- **Reader:** two-page spreads on wide screens and one page on phones, with 3D page turns, a contents list, three text sizes and typefaces, and White, Paper and Night pages. Progress is saved per chapter.
- **Audiobooks:** a player that stays at the bottom while you browse, with chapter list, speed control and lock-screen controls.
- **Library:** a real bookshelf of spines coloured from each cover, split into Reading now, Finished and Want to read.
- **Sources:** turn any library off and Spine stops offering it.

Nothing needs an account. Your shelf, progress and settings stay in your browser's local storage.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173/spine/.

```bash
npm run build   # static site in dist/
```

Pushing to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`.

## How it's built

Plain JavaScript modules and CSS, bundled with Vite. There's no framework and no backend.

- `src/lib/openlibrary.js`: search and book records from Open Library
- `src/lib/archive.js`: finds the Gutenberg text, LibriVox recording, scan and EPUB for a book on the Internet Archive
- `src/lib/gutenberg.js`: turns a Gutenberg `.txt` file into chapters (strips licence text, finds chapter headings, handles verse, curly quotes)
- `src/ui/`: the 3D book, motion, reader, player and scan viewer
- `src/views/`: Home, Discover, Library, Sources and the book page
- `src/lib/shelves.js`: the Open Library subject queries behind every shelf
- `src/data/seed.json`: 71 hand-picked classics with their sources resolved ahead of time, so Home loads instantly
- `src/data/textbooks.json`: the OpenStax catalogue, refreshed with `python3 scripts/build-textbooks.py`

## Notes

- Public-domain books are public domain in the United States; copyright rules differ by country. Borrowed books stay under copyright and are lent by the Internet Archive, not by Spine.
- Open Library search can take a few seconds when it's busy. Spine shows placeholders while it waits.
