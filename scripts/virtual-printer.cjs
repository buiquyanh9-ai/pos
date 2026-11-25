// Virtual ESC/POS network printer for testing without hardware.
// Listens on TCP (default 0.0.0.0:9100, like a LAN thermal printer), decodes the ESC/POS commands
// ShopFlow sends (reset, align, bold, cut, cash drawer pulse), prints the receipt to the console and
// saves each job to output/virtual-printer/job-<n>.txt (rendered) and .bin (raw bytes).
// Usage: node scripts/virtual-printer.cjs [port]
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const port = Number(process.argv[2] || 9100);
const outDir = path.resolve(__dirname, '..', 'output', 'virtual-printer');
fs.mkdirSync(outDir, { recursive: true });
let jobNo = 0;

function render(buf) {
  const lines = [];
  const events = [];
  let cur = '';
  let align = 0;
  let bold = false;
  let lineBold = false;
  let nonAscii = 0;
  const flush = () => {
    const tag = (align === 1 ? '[C]' : align === 2 ? '[R]' : '   ') + (lineBold ? '[B] ' : '    ');
    lines.push(tag + cur);
    cur = '';
    lineBold = false;
  };
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x1b) {
      const c = buf[i + 1];
      if (c === 0x40) { align = 0; bold = false; i += 1; events.push('reset'); continue; }
      if (c === 0x61) { align = buf[i + 2] & 3; i += 2; continue; }
      if (c === 0x45) { bold = !!(buf[i + 2] & 1); i += 2; continue; }
      if (c === 0x70) { events.push('CASH DRAWER PULSE'); i += 4; continue; }
      events.push('unknown ESC 0x' + (c ?? 0).toString(16)); i += 1; continue;
    }
    if (b === 0x1d) {
      const c = buf[i + 1];
      if (c === 0x56) { if (cur) flush(); lines.push('------------------------ CUT ------------------------'); events.push('cut'); i += 2; continue; }
      events.push('unknown GS 0x' + (c ?? 0).toString(16)); i += 1; continue;
    }
    if (b === 0x0a) { flush(); continue; }
    if (b >= 0x80) nonAscii += 1; // text bytes only; command parameters are skipped above
    if (bold) lineBold = true;
    cur += String.fromCharCode(b);
  }
  if (cur) flush();
  return { text: lines.join('\n'), events, nonAscii };
}

net.createServer((socket) => {
  const chunks = [];
  socket.on('data', (d) => chunks.push(d));
  socket.on('end', () => {
    const buf = Buffer.concat(chunks);
    if (!buf.length) return;
    jobNo += 1;
    const { text, events, nonAscii } = render(buf);
    const base = path.join(outDir, `job-${jobNo}`);
    fs.writeFileSync(base + '.bin', buf);
    fs.writeFileSync(base + '.txt', `${new Date().toISOString()} from ${socket.remoteAddress} (${buf.length} bytes)\nevents: ${events.join(', ')}\nnon-ASCII bytes: ${nonAscii}\n\n${text}\n`);
    console.log(`\n=== JOB ${jobNo}: ${buf.length} bytes from ${socket.remoteAddress}; events: ${events.join(', ')}; non-ASCII bytes: ${nonAscii}`);
    console.log(text);
  });
  socket.on('error', () => {});
}).listen(port, '0.0.0.0', () => console.log(`Virtual ESC/POS printer listening on 0.0.0.0:${port}; jobs saved to ${outDir}`));
