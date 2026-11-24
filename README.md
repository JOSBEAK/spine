# Spine

**Free books to read, see as first printed, or listen to.**

Spine is a web app for public-domain books, built the way Stremio works for video. It doesn't host anything. It searches free libraries and lists every way to read each book:

| Way to read | Comes from |
| --- | --- |
| Read in Spine: clean typeset text with 3D page turns | [Project Gutenberg](https://www.gutenberg.org), via its mirror on the Internet Archive |
| Original printed pages: page-by-page scans | [Internet Archive](https://archive.org) |
| Listen: full audiobooks | [LibriVox](https://librivox.org) |
| Catalogue, covers, descriptions | [Open Library](https://openlibrary.org) |

About 1.8 million books are free on Open Library. Around 8,000 English titles (10,000 in all languages) have clean Gutenberg text that opens in the Spine reader. The rest open as scans.

## What it does

- **Home:** "Book of the day" or the book you're reading, curated shelves, and live shelves by subject (detective stories, ghosts and horror, science fiction, poetry…).
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
- `src/data/seed.json`: 71 hand-picked classics with their sources resolved ahead of time, so Home loads instantly

## Notes

- Books are public domain in the United States. Copyright rules differ by country.
- Open Library search can take a few seconds when it's busy. Spine shows placeholders while it waits.
