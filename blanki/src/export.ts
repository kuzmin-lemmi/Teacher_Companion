import { toBlob } from 'html-to-image';
import { zipSync } from 'fflate';

/** Узел страницы → PNG. Масштаб 2 — чтобы в чате на телефоне было чётко. */
export async function nodeToPng(node: HTMLElement, pixelRatio = 2): Promise<Blob> {
  const blob = await toBlob(node, { pixelRatio, backgroundColor: '#ffffff', skipFonts: true });
  if (!blob) throw new Error('Не получилось сделать картинку');
  return blob;
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function copyImage(blob: Blob) {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
}

export async function zip(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = new Uint8Array(await f.blob.arrayBuffer());
  return new Blob([zipSync(entries, { level: 0 })], { type: 'application/zip' });
}

export const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-');

/** Ориентация листа для печати задаётся правилом @page — подменяем его перед печатью. */
export function setPageOrientation(orient: 'portrait' | 'landscape') {
  let el = document.getElementById('page-size') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'page-size';
    document.head.appendChild(el);
  }
  el.textContent = `@page { size: A4 ${orient}; margin: 8mm; }`;
}

export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
};
