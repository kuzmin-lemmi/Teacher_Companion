// Версия приложения задаётся только в package.json; tauri.conf.json ссылается на него.
// Без аргументов проверяет, что Cargo.toml и Cargo.lock совпадают с ней; с --write — переписывает их.
import { readFileSync, writeFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const write = process.argv.includes('--write');
const files = {
  'src-tauri/Cargo.toml': /^(\[package\]\nname = "teacher-companion"\nversion = ")([^"]+)(")/m,
  'src-tauri/Cargo.lock': /^(name = "teacher-companion"\nversion = ")([^"]+)(")/m,
};
let failed = false;
for (const [file, pattern] of Object.entries(files)) {
  const text = readFileSync(file, 'utf8');
  const found = text.match(pattern)?.[2];
  if (!found) {
    console.error(`${file}: не найдена версия пакета teacher-companion`);
    failed = true;
  } else if (found !== version) {
    if (write) writeFileSync(file, text.replace(pattern, `$1${version}$3`));
    else {
      console.error(
        `${file}: ${found}, а в package.json — ${version}. Запустите npm run version:sync`,
      );
      failed = true;
    }
  }
}
const tauri = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
if (tauri.version !== '../package.json') {
  console.error('src-tauri/tauri.conf.json: поле version должно ссылаться на ../package.json');
  failed = true;
}
if (failed) process.exit(1);
console.log(`Версия ${version} согласована`);
