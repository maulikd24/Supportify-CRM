/** Minimal, dependency-free CSV read/write — good enough for exports/imports of a few thousand rows. */

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0 && !columns) return "";
  const cols = columns ?? Object.keys(rows[0]);
  const lines = [cols.join(",")];
  for (const row of rows) {
    lines.push(cols.map((c) => escapeCell(row[c])).join(","));
  }
  return lines.join("\n");
}

/** Parses CSV text into rows of {column: value}. Handles quoted fields with embedded commas/newlines/quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch === "\r") {
      // skip, \n handles the row break
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();

  const [header, ...dataRows] = rows.filter((r) => r.length > 1 || r[0] !== "");
  if (!header) return [];

  return dataRows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}
