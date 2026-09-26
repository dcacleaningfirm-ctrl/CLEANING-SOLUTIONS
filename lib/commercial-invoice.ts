import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { invoiceLogoPng } from "./invoice-logo.ts";

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
  const logo = await pdf.embedPng(invoiceLogoPng);
  const ink = rgb(0.08, 0.1, 0.14);
  const gold = rgb(0.68, 0.48, 0.11);
  const print = (page: ReturnType<typeof pdf.addPage>, value: string, x: number, y: number, size = 11, heavy = false) =>
    page.drawText(value.replace(/[^\x20-\x7e]/g, " ").slice(0, 105), { x, y, size, font: heavy ? bold : regular, color: ink });
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  let page = pdf.addPage([612, 792]);
  page.drawRectangle({ x: 0, y: 737, width: 612, height: 55, color: ink });
  page.drawRectangle({ x: 30, y: 741, width: 210, height: 47, color: rgb(1, 1, 1) });
  page.drawImage(logo, { x: 35, y: 742, width: 180, height: 45 });
  page.drawText("INVOICE", { x: 458, y: 758, size: 18, font: bold, color: rgb(1, 1, 1) });
  print(page, `INVOICE ${data.number}`, 38, 706, 17, true);
  print(page, `Date: ${data.date}`, 38, 683);
  print(page, `Bill to: ${data.company}`, 38, 650, 13, true);
  if (data.representative) print(page, `Representative: ${data.representative}`, 38, 630);
  print(page, `Service address: ${data.address}`, 38, 610);
  print(page, `Work order / PO: ${data.reference}`, 38, 590);
  print(page, `Work: ${data.details}`, 38, 570);
  let y = 535;
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
      p.drawImage(logo, { x: 38, y: 725, width: 180, height: 45 });
      print(p, `INVOICE ${data.number} - JOB PHOTO`, 250, 746, 11, true);
      const scale = Math.min(536 / image.width, 640 / image.height, 1);
      p.drawImage(image, { x: 38 + (536 - image.width * scale) / 2, y: 80 + (640 - image.height * scale) / 2,
        width: image.width * scale, height: image.height * scale });
      print(p, photo.caption || `Photo ${photo.id}`, 38, 45);
    }
  }
  return pdf.save();
}
