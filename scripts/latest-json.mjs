// Манифест для встроенного обновления: node scripts/latest-json.mjs <tag> <файл .sig> <выходной файл>
// Программа читает его по адресу releases/latest/download/latest.json и сверяет подпись установщика.
import { readFileSync, writeFileSync } from 'node:fs';
const [tag, sigFile, out] = process.argv.slice(2);
if (!tag || !sigFile || !out) {
  console.error('Использование: node scripts/latest-json.mjs <tag> <sig> <out>');
  process.exit(1);
}
const repo = 'https://github.com/kuzmin-lemmi/Teacher_Companion';
const md = readFileSync(`docs/releases/${tag}.md`, 'utf8');
// Короткий список «Что нового» простым текстом — его учитель увидит в разделе «О программе».
const section = md.split(/^## Что нового\s*$/m)[1]?.split(/^## /m)[0] ?? '';
const notes = section
  .split('\n')
  .filter((line) => line.startsWith('- '))
  .map((line) =>
    line
      .replace(/^- /, '• ')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .replace(/`(.+?)`/g, '$1'),
  )
  .join('\n');
const manifest = {
  version: tag.replace(/^v/, ''),
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: readFileSync(sigFile, 'utf8').trim(),
      url: `${repo}/releases/download/${tag}/TeacherCompanion-Setup.exe`,
    },
  },
};
writeFileSync(out, JSON.stringify(manifest, null, 2));
console.log(manifest.notes || '(нет пунктов «Что нового»)');
