// Установщик для Windows 7 и 8.1: node scripts/build-win7.mjs [ещё параметры tauri build]
// Rust перестал поддерживать «семёрку» в обычной цели x86_64-pc-windows-msvc, поэтому собираем
// nightly-цель x86_64-win7-windows-msvc вместе со стандартной библиотекой (-Zbuild-std),
// а WebView2 109 — последний для Windows 7 — кладём внутрь установщика.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

const TARGET = 'x86_64-win7-windows-msvc';
execFileSync('node', ['scripts/webview2-win7.mjs', 'x64'], { stdio: 'inherit' });

// Цель третьего уровня не значится в `rustup target list`, и tauri build отказывается её
// собирать, пока видит rustup. Поэтому прячем rustup из PATH и даём cargo и rustc nightly
// напрямую — без rustup tauri проверку пропускает.
const rustupHome = process.env.RUSTUP_HOME ?? join(homedir(), '.rustup');
const toolchain = readdirSync(join(rustupHome, 'toolchains')).find((name) =>
  name.startsWith('nightly-'),
);
if (!toolchain) {
  console.error('Нет nightly Rust: rustup toolchain install nightly --component rust-src');
  process.exit(1);
}
const bin = join(rustupHome, 'toolchains', toolchain, 'bin');
const path = (process.env.PATH ?? '')
  .split(delimiter)
  .filter((dir) => !existsSync(join(dir, 'rustup.exe')) && !existsSync(join(dir, 'rustup')));

// Заплатка для ctor подключается только здесь; Cargo.lock после сборки возвращаем как был,
// чтобы обычная сборка для Windows 10 и 11 её не видела.
const lock = 'src-tauri/Cargo.lock';
const lockBefore = readFileSync(lock);
try {
  execFileSync(
    'npx',
    [
      'tauri',
      'build',
      '--target',
      TARGET,
      '--config',
      'src-tauri/tauri.win7.conf.json',
      ...process.argv.slice(2),
      '--',
      '-Zbuild-std=std,panic_abort',
      '--config',
      'patches/win7.toml',
    ],
    {
      stdio: 'inherit',
      shell: true,
      // tauri встраивает только vcruntime, а Universal CRT оставляет внешней — на Windows 7 без
      // KB2999226 её нет. Отключаем это, и crt-static из patches/win7.toml встраивает всю CRT.
      env: { ...process.env, PATH: [bin, ...path].join(delimiter), STATIC_VCRUNTIME: 'false' },
    },
  );
} finally {
  writeFileSync(lock, lockBefore);
}
