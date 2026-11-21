# csv-reader-speed-20261121-xxcode2

[![Competition](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![Rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Irgirival/makefun-csv-reader-speed-20261121-xxcode2/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![Reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Irgirival/makefun-csv-reader-speed-20261121-xxcode2/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A fast drop-in replacement for [csv-reader](https://www.npmjs.com/package/csv-reader) 1.0.0, written for the [make.fun competition "Read broken CSV files faster, 21 November 2026"](https://make.fun/bounty/csv-reader-speed-01-run-20261121). It answers **exactly** as csv-reader 1.0.0 does on every input — including broken CSV: unterminated quotes, junk after a closing quote, stray carriage returns, embedded newlines inside quoted fields, blank lines, a leading BOM, short and long rows — but several times faster.

## How it works

`main.ts` is the house driver, kept as shipped: it reads `/input/cases.json`, answers each case alone with `run()` from `solve.js`, and writes `/output/answers.json`. Only `solve.js` is replaced.

`solve.js` is a hand-written, single-pass CSV parser (no dependencies, pure Node.js standard library):

- **Record-level fast path.** A record whose whole line holds no quote and no stray carriage return is answered with one `slice` + `split(',')` — no per-field work at all. That covers about a quarter of the records in the practice set.
- **Bounded native scans.** Unquoted fields are found with two bounded `indexOf` calls (comma and newline) plus a `slice`; quoted fields are found with a bounded close-quote scan, and their `""` → `"` and CR/LF → LF transforms run only when the raw content actually holds those characters. There is no per-character loop anywhere, so the work stays in V8's native string routines.
- **Exact error semantics.** The `{code, line, row}` errors (`short_row`, `long_row`, `stray_cr`, `quote_junk`, `unterminated_quote`) are reproduced exactly, in the order the reference meets them, including the tricky cases: an unterminated quote is re-read as unquoted text from just after the opening quote, a line holding only stray CRs yields no record, and a trailing CRLF before a line feed is not a stray CR.

## Verification

- All 6 practice cases answer byte-for-byte identically to the reference (and to the kit's `practice/reference/expected.json`).
- 18,000 fuzzed cases (random strings over a CSV-ish alphabet plus structured random records with every breakage kind, both header settings) and 144 hand-picked edge cases — **0 mismatches** against csv-reader 1.0.0.
- Benchmark (this machine, Node 24, median CPU over 5 runs of all 6 practice cases, ~10.2 MB of CSV): reference **~864 ms**, this entry **~236 ms** — about **3.7× faster**. The house's own numbers put the reference at 1.38 s and the best public CSV parsers at ~0.72 s on the same sets, so this entry is roughly twice as fast as those too.

## Files

- `solve.js` — the parser (the entry; exports `run(input)`).
- `main.ts` — the house driver (unchanged).
- `package.json` — `{"type": "module"}` so `solve.js` loads as an ES module.

## License

MIT — see [LICENSE](LICENSE).
