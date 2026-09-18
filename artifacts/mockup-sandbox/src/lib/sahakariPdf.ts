import "regenerator-runtime/runtime.js";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type SahakariPdfRow = {
  dateBs: string;
  status: string;
  amount: number | null;
  balance: number;
  reason: string;
  recordedBy: string;
};

type SahakariPdfData = {
  cooperativeName: string;
  period: string;
  generatedBs: string;
  rows: SahakariPdfRow[];
};

const WIDTH = 841.89;
const HEIGHT = 595.28;
const MARGIN = 36;
const NAVY = rgb(0.10, 0.17, 0.28);
const BLUE = rgb(0.15, 0.36, 0.67);
const MUTED = rgb(0.39, 0.45, 0.52);
const PALE = rgb(0.94, 0.97, 1);
const LINE = rgb(0.84, 0.88, 0.93);
const WHITE = rgb(1, 1, 1);
const COLUMNS = [80, 83, 90, 98, 211, 206];
const EDGES = COLUMNS.reduce<number[]>((edges, width) => [...edges, edges[edges.length - 1] + width], [MARGIN]);
const formatAmount = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function drawText(page: PDFPage, value: string, x: number, top: number, size: number, font: PDFFont, color = NAVY) {
  page.drawText(value, { x, y: HEIGHT - top - size, size, font, color });
}

function drawRight(page: PDFPage, value: string, edge: number, top: number, size: number, font: PDFFont, color = NAVY) {
  drawText(page, value, edge - font.widthOfTextAtSize(value, size), top, size, font, color);
}

function scriptRuns(value: string, latin: PDFFont, devanagari: PDFFont) {
  const safe = value.replace(/[\u2010-\u2015]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\x20-\x7e\u0900-\u097f]/gu, "?");
  const runs: { text: string; font: PDFFont }[] = [];
  for (const character of safe) {
    const chosen = /[\u0900-\u097f]/u.test(character) ? devanagari : latin;
    const previous = runs[runs.length - 1];
    if (previous?.font === chosen) previous.text += character;
    else runs.push({ text: character, font: chosen });
  }
  return runs;
}

function mixedWidth(value: string, latin: PDFFont, devanagari: PDFFont, size: number) {
  return scriptRuns(value, latin, devanagari).reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, size), 0);
}

function drawMixed(page: PDFPage, value: string, x: number, top: number, size: number, latin: PDFFont, devanagari: PDFFont, color = NAVY) {
  for (const run of scriptRuns(value, latin, devanagari)) {
    drawText(page, run.text, x, top, size, run.font, color);
    x += run.font.widthOfTextAtSize(run.text, size);
  }
}

function wrap(value: string, font: PDFFont, devanagari: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  let current = "";
  for (const word of value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (mixedWidth(candidate, font, devanagari, size) <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = "";
    for (const character of word) {
      if (current && mixedWidth(current + character, font, devanagari, size) > width) {
        lines.push(current);
        current = "";
      }
      current += character;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export async function createSahakariPdf(data: SahakariPdfData, fontBytes: Uint8Array) {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const devanagari = await document.embedFont(fontBytes, { subset: true });
  document.setTitle(`${data.cooperativeName} - Daily records (${data.period})`);
  document.setAuthor("RKH Suppliers");
  document.setSubject("Sahakari daily savings records - BS dates");

  const deposited = data.rows.filter((row) => row.status === "Deposited");
  const depositedAmount = deposited.reduce((sum, row) => sum + (row.amount ?? 0), 0);
  const closingBalance = data.rows[0]?.balance ?? 0;
  const pages: PDFPage[] = [];
  const addPage = () => {
    const page = document.addPage([WIDTH, HEIGHT]);
    pages.push(page);
    page.drawRectangle({ x: MARGIN, y: HEIGHT - 56, width: 36, height: 36, color: NAVY });
    drawText(page, "RKH", MARGIN + 5, 31, 10, bold, WHITE);
    drawText(page, "RKH SUPPLIERS", MARGIN + 47, 21, 16, bold);
    drawText(page, "SAHAKARI DAILY RECORDS", MARGIN + 47, 43, 8, font, MUTED);
    drawRight(page, `Generated ${data.generatedBs} BS`, WIDTH - MARGIN, 28, 8, font, MUTED);
    page.drawLine({ start: { x: MARGIN, y: HEIGHT - 67 }, end: { x: WIDTH - MARGIN, y: HEIGHT - 67 }, thickness: 1, color: LINE });

    const nameLines = wrap(data.cooperativeName, font, devanagari, 13, WIDTH - MARGIN * 2 - 160).slice(0, 2);
    nameLines.forEach((line, index) => drawMixed(page, line, MARGIN, 77 + index * 16, 13, bold, devanagari));
    drawRight(page, data.period, WIDTH - MARGIN, 83, 10, font, BLUE);
    drawRight(page, "Period (BS)", WIDTH - MARGIN, 101, 8, font, MUTED);

    const cards = [
      ["Deposit days", String(deposited.length)],
      ["Deposited in period", `NPR ${formatAmount(depositedAmount)}`],
      ["Closing balance", `NPR ${formatAmount(closingBalance)}`],
    ];
    const cardGap = 10;
    const cardWidth = (WIDTH - MARGIN * 2 - cardGap * 2) / 3;
    cards.forEach(([label, value], index) => {
      const x = MARGIN + index * (cardWidth + cardGap);
      page.drawRectangle({ x, y: HEIGHT - 165, width: cardWidth, height: 45, color: PALE });
      drawText(page, label, x + 9, 126, 7.5, font, MUTED);
      drawText(page, value, x + 9, 141, 11, bold);
    });

    page.drawRectangle({ x: MARGIN, y: HEIGHT - 199, width: WIDTH - MARGIN * 2, height: 25, color: BLUE });
    ["Date (BS)", "Status", "Amount (NPR)", "Balance (NPR)", "Reason", "Recorded by"].forEach((heading, index) => {
      if (index === 2 || index === 3) drawRight(page, heading, EDGES[index + 1] - 7, 181, 8, font, WHITE);
      else drawText(page, heading, EDGES[index] + 7, 181, 8, font, WHITE);
    });
    return page;
  };

  let page = addPage();
  let top = 199;
  data.rows.forEach((row, index) => {
    const reasonLines = wrap(row.reason || "-", font, devanagari, 7.5, COLUMNS[4] - 14);
    const recorderLines = wrap(row.recordedBy || "-", font, devanagari, 7.5, COLUMNS[5] - 14);
    const height = Math.max(24, 9 + Math.max(reasonLines.length, recorderLines.length) * 10);
    if (top + height > HEIGHT - 47) { page = addPage(); top = 199; }
    if (index % 2 === 0) page.drawRectangle({ x: MARGIN, y: HEIGHT - top - height, width: WIDTH - MARGIN * 2, height, color: PALE });
    drawText(page, row.dateBs, EDGES[0] + 7, top + 7, 8, font);
    drawText(page, row.status, EDGES[1] + 7, top + 7, 8, font);
    drawRight(page, row.amount === null ? "-" : formatAmount(row.amount), EDGES[3] - 7, top + 7, 8, font);
    drawRight(page, formatAmount(row.balance), EDGES[4] - 7, top + 7, 8, font);
    reasonLines.forEach((line, lineIndex) => drawMixed(page, line, EDGES[4] + 7, top + 6 + lineIndex * 10, 7.5, font, devanagari));
    recorderLines.forEach((line, lineIndex) => drawMixed(page, line, EDGES[5] + 7, top + 6 + lineIndex * 10, 7.5, font, devanagari));
    top += height;
  });

  pages.forEach((item, index) => {
    item.drawLine({ start: { x: MARGIN, y: 34 }, end: { x: WIDTH - MARGIN, y: 34 }, thickness: 0.6, color: LINE });
    drawText(item, "All dates in BS  |  Amounts in NPR", MARGIN, HEIGHT - 29, 7, font, MUTED);
    drawRight(item, `Page ${index + 1} of ${pages.length}`, WIDTH - MARGIN, HEIGHT - 29, 7, font, MUTED);
  });
  return document.save();
}
