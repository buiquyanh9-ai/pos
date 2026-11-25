// One-command DEMO of the whole ShopFlow system (POS + Boss + backend + virtual printer [+ Android emulator]).
// Uses its own SAMPLE database (apps/server/data/demo.db, recreated each run), never the shop's shopflow.db.
// Usage: node scripts/demo.mjs [--keep] [--no-android] [--web]
//   --keep        keep the demo database from the last run instead of starting fresh
//   --no-android  do not start the Android emulator (the web POS opens instead)
//   --web         also open the web POS in a browser window
// Close the window / Ctrl+C = stop everything this script started.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const PORT = 4000; // same port as the real server, so the public link (cloudflared) shows the demo too
const PUBLIC_URL = 'https://quan.t160.men';
const PRINTER_PORT = 9100;
const local = `http://localhost:${PORT}`;
const serverDir = join(root, 'apps', 'server');
const dbPath = join(serverDir, 'data', 'demo.db');
const win = process.platform === 'win32';
const children = [];
let emulatorStarted = false;
let browserOpened = false;

const log = (s = '') => console.log(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portBusy = (port) =>
  new Promise((resolve) => {
    const s = createConnection({ port, host: '127.0.0.1' });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
  });

function run(name, cmd, cmdArgs, opts = {}) {
  const child = spawn(cmd, cmdArgs, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...opts });
  child.stdout?.on('data', (b) => opts.quiet || process.stdout.write(prefix(name, b)));
  child.stderr?.on('data', (b) => opts.quiet || process.stdout.write(prefix(name, b)));
  child.on('error', (e) => log(`[${name}] không chạy được: ${e.message}`));
  children.push(child);
  return child;
}
const prefix = (name, b) =>
  String(b)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => `[${name}] ${l}\n`)
    .join('');

let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  log('\nĐang tắt demo...');
  if (emulatorStarted) spawnSync(adb(), ['emu', 'kill'], { stdio: 'ignore' });
  // The POS/Boss windows run in their own browser profiles (shopflow-demo): close only those.
  if (win && browserOpened)
    spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*shopflow-demo*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { stdio: 'ignore' });
  for (const c of children) {
    if (c.exitCode !== null || !c.pid) continue;
    if (win) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGTERM');
  }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => (stopAll(), process.exit(0)));
process.on('exit', stopAll);

// ---------------------------------------------------------------- browser windows
function findBrowser() {
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const la = process.env.LOCALAPPDATA ?? '';
  return [
    join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(la, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].find((p) => existsSync(p));
}

function openWindow(url, { width, height, x, y, profile, maximized = false }) {
  const browser = findBrowser();
  if (!browser) {
    // No Chrome/Edge: default browser, normal tab.
    if (win) spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    return;
  }
  // Separate profile per window: own size/position and own login (POS cashier vs Boss owner).
  browserOpened = true;
  const dir = join(tmpdir(), 'shopflow-demo', profile);
  mkdirSync(dir, { recursive: true });
  spawn(browser, [`--app=${url}`, `--user-data-dir=${dir}`, `--window-size=${width},${height}`, `--window-position=${x},${y}`, ...(maximized ? ['--start-maximized'] : []), '--no-first-run', '--no-default-browser-check'], {
    stdio: 'ignore',
    detached: true,
  }).unref();
}

// ---------------------------------------------------------------- Android emulator (optional)
const sdk = process.env.ANDROID_HOME ?? (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : '');
const adb = () => join(sdk, 'platform-tools', win ? 'adb.exe' : 'adb');
const emulatorBin = () => join(sdk, 'emulator', win ? 'emulator.exe' : 'emulator');

async function startAndroid() {
  if (!sdk || !existsSync(emulatorBin()) || !existsSync(adb())) {
    log('  (Không có Android SDK: bỏ qua máy ảo Android, demo trên trình duyệt vẫn đủ.)');
    return;
  }
  const avds = spawnSync(emulatorBin(), ['-list-avds'], { encoding: 'utf8' }).stdout.split(/\r?\n/).filter(Boolean);
  const avd = avds.includes('medium_tablet') ? 'medium_tablet' : avds[0];
  if (!avd) return log('  (Chưa tạo máy ảo Android nào: bỏ qua.)');
  const running = spawnSync(adb(), ['devices'], { encoding: 'utf8' }).stdout.includes('emulator-');
  if (!running) {
    // Cold boot: a restored snapshot keeps the clock from the snapshot (sales would get the wrong time).
    run('android', emulatorBin(), ['-avd', avd, '-no-snapshot-load', '-no-boot-anim'], { quiet: true });
    emulatorStarted = true;
    log(`  Máy ảo Android "${avd}" đang khởi động (khoảng 1 phút)...`);
  } else log('  Máy ảo Android đang chạy sẵn, dùng luôn.');
  await new Promise((r) => spawn(adb(), ['wait-for-device'], { stdio: 'ignore' }).on('exit', r).on('error', r));
  for (let i = 0; i < 90; i++) {
    if (spawnSync(adb(), ['shell', 'getprop', 'sys.boot_completed'], { encoding: 'utf8' }).stdout.trim() === '1') break;
    await sleep(2000);
  }
  // Install the freshly built APKs if present, then open the POS app.
  for (const app of ['pos', 'boss']) {
    const apk = join(root, 'apps', app, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
    if (existsSync(apk)) spawnSync(adb(), ['install', '-r', apk], { stdio: 'ignore' });
  }
  spawnSync(adb(), ['reverse', `tcp:${PORT}`, `tcp:${PORT}`], { stdio: 'ignore' });
  // Restart the app so it reconnects to the fresh demo server (an already-open app may sit "offline").
  spawnSync(adb(), ['shell', 'am', 'force-stop', 'vn.shopflow.pos'], { stdio: 'ignore' });
  spawnSync(adb(), ['shell', 'monkey', '-p', 'vn.shopflow.pos', '-c', 'android.intent.category.LAUNCHER', '1'], { stdio: 'ignore' });
  log('  Máy ảo Android sẵn sàng: đã mở app ShopFlow POS.');
  log(`  (Lần đầu: Cài đặt máy chủ = http://localhost:${PORT} hoặc ${PUBLIC_URL})`);
}

// ---------------------------------------------------------------- main
log('==============================================================');
log('  SHOPFLOW DEMO  ·  dữ liệu MẪU riêng, không đụng sổ sách thật');
log('==============================================================');

if (await portBusy(PORT)) {
  log(`\n[!] Cổng ${PORT} đang bận: ShopFlow THẬT (Mo ShopFlow.cmd) hoặc một demo khác đang chạy.`);
  log('    Đóng cửa sổ đó rồi mở lại demo.');
  process.exit(1);
}

if (!existsSync(join(root, 'apps', 'pos', 'dist', 'index.html')) || !existsSync(join(root, 'apps', 'boss', 'dist', 'index.html'))) {
  log('Chưa có bản dựng POS/Boss, đang dựng (chỉ lần đầu)...');
  const b = spawnSync(win ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: win });
  if (b.status !== 0) process.exit(1);
}

if (!args.has('--keep')) {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true });
  log('Tạo dữ liệu demo mới (14 ngày bán hàng mẫu, hôm nay bắt đầu từ 0đ)...');
}

// No --env-file: the demo must not pick up the shop's real settings (push keys, API key...).
run('máy chủ', process.execPath, ['src/index.ts'], {
  cwd: serverDir,
  env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, SEED: '1', SEED_DEMO_SALES: '1', SHOPFLOW_API_KEY: '', FCM_SERVICE_ACCOUNT: '' },
});
run('máy in ảo', process.execPath, [join('scripts', 'virtual-printer.cjs'), String(PRINTER_PORT)]);

let ok = false;
for (let i = 0; i < 60 && !ok; i++) {
  await sleep(500);
  ok = await fetch(`${local}/api/health`).then((r) => r.ok).catch(() => false);
}
if (!ok) {
  log('[!] Máy chủ không khởi động được, xem lỗi phía trên.');
  process.exit(1);
}
const publicOk = await fetch(`${PUBLIC_URL}/api/health`, { signal: AbortSignal.timeout(8000) })
  .then((r) => r.ok)
  .catch(() => false);

// The POS shown on the laptop is the Android POS app in the emulator (like a real POS device);
// the web POS opens only with --web or when there is no Android SDK. Boss = presenter's own phone.
const hasAndroid = Boolean(sdk) && existsSync(emulatorBin()) && existsSync(adb()) && !args.has('--no-android');
if (args.has('--web') || !hasAndroid) {
  openWindow(`${local}/pos/`, { width: 1280, height: 800, x: 0, y: 0, profile: 'pos', maximized: true });
}

log('');
log('==============================================================');
log('  ĐÃ CHẠY. Giữ cửa sổ này mở trong lúc demo; ĐÓNG = TẮT HẾT.');
log('--------------------------------------------------------------');
log(hasAndroid ? '  POS  (laptop):           app ShopFlow POS trên máy ảo Android' : `  POS  (laptop):           ${local}/pos/`);
log(
  publicOk
    ? `  Boss (ĐIỆN THOẠI của bạn): ${PUBLIC_URL}/boss/`
    : `  [!] Link ${PUBLIC_URL} chưa vào được: kiểm tra dịch vụ cloudflared / mạng.\n      Tạm thời dùng điện thoại chung wifi: http://<IP laptop>:${PORT}/boss/ (IP ở dòng "LAN:" phía trên)`,
);
log(`  Máy in ảo: cổng ${PRINTER_PORT}, hoá đơn lưu ở output/virtual-printer/`);
log('--------------------------------------------------------------');
log('  Tài khoản MẪU:');
log('    POS : Kim (thu ngân) PIN 1111 · Minh PIN 2222 · Hiền (chủ) PIN 3333');
log('    Boss: chu / chu123456');
log('  Kịch bản: bán 1 đơn trên POS -> doanh thu nhảy ngay trên Boss.');
log('==============================================================');
log('');

if (!args.has('--no-android')) await startAndroid();
