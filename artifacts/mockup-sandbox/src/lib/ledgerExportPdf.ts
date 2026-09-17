import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

type LedgerExport = {
  title: string;
  period: string;
  headers: string[];
  rows: (string | number)[][];
};

const WIDTH = 841.89;
const HEIGHT = 595.28;
const MARGIN = 34;
const NAVY = rgb(0.12, 0.16, 0.22);
const BLUE = rgb(0.19, 0.41, 0.70);
const MUTED = rgb(0.40, 0.44, 0.50);
const STRIPE = rgb(0.95, 0.97, 1);

const truncate = (value: string, limit: number) => value.length > limit ? `${value.slice(0, Math.max(1, limit - 3))}...` : value;

function text(page: PDFPage, value: string, x: number, top: number, size: number, font: PDFFont, color = NAVY) {
  page.drawText(value, { x, y: HEIGHT - top - size, size, font, color });
}

function right(page: PDFPage, value: string, edge: number, top: number, size: number, font: PDFFont, color = NAVY) {
  text(page, value, edge - font.widthOfTextAtSize(value, size), top, size, font, color);
}

export async function createLedgerExportPdf(exportData: LedgerExport, fontBytes: Uint8Array) {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const devanagari = await document.embedFont(fontBytes, { subset: true });
  document.setTitle(exportData.title);
  document.setAuthor("RKH Suppliers");

  const columns = exportData.headers.length;
  const tableWidth = WIDTH - MARGIN * 2;
  const columnWidth = tableWidth / columns;
  const pages: PDFPage[] = [];
  const drawPage = () => {
    const page = document.addPage([WIDTH, HEIGHT]);
    pages.push(page);
    page.drawRectangle({ x: MARGIN, y: HEIGHT - 56, width: 34, height: 34, color: NAVY });
    text(page, "RKH", MARGIN + 5, 33, 10, bold, rgb(1, 1, 1));
    text(page, "RKH SUPPLIERS", MARGIN + 48, 25, 17, bold);
    text(page, exportData.title.toUpperCase(), MARGIN + 48, 48, 8, font, MUTED);
    right(page, exportData.period, WIDTH - MARGIN, 30, 9, font, MUTED);
    page.drawLine({ start: { x: MARGIN, y: HEIGHT - 72 }, end: { x: WIDTH - MARGIN, y: HEIGHT - 72 }, thickness: 1, color: rgb(0.82, 0.85, 0.90) });
    page.drawRectangle({ x: MARGIN, y: HEIGHT - 96, width: tableWidth, height: 24, color: BLUE });
    exportData.headers.forEach((header, index) => text(page, truncate(header, 21), MARGIN + columnWidth * index + 6, 80, 7, bold, rgb(1, 1, 1)));
    return page;
  };

  let page = drawPage();
  let top = 96;
  exportData.rows.forEach((row, index) => {
    if (top + 23 > HEIGHT - 45) {
      page = drawPage();
      top = 96;
    }
    if (index % 2 === 0) page.drawRectangle({ x: MARGIN, y: HEIGHT - top - 23, width: tableWidth, height: 23, color: STRIPE });
    row.forEach((item, column) => {
      const value = typeof item === "number" ? item.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : item;
      const content = truncate(value.replace(/\s+/g, " "), 29);
      const currentFont = /[\u0900-\u097f]/u.test(content) ? devanagari : font;
      text(page, content, MARGIN + columnWidth * column + 6, top + 7, 7.5, currentFont, column === 0 && /^TOTAL/i.test(content) ? BLUE : NAVY);
    });
    top += 23;
  });
  pages.forEach((item, index) => {
    text(item, "RKH Suppliers | Generated from RKH Ledger", MARGIN, HEIGHT - 27, 7, font, MUTED);
    right(item, `Page ${index + 1} of ${pages.length}`, WIDTH - MARGIN, HEIGHT - 27, 7, font, MUTED);
  });
  return document.save();
}
