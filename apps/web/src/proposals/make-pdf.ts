import type { ProposalPdfData } from './pdf';

/** Loads the PDF code and fonts only when a PDF is actually made (keeps the panel bundle small). */
export async function makeProposalPdf(data: ProposalPdfData): Promise<Uint8Array> {
  const [{ buildProposalPdf }, regular, bold] = await Promise.all([
    import('./pdf'),
    fetch('/fonts/NotoSans-Regular.ttf').then((r) => r.arrayBuffer()),
    fetch('/fonts/NotoSans-Bold.ttf').then((r) => r.arrayBuffer()),
  ]);
  return buildProposalPdf(data, { regular, bold });
}
