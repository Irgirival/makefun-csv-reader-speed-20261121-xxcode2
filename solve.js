// Fast drop-in for make.fun's csv-reader 1.0.0 (csv-reader-speed-01-run-20261121).
//
// Returns exactly csv-reader 1.0.0's answer {columns, rows, errors} for every
// {text, header}, following its written broken-row policy to the letter:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it one quote, each CRLF or lone CR inside it read as LF; what
//     follows its closing quote, up to the next comma or line break, is appended
//     as it stands (quote_junk, when the field ends); a quote that never closes
//     is a literal character, and the text after it is read again as unquoted
//     (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it, each padded (short_row, with fields: its field count) or
//     cut (long_row, with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met; line the 1-based line
//     its record starts on, counting every LF, CRLF and lone CR inside quotes,
//     row its record's index in rows, null for the header.
//
// Speed comes from bulk native scans instead of a per-character loop:
//   - a whole record whose line holds no quote and no stray CR is answered by
//     one slice + String.split(',');
//   - an unquoted field is answered by two bounded indexOf calls + one slice
//     (a CR inside it is found on the small slice, never by an unbounded scan);
//   - a quoted field is answered by indexOf scans for its closing quote + one
//     slice, with "" and CR/LF transforms only when the content holds them.
// No per-character loop runs on the hot path, and no string is built a
// character at a time.

const RE_QR = /["\r]/g; // first quote or CR at/after a position (record fast-path check)

// Field end codes.
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let recordLine = 1;
  let recordRow = null;

  // State shared with unq(): the last unquoted scan's end and kept-char count.
  let uEnd = END;
  let uAdded = 0;

  // Reads an unquoted field from pos, starting from `init` ('' normally, '"' when
  // re-reading an unterminated quote, the quoted content for quote junk).
  // Updates pos/line, records stray_cr errors, sets uEnd/uAdded, returns the value.
  function unq(init) {
    let ci = text.indexOf(',', pos);
    let li = text.indexOf('\n', pos);
    let end;
    if (ci === -1) end = li === -1 ? len : li;
    else if (li === -1) end = ci;
    else end = ci < li ? ci : li;
    let val = init + text.slice(pos, end);
    const ri = val.indexOf('\r', init.length);
    if (ri !== -1) {
      // CRs inside the field: every one is stray and dropped, except a trailing
      // one whose next character (at `end`) is LF, which is the CRLF line ending.
      let out = '';
      let last = init.length;
      let idx = ri;
      while (idx !== -1) {
        const isCRLF = idx === val.length - 1 && end < len && text.charCodeAt(end) === 10;
        if (!isCRLF) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        out += val.slice(last, idx);
        last = idx + 1;
        idx = val.indexOf('\r', idx + 1);
      }
      out += val.slice(last);
      val = init + out;
    }
    uAdded = val.length - init.length;
    if (end >= len) {
      uEnd = END;
      pos = len;
    } else if (text.charCodeAt(end) === 44) {
      uEnd = COMMA;
      pos = end + 1;
    } else {
      uEnd = LINE_BREAK;
      pos = end + 1;
      line += 1;
    }
    return val;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else break;
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the whole record is one clean line (no quote, no stray CR).
    const lf = text.indexOf('\n', pos);
    const lfP = lf === -1 ? len : lf;
    const crlf = lf !== -1 && lfP > pos && text.charCodeAt(lfP - 1) === 13;
    const lineEnd = crlf ? lfP - 1 : lfP;
    RE_QR.lastIndex = pos;
    const m = RE_QR.exec(text);
    if (lineEnd > pos && (!m || m.index >= lineEnd)) {
      const fields = text.slice(pos, lineEnd).split(',');
      if (width < 0) width = fields.length;
      if (header && columns === null) {
        columns = fields;
      } else {
        if (fields.length < width) {
          errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
          while (fields.length < width) fields.push('');
        } else if (fields.length > width) {
          errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
        }
        rows.push(fields);
      }
      pos = lf === -1 ? len : lf + 1;
      if (lf !== -1) line += 1;
      continue;
    }

    // Slow path: field by field.
    const fields = [];
    let fValue;
    let fEnded;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (!quoted) {
        fValue = unq('');
        fEnded = uEnd;
      } else {
        // A field that opens with a quote.
        const open = pos;
        const openLine = line;
        let close = -1;
        let q = pos + 1;
        while (true) {
          const nq = text.indexOf('"', q);
          if (nq === -1) break;
          if (text.charCodeAt(nq + 1) === 34) {
            q = nq + 2;
            continue;
          }
          close = nq;
          break;
        }
        if (close === -1) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          fValue = unq('"');
          fEnded = uEnd;
        } else {
          const raw = text.slice(open + 1, close);
          const hasDq = raw.indexOf('"') !== -1;
          const hasCR = raw.indexOf('\r') !== -1;
          const hasLF = raw.indexOf('\n') !== -1;
          let value = raw;
          if (hasCR || hasLF) {
            // Line accounting: each CR counts once, each LF counts once unless
            // it is the LF of a CRLF pair (already counted with its CR).
            let n = 0;
            let prev = 0;
            for (let i = 0; i < raw.length; i++) {
              const c = raw.charCodeAt(i);
              if (c === 13) n += 1;
              else if (c === 10 && prev !== 13) n += 1;
              prev = c;
            }
            line += n;
          }
          if (hasDq) value = value.replaceAll('""', '"');
          if (hasCR) value = value.replace(/\r\n?/g, '\n');
          pos = close + 1;
          if (pos >= len) {
            fValue = value;
            fEnded = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              fValue = value;
              fEnded = COMMA;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              fValue = value;
              fEnded = LINE_BREAK;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              fValue = value;
              fEnded = LINE_BREAK;
            } else {
              // What follows the closing quote is appended as it stands.
              fValue = unq(value);
              fEnded = uEnd;
              if (uAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            }
          }
        }
      }
      fields.push(fValue);
    } while (fEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
