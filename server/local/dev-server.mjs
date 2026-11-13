/**
 * Локальный сервер расписания для разработки — тот же код, что в Yandex Cloud Function (handler.mjs),
 * данные в папке на диске. Настоящую школу на облаке не трогает.
 *
 *   node server/local/dev-server.mjs [порт] [папка]       (по умолчанию 8787 и .dev-server-data)
 *
 * В «Бланках» включить: в консоли браузера  localStorage.setItem('blanki.server', '"http://127.0.0.1:8787"')
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { handle } from '../yandex/handler.mjs';

const port = Number(process.argv[2] ?? 8787);
const dir = process.argv[3] ?? '.dev-server-data';

const file = (key) => join(dir, ...key.split('/'));
const store = {
  async get(key) {
    return existsSync(file(key)) ? readFileSync(file(key), 'utf8') : null;
  },
  async put(key, text) {
    mkdirSync(dirname(file(key)), { recursive: true });
    writeFileSync(file(key), text);
  },
  async del(key) {
    rmSync(file(key), { force: true });
  },
};

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const r = await handle(
      {
        httpMethod: req.method,
        queryStringParameters: Object.fromEntries(url.searchParams),
        headers: req.headers,
        body: body || undefined,
      },
      store,
    ).catch((e) => ({ statusCode: 500, headers: {}, body: JSON.stringify({ error: String(e) }) }));
    res.writeHead(r.statusCode, r.headers);
    res.end(r.body);
    console.log(req.method, url.search, '→', r.statusCode);
  });
}).listen(port, '127.0.0.1', () =>
  console.log(`Сервер расписания для разработки: http://127.0.0.1:${port}  (данные: ${dir})`),
);
