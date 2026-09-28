import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import qrcode from 'qrcode-generator';
import { useBackButton } from './back';
import type { AppData } from './domain';
import { QR_CAPACITY, decodeTransfer, encodeTransfer } from './transfer';
/** Чёрное на белом при любой теме: иначе камера телефона код не прочитает. */
function QrImage({ text }: { text: string }) {
  const path = useMemo(() => {
    // Код читают с экрана, а не с мятой бумаги: минимальной коррекции ошибок хватает,
    // и модули получаются крупнее — камера телефона ловит код быстрее.
    const qr = qrcode(0, 'L');
    qr.addData(text, 'Alphanumeric');
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4},${r + 4}h1v1h-1z`;
    return { d, size: n + 8 };
  }, [text]);
  return (
    <svg
      className="qr-image"
      viewBox={`0 0 ${path.size} ${path.size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR-код с расписанием"
    >
      <rect width={path.size} height={path.size} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}
/** Компьютер: показать QR-код, который сканирует телефон. */
export function ShowTransferCode({ data }: { data: AppData }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCode(null);
    setError('');
    encodeTransfer(data)
      .then((text) => {
        if (cancelled) return;
        if (text.length > QR_CAPACITY)
          setError('Расписание слишком большое для одного QR-кода — перенесите его файлом копии.');
        else setCode(text);
      })
      .catch(() => !cancelled && setError('Не удалось подготовить QR-код.'));
    return () => {
      cancelled = true;
    };
  }, [open, data]);
  return (
    <section className="panel transfer">
      <p className="eyebrow">ПЕРЕНОС НА ТЕЛЕФОН</p>
      <h2>Расписание на Android за 10 секунд</h2>
      <p className="muted">
        На телефоне откройте «Помощник учителя» → «Перенести с компьютера» → «Сканировать QR-код» и
        наведите камеру на код. Уроки, звонки, каникулы, настройки и заметки с сегодняшнего дня
        появятся на телефоне.
      </p>
      {!open ? (
        <div className="backup-actions">
          <button className="primary" disabled={!data.lessons.length} onClick={() => setOpen(true)}>
            Показать QR-код
          </button>
        </div>
      ) : (
        <>
          {code && <QrImage text={code} />}
          {error && (
            <p role="alert" className="hint">
              {error}
            </p>
          )}
          <div className="backup-actions">
            <button onClick={() => setOpen(false)}>Скрыть QR-код</button>
          </div>
        </>
      )}
      {!data.lessons.length && <p className="hint">Сначала добавьте уроки.</p>}
    </section>
  );
}
function ScanOverlay({ onCancel }: { onCancel: () => void }) {
  useBackButton(true, onCancel);
  return createPortal(
    <div className="scan-overlay" role="dialog" aria-label="Сканирование QR-кода">
      <div className="scan-frame" />
      <p>Наведите камеру на QR-код на экране компьютера</p>
      <button onClick={onCancel}>Отмена</button>
    </div>,
    document.body,
  );
}
/** Телефон: сканировать QR-код с компьютера; результат уходит в обычный предпросмотр копии. */
export function ScanTransferCode({
  onScanned,
  disabled,
}: {
  onScanned: (data: AppData) => void;
  disabled?: boolean;
}) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  async function start() {
    setError('');
    const scanner = await import('@tauri-apps/plugin-barcode-scanner');
    try {
      let permission = await scanner.checkPermissions();
      if (permission !== 'granted') permission = await scanner.requestPermissions();
      if (permission !== 'granted') {
        setError(
          'Нет доступа к камере. Разрешите его: Настройки телефона → Приложения → Teacher Companion → Разрешения.',
        );
        return;
      }
      // Камера видна под прозрачной страницей; поверх — рамка и кнопка «Отмена».
      document.documentElement.classList.add('scanning');
      setScanning(true);
      const result = await scanner.scan({ windowed: true, formats: [scanner.Format.QRCode] });
      onScanned(await decodeTransfer(result.content));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(message)) setError(message || 'Не удалось прочитать QR-код.');
    } finally {
      document.documentElement.classList.remove('scanning');
      setScanning(false);
    }
  }
  async function cancel() {
    const scanner = await import('@tauri-apps/plugin-barcode-scanner');
    await scanner.cancel().catch(() => {});
  }
  return (
    <section className="panel transfer">
      <p className="eyebrow">ПЕРЕНОС С КОМПЬЮТЕРА</p>
      <h2>Сканируйте QR-код</h2>
      <p className="muted">
        На компьютере откройте «Помощник учителя» → ⚙ → «Резервные копии» → «Показать QR-код». Затем
        нажмите кнопку ниже и наведите камеру телефона на код.
      </p>
      <div className="backup-actions">
        <button className="primary" disabled={disabled || scanning} onClick={() => void start()}>
          Сканировать QR-код
        </button>
      </div>
      {error && (
        <p role="alert" className="hint">
          {error}
        </p>
      )}
      {scanning && <ScanOverlay onCancel={() => void cancel()} />}
    </section>
  );
}
