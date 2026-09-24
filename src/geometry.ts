export type Point = { x: number; y: number };
export type Area = Point & { width: number; height: number };
export function safePosition(
  saved: Point | null,
  size: { width: number; height: number },
  areas: Area[],
): Point {
  const area =
    areas.find(
      (a) =>
        saved &&
        saved.x >= a.x &&
        saved.x < a.x + a.width &&
        saved.y >= a.y &&
        saved.y < a.y + a.height,
    ) ?? areas[0];
  if (!area) return { x: 24, y: 24 };
  const clamp = (n: number, min: number, max: number) =>
    Math.max(min, Math.min(n, Math.max(min, max)));
  return {
    x: clamp(
      saved?.x ?? area.x + area.width - size.width - 24,
      area.x,
      area.x + area.width - size.width,
    ),
    y: clamp(saved?.y ?? area.y + 24, area.y, area.y + area.height - size.height),
  };
}
