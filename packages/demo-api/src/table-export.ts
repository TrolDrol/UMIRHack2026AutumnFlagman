export type ExportAuthor = {
  displayName: string;
  username: string;
  source?: string;
};
export type TableExport = {
  title: string;
  headers: string[];
  rows: string[][];
  author: ExportAuthor;
  generatedAt: string;
  context?: string;
};
export type ExportFormat = "csv" | "xlsx";
const encoder = new TextEncoder();
const xml = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
export function exportRows(data: TableExport): string[][] {
  if (!data.author.displayName.trim() || !data.author.username.trim())
    throw new Error("Укажите имя и логин автора выгрузки");
  const time = new Date(data.generatedAt);
  if (!Number.isFinite(time.getTime()))
    throw new Error("Некорректное время формирования");
  return [
    ["Таблица", data.title],
    ["Сформировал (имя)", data.author.displayName],
    ["Логин", data.author.username],
    [
      "Сформирован (Москва, UTC+3)",
      new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "short",
        timeStyle: "long",
        timeZone: "Europe/Moscow",
      }).format(time),
    ],
    ["Сформирован (UTC)", time.toISOString()],
    ["Источник автора", data.author.source || "Текущая учётная запись RIMS"],
    [
      "Область выгрузки",
      "Показанные строки текущей страницы, в текущем порядке",
    ],
    ["Контекст", data.context || ""],
    ["Количество строк", String(data.rows.length)],
    [],
    data.headers,
    ...data.rows,
  ];
}
// Quoting alone does not protect Excel/LibreOffice against CSV formula injection.
function csvCell(value: string) {
  const safe =
    /^[\s\uFEFF]*[=+\-@\t\r\n]/u.test(value) || /^[\t\r\n]/.test(value)
      ? "'" + value
      : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}
export function csvBytes(data: TableExport): Uint8Array {
  const rows = exportRows(data),
    width = Math.max(...rows.map((r) => r.length));
  return encoder.encode(
    "\uFEFF" +
      rows
        .map((r) =>
          Array.from({ length: width }, (_, i) => csvCell(r[i] || "")).join(
            ";",
          ),
        )
        .join("\r\n") +
      "\r\n",
  );
}
function column(index: number) {
  let value = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    value = String.fromCharCode(65 + ((n - 1) % 26)) + value;
  return value;
}
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let crc = i;
  for (let bit = 0; bit < 8; bit++)
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
// Small standards-compliant ZIP STORE writer: no dependency, macros or formulas.
function zip(files: Record<string, string>): Uint8Array {
  const chunks: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0,
    directorySize = 0;
  for (const [name, content] of Object.entries(files)) {
    const filename = encoder.encode(name),
      bytes = encoder.encode(content),
      crc = crc32(bytes);
    const header = new Uint8Array(30 + filename.length),
      h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x800, true);
    h.setUint16(12, 33, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, bytes.length, true);
    h.setUint32(22, bytes.length, true);
    h.setUint16(26, filename.length, true);
    header.set(filename, 30);
    chunks.push(header, bytes);
    const entry = new Uint8Array(46 + filename.length),
      e = new DataView(entry.buffer);
    e.setUint32(0, 0x02014b50, true);
    e.setUint16(4, 20, true);
    e.setUint16(6, 20, true);
    e.setUint16(8, 0x800, true);
    e.setUint16(14, 33, true);
    e.setUint32(16, crc, true);
    e.setUint32(20, bytes.length, true);
    e.setUint32(24, bytes.length, true);
    e.setUint16(28, filename.length, true);
    e.setUint32(42, offset, true);
    entry.set(filename, 46);
    central.push(entry);
    directorySize += entry.length;
    offset += header.length + bytes.length;
  }
  const end = new Uint8Array(22),
    v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, central.length, true);
  v.setUint16(10, central.length, true);
  v.setUint32(12, directorySize, true);
  v.setUint32(16, offset, true);
  const result = new Uint8Array(offset + directorySize + end.length);
  let at = 0;
  for (const chunk of [...chunks, ...central, end]) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return result;
}
export function xlsxBytes(data: TableExport): Uint8Array {
  const rows = exportRows(data),
    width = Math.max(...rows.map((r) => r.length));
  if (rows.length > 1048576 || width > 16384)
    throw new Error("Таблица превышает пределы XLSX");
  const sheet = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row.map((cell, c) => `<c r="${column(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(cell)}</t></is></c>`).join("")}</row>`,
    )
    .join("");
  const files = {
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    "xl/workbook.xml":
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Таблица" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${column(width - 1)}${rows.length}"/><sheetData>${sheet}</sheetData></worksheet>`,
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(data.title)}</dc:title><dc:creator>${xml(data.author.displayName)} (${xml(data.author.username)})</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${xml(new Date(data.generatedAt).toISOString())}</dcterms:created></cp:coreProperties>`,
  };
  return zip(files);
}
function cellText(cell: Element, header = false) {
  if (cell.hasAttribute("data-export-value"))
    return cell.getAttribute("data-export-value")!;
  const clone = cell.cloneNode(true) as Element;
  clone.querySelectorAll("[data-export-value]").forEach((element) => {
    element.replaceWith(element.getAttribute("data-export-value") || "");
  });
  const selects = Array.from(cell.querySelectorAll("select"));
  clone.querySelectorAll("select").forEach((select, index) =>
    select.replaceWith(
      Array.from(selects[index].selectedOptions)
        .map((option) => option.textContent || "")
        .join(", "),
    ),
  );
  clone
    .querySelectorAll(
      `script,style,svg,[hidden],[popover],[role="tooltip"],[aria-hidden="true"],[data-export-ignore],input,select,textarea,${header ? "[data-action-help]" : "button"}`,
    )
    .forEach((e) => e.remove());
  clone.querySelectorAll("br").forEach((e) => e.replaceWith("\n"));
  clone.querySelectorAll("p,div,li").forEach((e) => e.append("\n"));
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const text: string[] = [];
  while (walker.nextNode()) text.push(walker.currentNode.textContent || "");
  return text
    .join(" ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}
export function snapshotTable(
  table: HTMLTableElement,
): Pick<TableExport, "title" | "headers" | "rows" | "context"> {
  const headings = Array.from(table.tHead?.rows[0]?.cells || []);
  const included = headings
    .map((h, i) => ({ index: i, text: cellText(h, true) }))
    .filter(
      (h) =>
        !headings[h.index].hasAttribute("data-export-ignore") &&
        !/^(действия|управление)$/i.test(h.text),
    );
  const headers = included.map((h) => h.text);
  const rows = Array.from(table.tBodies)
    .flatMap((b) => Array.from(b.rows))
    .filter((r) => !r.hidden && !r.hasAttribute("data-export-ignore"))
    .map((r) =>
      included.map((h) => (r.cells[h.index] ? cellText(r.cells[h.index]) : "")),
    );
  let title = table.getAttribute("data-export-title") || "";
  for (
    let parent = table.parentElement;
    parent && !title;
    parent = parent.parentElement
  ) {
    title =
      Array.from(parent.children)
        .find((e) => /^H[1-6]$/.test(e.tagName))
        ?.textContent?.trim() || "";
  }
  if (!title)
    title =
      Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
        .filter(
          (h) =>
            !!(
              h.compareDocumentPosition(table) &
              Node.DOCUMENT_POSITION_FOLLOWING
            ),
        )
        .at(-1)
        ?.textContent?.trim() || "";
  const filters = new URLSearchParams(location.search),
    allowed = [
      "q",
      "status",
      "kind",
      "page",
      "pageSize",
      "ingredientId",
      "deliveryId",
      "source",
      "view",
      "from",
      "to",
    ];
  const context = allowed
    .filter((k) => filters.has(k))
    .map((k) => `${k}=${filters.get(k)}`)
    .join("; ");
  return {
    title: title || headers.join(" · ") || "Таблица",
    headers,
    rows,
    context,
  };
}
export function downloadTable(
  table: HTMLTableElement,
  author: ExportAuthor,
  format: ExportFormat,
) {
  const data: TableExport = {
    ...snapshotTable(table),
    author,
    generatedAt: new Date().toISOString(),
  };
  const bytes = format === "csv" ? csvBytes(data) : xlsxBytes(data);
  const blob = new Blob([new Uint8Array(bytes).buffer], {
    type:
      format === "csv"
        ? "text/csv;charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `RIMS-${data.title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 80)}-${data.generatedAt.replace(/[:.]/g, "-")}.${format}`;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
