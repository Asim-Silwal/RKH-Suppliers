import "regenerator-runtime/runtime.js";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

type StatementParty = { name: string; company?: string; contact?: string; location?: string };
type StatementEntry = {
  id: string;
  type: "PURCHASE" | "PAYMENT";
  amount: number;
  ad: string;
  bs: string;
  description: string;
};

const WIDTH = 595.28;
const HEIGHT = 841.89;
const MARGIN = 36;
const TABLE_TOP = 184;
const ROW_START = 206;
const ROW_LIMIT = 763;
const BLUE = rgb(0.2, 0.32, 0.83);
const NAVY = rgb(0.08, 0.13, 0.2);
const MUTED = rgb(0.38, 0.43, 0.51);
const STRIPE = rgb(0.91, 0.95, 1);
const WHITE = rgb(1, 1, 1);
const COLUMNS = [72, 175, 49, 72, 76, 79];
const HEADERS = ["Date (BS / AD)", "Description", "Ref.", "Sales", "Payments", "Balance"];
const amount = (cents: number) => (cents / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function drawText(page: PDFPage, value: string, x: number, top: number, size: number, font: PDFFont, color = NAVY) {
  page.drawText(value, { x, y: HEIGHT - top - size, size, font, color });
}

function drawRight(page: PDFPage, value: string, right: number, top: number, size: number, font: PDFFont, color = NAVY) {
  drawText(page, value, right - font.widthOfTextAtSize(value, size), top, size, font, color);
}

function scriptRuns(value: string, latin: PDFFont, devanagari: PDFFont) {
  const runs: { text: string; font: PDFFont }[] = [];
  for (const character of value) {
    const font = /[\u0900-\u097f]/u.test(character) ? devanagari : latin;
    const last = runs[runs.length - 1];
    if (last?.font === font) last.text += character;
    else runs.push({ text: character, font });
  }
  return runs;
}

function mixedWidth(value: string, latin: PDFFont, devanagari: PDFFont, size: number) {
  return scriptRuns(value, latin, devanagari).reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, size), 0);
}

function drawMixedText(page: PDFPage, value: string, x: number, top: number, size: number, latin: PDFFont, devanagari: PDFFont, color = NAVY) {
  for (const run of scriptRuns(value, latin, devanagari)) {
    drawText(page, run.text, x, top, size, run.font, color);
    x += run.font.widthOfTextAtSize(run.text, size);
  }
}

function wrapText(value: string, latin: PDFFont, devanagari: PDFFont, size: number, maxWidth: number) {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const combined = line ? `${line} ${word}` : word;
    if (mixedWidth(combined, latin, devanagari, size) <= maxWidth) {
      line = combined;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const character of word) {
      if (mixedWidth(line + character, latin, devanagari, size) > maxWidth && line) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function drawBase(page: PDFPage, party: StatementParty, period: string, font: PDFFont, devanagari: PDFFont, bold: PDFFont) {
  page.drawRectangle({ x: MARGIN, y: HEIGHT - 67, width: 36, height: 36, color: NAVY });
  drawText(page, "RKH", 41, 40, 11, bold, WHITE);
  drawText(page, "RKH SUPPLIERS", 83, 28, 18, bold);
  drawText(page, "KATHMANDU, NEPAL", 84, 51, 8, font, MUTED);
  drawRight(page, "CUSTOMER ACCOUNT STATEMENT", WIDTH - MARGIN, 32, 10, bold);
  page.drawLine({ start: { x: MARGIN, y: HEIGHT - 76 }, end: { x: WIDTH - MARGIN, y: HEIGHT - 76 }, thickness: 1, color: NAVY });

  drawText(page, "CUSTOMER", MARGIN, 89, 8, bold, BLUE);
  wrapText(party.name, font, devanagari, 12, 265).slice(0, 2).forEach((line, index) => drawMixedText(page, line, MARGIN, 104 + index * 14, 12, font, devanagari));
  if (party.company) drawMixedText(page, party.company, MARGIN, 135, 8, font, devanagari, MUTED);
  if (party.location) drawMixedText(page, party.location, MARGIN, 149, 8, font, devanagari, MUTED);
  if (party.contact) drawText(page, `Contact: ${party.contact}`, MARGIN, 163, 8, font, MUTED);

  drawRight(page, "STATEMENT PERIOD (BS)", WIDTH - MARGIN, 94, 8, bold, BLUE);
  drawRight(page, period, WIDTH - MARGIN, 109, 9, font);
  drawRight(page, "Amounts in NPR", WIDTH - MARGIN, 129, 8, font, MUTED);

  page.drawRectangle({ x: MARGIN, y: HEIGHT - TABLE_TOP - 22, width: WIDTH - MARGIN * 2, height: 22, color: BLUE });
  let x = MARGIN;
  HEADERS.forEach((heading, index) => {
    const rightAligned = index >= 3;
    if (rightAligned) drawRight(page, heading, x + COLUMNS[index] - 5, TABLE_TOP + 6, 8, bold, WHITE);
    else drawText(page, heading, x + 5, TABLE_TOP + 6, 8, bold, WHITE);
    x += COLUMNS[index];
  });
  page.drawLine({ start: { x: MARGIN, y: HEIGHT - 795 }, end: { x: WIDTH - MARGIN, y: HEIGHT - 795 }, thickness: 0.6, color: rgb(0.79, 0.84, 0.91) });
  drawText(page, "RKH Suppliers  |  Customer account statement", MARGIN, 801, 7, font, MUTED);
}

export async function createPartyStatementPdf(party: StatementParty, entries: StatementEntry[], fontBytes: Uint8Array) {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const devanagari = await document.embedFont(fontBytes, { subset: true });
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  document.setTitle(`${party.name} - customer statement`);
  document.setAuthor("RKH Suppliers");
  document.setSubject("Customer account statement");

  const ordered = [...entries].sort((a, b) => a.ad.localeCompare(b.ad) || (a.type === b.type ? 0 : a.type === "PURCHASE" ? -1 : 1));
  const period = ordered.length ? `${ordered[0].bs} to ${ordered[ordered.length - 1].bs}` : "No transactions recorded";
  const pages: PDFPage[] = [];
  const newPage = () => {
    const page = document.addPage([WIDTH, HEIGHT]);
    drawBase(page, party, period, font, devanagari, bold);
    pages.push(page);
    return page;
  };
  let page = newPage();
  let top = ROW_START;
  let balanceCents = 0;
  let salesCents = 0;
  let paymentsCents = 0;
  let rowIndex = 0;

  drawText(page, "Opening balance", MARGIN + COLUMNS[0] + 5, top + 6, 8, font, MUTED);
  drawRight(page, amount(0), WIDTH - MARGIN - 5, top + 6, 8, font, MUTED);
  top += 24;
  rowIndex += 1;

  const drawRow = (entry: StatementEntry, lines: string[], height: number) => {
    if (rowIndex % 2 === 1) page.drawRectangle({ x: MARGIN, y: HEIGHT - top - height, width: WIDTH - MARGIN * 2, height, color: STRIPE });
    const sales = entry.type === "PURCHASE" ? Math.round(entry.amount * 100) : 0;
    const payment = entry.type === "PAYMENT" ? Math.round(entry.amount * 100) : 0;
    salesCents += sales;
    paymentsCents += payment;
    balanceCents += sales - payment;
    const x = [MARGIN, MARGIN + 72, MARGIN + 247, MARGIN + 296, MARGIN + 368, MARGIN + 444];
    drawText(page, entry.bs, x[0] + 5, top + 5, 8, font);
    drawText(page, entry.ad, x[0] + 5, top + 16, 7, font, MUTED);
    lines.forEach((line, index) => drawMixedText(page, line, x[1] + 5, top + 5 + index * 10, 8, font, devanagari));
    drawText(page, entry.id.slice(0, 8).toUpperCase(), x[2] + 5, top + 5, 7, font, MUTED);
    if (sales) drawRight(page, amount(sales), x[3] + COLUMNS[3] - 5, top + 5, 8, font);
    if (payment) drawRight(page, amount(payment), x[4] + COLUMNS[4] - 5, top + 5, 8, font);
    drawRight(page, amount(balanceCents), WIDTH - MARGIN - 5, top + 5, 8, font);
    top += height;
    rowIndex += 1;
  };

  if (!ordered.length) {
    drawText(page, "No transactions recorded for this customer.", MARGIN + 6, top + 10, 9, font, MUTED);
    top += 36;
  }

  for (const entry of ordered) {
    const kind = entry.type === "PURCHASE" ? "Sale" : "Payment received";
    const description = entry.description.trim()
      ? entry.description.trim().toLowerCase().startsWith(kind.toLowerCase()) ? entry.description.trim() : `${kind} - ${entry.description.trim()}`
      : kind;
    const lines = wrapText(description, font, devanagari, 8, COLUMNS[1] - 10);
    const height = Math.max(30, 13 + lines.length * 10);
    if (top + height > ROW_LIMIT) {
      page = newPage();
      top = ROW_START;
    }
    drawRow(entry, lines, height);
  }

  if (top + 70 > ROW_LIMIT) {
    page = newPage();
    top = ROW_START;
  }
  page.drawRectangle({ x: MARGIN, y: HEIGHT - top - 28, width: WIDTH - MARGIN * 2, height: 28, color: STRIPE });
  drawText(page, "TOTALS", MARGIN + 6, top + 8, 9, bold);
  drawRight(page, amount(salesCents), MARGIN + 368, top + 8, 9, bold);
  drawRight(page, amount(paymentsCents), MARGIN + 444, top + 8, 9, bold);
  drawRight(page, amount(balanceCents), WIDTH - MARGIN - 5, top + 8, 9, bold);
  top += 39;
  drawText(page, balanceCents >= 0 ? "Closing balance due" : "Advance payment", MARGIN + 6, top, 9, bold);
  drawRight(page, `NPR ${amount(Math.abs(balanceCents))}`, WIDTH - MARGIN - 5, top, 10, bold, BLUE);

  pages.forEach((item, index) => drawRight(item, `Page ${index + 1} of ${pages.length}`, WIDTH - MARGIN, 801, 7, font, MUTED));
  return document.save();
}
