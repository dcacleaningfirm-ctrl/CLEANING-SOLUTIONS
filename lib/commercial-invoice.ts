import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { invoiceLogoJpg } from "./invoice-logo.ts";

export interface InvoicePhoto { id: number; caption: string; bytes: Uint8Array; type: string }
export interface InvoiceData {
  number: string; company: string; representative: string; address: string;
  reference: string; details: string; date: string;
  lines: { label: string; quantity: number; amountCents: number }[];
  totalCents: number; paidCents: number; photos: InvoicePhoto[];
}

export async function createCommercialInvoice(data: InvoiceData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedJpg(invoiceLogoJpg);
  const ink = rgb(0.08, 0.1, 0.14);
  const gold = rgb(0.68, 0.48, 0.11);
  const print = (page: ReturnType<typeof pdf.addPage>, value: string, x: number, y: number, size = 11, heavy = false) =>
    page.drawText(value.replace(/[^\x20-\x7e]/g, " ").slice(0, 105), { x, y, size, font: heavy ? bold : regular, color: ink });
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  let page = pdf.addPage([612, 792]);
  page.drawRectangle({ x: 0, y: 687, width: 612, height: 105, color: rgb(0, 0, 0) });
  page.drawImage(logo, { x: 25, y: 695, width: 150, height: 100 });
  page.drawText("INVOICE", { x: 458, y: 735, size: 18, font: bold, color: rgb(1, 1, 1) });
  print(page, `INVOICE ${data.number}`, 38, 657, 17, true);
  print(page, `Date: ${data.date}`, 38, 634);
  print(page, `Bill to: ${data.company}`, 38, 601, 13, true);
  if (data.representative) print(page, `Representative: ${data.representative}`, 38, 581);
  print(page, `Service address: ${data.address}`, 38, 561);
  print(page, `Work order / PO: ${data.reference}`, 38, 541);
  print(page, `Work: ${data.details}`, 38, 521);
  let y = 486;
  print(page, "SERVICES", 38, y, 12, true);
  y -= 24;
  for (const line of data.lines) {
    if (y < 145) { page = pdf.addPage([612, 792]); y = 740; }
    print(page, `${line.quantity} x ${line.label}`, 38, y);
    print(page, dollars(line.amountCents), 480, y);
    y -= 22;
  }
  y -= 13;
  page.drawLine({ start: { x: 38, y }, end: { x: 570, y }, thickness: 1, color: gold });
  y -= 25;
  print(page, `Total: ${dollars(data.totalCents)}`, 38, y, 12, true);
  print(page, `Paid: ${dollars(data.paidCents)}`, 250, y);
  print(page, `Balance: ${dollars(Math.max(0, data.totalCents - data.paidCents))}`, 410, y, 12, true);
  if (data.photos.length) {
    for (const photo of data.photos) {
      const image = photo.type === "image/png" ? await pdf.embedPng(photo.bytes) : await pdf.embedJpg(photo.bytes);
      const p = pdf.addPage([612, 792]);
      p.drawRectangle({ x: 0, y: 710, width: 612, height: 82, color: rgb(0, 0, 0) });
      p.drawImage(logo, { x: 30, y: 715, width: 105, height: 70 });
      p.drawText(`INVOICE ${data.number} - JOB PHOTO`, { x: 250, y: 746, size: 11, font: bold, color: rgb(1, 1, 1) });
      const scale = Math.min(536 / image.width, 615 / image.height, 1);
      p.drawImage(image, { x: 38 + (536 - image.width * scale) / 2, y: 75 + (615 - image.height * scale) / 2,
        width: image.width * scale, height: image.height * scale });
      print(p, photo.caption || `Photo ${photo.id}`, 38, 45);
    }
  }
  return pdf.save();
}
