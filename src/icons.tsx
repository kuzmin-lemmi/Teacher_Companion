/** Линейные значки 24×24 в стиле Tabler; рисуются встроенным SVG, внешних шрифтов не нужно. */
const paths = {
  back: 'M5 12h14M5 12l6 6M5 12l6-6',
  table: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M10 3v18',
  bell: 'M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6M9 17v1a3 3 0 0 0 6 0v-1',
  beach:
    'M17.553 16.75a7.5 7.5 0 0 0-10.606 0M3 21h18M12 8V4m-5.5 7.5l-2-2M17.5 11.5l2-2M12 12a4 4 0 0 0-4 4h8a4 4 0 0 0-4-4z',
  palette:
    'M12 21a9 9 0 0 1 0-18c4.97 0 9 3.582 9 8c0 1.06-.474 2.078-1.318 2.828c-.844.75-1.989 1.172-3.182 1.172h-2.5a2 2 0 0 0-1 3.75a1.3 1.3 0 0 1-1 2.25M8.5 10.5h.01M12.5 7.5h.01M16.5 10.5h.01',
  database: 'M4 6a8 3 0 1 0 16 0a8 3 0 1 0-16 0M4 6v6a8 3 0 0 0 16 0V6M4 12v6a8 3 0 0 0 16 0v-6',
  info: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 9h.01M11 12h1v4h1',
  copy: 'M8 9.667A1.667 1.667 0 0 1 9.667 8h8.666A1.667 1.667 0 0 1 20 9.667v8.666A1.667 1.667 0 0 1 18.333 20H9.667A1.667 1.667 0 0 1 8 18.333zM16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2',
  clock: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 3',
  x: 'M18 6L6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
