# COMA Study Pack website

WBCHSE Class 12 · Semester 3 · Modern Computer Application (COMA)

## How to open
Double-click `index.html`. It works offline with no server; only the Google web fonts need internet, and it falls back to system fonts without them.

## Pages
| Page | What it does |
|---|---|
| Home | Continue reading (last chapter + next unread), exam pattern, format shortcuts, focus areas, syllabus chapter cards (with Bengali titles), progress |
| Notes | Recall mode (key points and traps hidden until tapped), key points, syntax, tables, code examples with output, exam traps, and "practise this chapter by format" |
| Practice | Quick starts, a card per question format, a custom quiz builder (chapters, formats, difficulty, source, count, order, feedback style, timer), per-chapter accuracy, and the optional beyond-syllabus set |
| Quiz player | One question at a time in any format; keys `1`–`4` / `A`–`D` (`T`/`F` for true/false), `←` `→`, `S` to bookmark; results broken down by chapter and format |
| Browse | The whole question bank with search and filters (chapter, format, difficulty, status) |
| Mock Tests | 10 board-pattern papers (mixed formats), 11 practice papers including a hard challenge paper, and a random paper; mark for review, auto-save and resume, score per unit and format, attempt history |
| Short Answers | Reveal answers, rate yourself ("I knew it" / "Revise again"), filter and search |
| Flashcards | One short answer at a time, "revise again" cards first; `Space` shows the answer, `1` / `2` rates it |
| Programs | 17 Python programs; practice mode hides the code until you reveal it |
| Revision | Tabs: quick revision, exam tips + last-night plan, glossary (search and flashcards), Python keywords, all exam traps, Semester IV preview |
| Progress | Stats, study streak, 14-day activity, accuracy by format and chapter, mock and quiz history, backup/restore to a file (answers, review schedule and settings), reset |

### Question formats
All formats share one practice engine, so quizzes, the builder, bookmarks, "retry wrong", progress and search work for every one of them.

| Format | Source in `question_bank` | How it is answered |
|---|---|---|
| MCQ, Code output, Case-based | `mcq` (split by `is_code_output` / `type`) | Pick A–D; code in the question is shown as a code block |
| Assertion–Reason | `assertion_reason` | Pick A–D |
| Column match (OMR) | `match_mcq_board_style` | Read both columns, pick the matching code A–D |
| True / False | `true_false` | Pick সত্য / মিথ্যা |
| Fill in the blanks | `fill_in_the_blanks` | Type the word; spacing, case and quotes are ignored, and "a / b" answers accept either. A "count it correct" button covers other valid wordings |
| Match the following | `match_the_following` | Choose a match for each row; scored pair by pair |
| Beyond syllabus | `extended_optional` | Pick A–D; kept separate and optional |

Other features: search (press `/`), light/dark theme, mobile layout and a back-to-top button. All progress is stored in the browser (localStorage).

## Files
```
index.html        page shell and navigation
css/style.css     all styling (light and dark themes)
js/app.js         the app: routing, rendering, practice, mock tests, search
data/coma.json    the study pack data (source of truth)
data/data.js      the same data as `window.COMA_DATA = {...};` so the site works from file://
```

## Updating the content
Edit `data/coma.json`, then regenerate `data/data.js` with this PowerShell command, run inside this folder:

```powershell
$j = Get-Content data\coma.json -Raw -Encoding UTF8; Set-Content data\data.js ("window.COMA_DATA = " + $j + ";") -Encoding UTF8
```

If you host the site on a web server, you can delete `data/data.js`; the app will then load `data/coma.json` directly.
