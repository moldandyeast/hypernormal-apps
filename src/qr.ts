import qrcode from "qrcode-generator";

// Render a URL (or any text) as a self-contained SVG QR code. No DOM, no deps
// beyond the pure-JS matrix generator, so it runs in the Worker.
//
// Error-correction level "M" (~15%) balances density and scannability; a 4-module
// quiet zone is the spec minimum for reliable scanning.
export function qrSvg(text: string, opts: { scale?: number; margin?: number } = {}): string {
  const scale = opts.scale ?? 8;
  const margin = opts.margin ?? 4;

  const qr = qrcode(0, "M"); // type 0 = auto-size for the data length
  qr.addData(text);
  qr.make();

  const n = qr.getModuleCount();
  const dim = (n + margin * 2) * scale;

  let d = "";
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!qr.isDark(row, col)) continue;
      const x = (col + margin) * scale;
      const y = (row + margin) * scale;
      d += `M${x} ${y}h${scale}v${scale}h${-scale}z`;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" ` +
    `viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">` +
    `<rect width="${dim}" height="${dim}" fill="#ffffff"/>` +
    `<path fill="#000000" d="${d}"/>` +
    `</svg>`
  );
}
