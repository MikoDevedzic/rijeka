#!/usr/bin/env bash
# e2e/film/workbook.sh <workbook.xlsx> <out dir> — the sheets of an Excel replication as pictures, for the film: the
# workbook is opened in Numbers (the spreadsheet a Mac has), which computes its formulas, and exported as a PDF, one
# sheet a page; each page becomes page-N.png. Prints the sheets' names and the Cover's verdict cell as Numbers computed
# it, so a caption can say what the sheet says and nothing more. macOS only; the film leaves the scene out without it.
set -euo pipefail
BOOK="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; OUT="$2"; mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"; TOOL="$OUT/pdf2png"
rm -f "$OUT"/page-*.png "$OUT/book.pdf"
osascript <<OSA
tell application "Numbers"
  set d to open POSIX file "$BOOK"
  delay 1.5
  set v to "?"
  try
    set v to (value of cell "B13" of table 1 of sheet "Cover" of d) as text
  end try
  set names to name of every sheet of d
  export d to POSIX file "$OUT/book.pdf" as PDF
  close d saving no
  set AppleScript's text item delimiters to "|"
  return "SHEETS " & (names as text) & linefeed & "VERDICT " & v
end tell
OSA
[ -x "$TOOL" ] || swiftc -O "$HERE/pdf2png.swift" -o "$TOOL"
"$TOOL" "$OUT/book.pdf" "$OUT/page" 2 > /dev/null
ls "$OUT" | grep -c '^page-.*png$' | sed 's/^/PAGES /'
