// WebView2 109 — последняя версия для Windows 7 и 8.1. Кладёт её в src-tauri/webview2-109,
// откуда установщик для Windows 7 забирает её целиком: node scripts/webview2-win7.mjs <x64|x86>
// Microsoft больше не раздаёт эту версию на своём сайте, поэтому берём её из пакета NuGet;
// все файлы в нём подписаны Microsoft (и widevinecdm.dll — Google, как в самом Edge).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const VERSION = '109.0.1518.78';
const arch = process.argv[2];
if (arch !== 'x64' && arch !== 'x86') {
  console.error('Использование: node scripts/webview2-win7.mjs <x64|x86>');
  process.exit(1);
}
const out = 'src-tauri/webview2-109';
const stamp = join(out, '.arch');
if (existsSync(stamp) && readFileSync(stamp, 'utf8') === arch) {
  console.log(`WebView2 ${VERSION} (${arch}) уже лежит в ${out}`);
  process.exit(0);
}
const url = `https://api.nuget.org/v3-flatcontainer/webview2.runtime.${arch}/${VERSION}/webview2.runtime.${arch}.${VERSION}.nupkg`;
// Распаковываем рядом и переносим папку целиком: cpSync и rmSync в Node 24 молча ничего
// не делают, если в пути есть кириллица, поэтому здесь rename и асинхронный rm.
const tmp = 'src-tauri/webview2-download';
await rm(tmp, { recursive: true, force: true });
mkdirSync(tmp);
const pkg = join(tmp, 'runtime.nupkg');
console.log(`Скачиваю ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`NuGet ответил ${res.status}`);
writeFileSync(pkg, Buffer.from(await res.arrayBuffer()));
// Пакет NuGet — это zip. Его умеет распаковывать tar из Windows (bsdtar), а не tar из Git Bash.
const tar =
  process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
execFileSync(tar, ['-xf', 'runtime.nupkg'], { cwd: tmp, stdio: 'inherit' });
await rm(out, { recursive: true, force: true });
renameSync(join(tmp, 'contentFiles/any/any/WebView2'), out);
writeFileSync(stamp, arch);
await rm(tmp, { recursive: true, force: true });
console.log(`WebView2 ${VERSION} (${arch}) → ${out}`);
