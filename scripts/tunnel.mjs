// Public HTTPS link to this shop server, so the owner's phone works on any network (4G, other Wi-Fi).
// Uses Cloudflare Quick Tunnel (free, no account): `cloudflared tunnel --url http://localhost:4000`.
// Needs cloudflared.exe on PATH or in ./tools/. The link changes each time the tunnel restarts;
// for a fixed address use a named tunnel with your own domain (docs/DEPLOY.md).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const port = process.env.PORT ?? '4000';
const local = join(process.cwd(), 'tools', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
const bin = existsSync(local) ? local : 'cloudflared';
const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
child.on('error', () => {
  console.error('Không tìm thấy cloudflared. Tải cloudflared-windows-amd64.exe từ https://github.com/cloudflare/cloudflared/releases, đổi tên thành cloudflared.exe và đặt vào thư mục tools/.');
  process.exit(1);
});
let shown = false;
const onData = (buf) => {
  const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m && !shown) {
    shown = true;
    console.log('\n================ ShopFlow trên Internet ================');
    console.log(`  Boss (điện thoại chủ, mạng bất kỳ): ${m[0]}/boss/`);
    console.log(`  POS (máy bán hàng):                 ${m[0]}/pos/`);
    console.log('  Giữ cửa sổ này mở. Đóng cửa sổ = tắt đường link.');
    console.log('=========================================================\n');
  }
};
child.stdout.on('data', onData);
child.stderr.on('data', onData);
child.on('exit', (code) => process.exit(code ?? 0));
