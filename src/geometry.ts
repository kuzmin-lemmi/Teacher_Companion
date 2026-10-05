import type { WidgetCorner } from './domain';
export type Point = { x: number; y: number };
export type Area = Point & { width: number; height: number };
export function cornerPosition(
  area: Area,
  size: { width: number; height: number },
  corner: WidgetCorner,
  margin = 16,
): Point {
  return {
    x: corner.endsWith('left') ? area.x + margin : area.x + area.width - size.width - margin,
    y: corner.startsWith('top') ? area.y + margin : area.y + area.height - size.height - margin,
  };
}
export function safePosition(
  saved: Point | null,
  size: { width: number; height: number },
  areas: Area[],
  corner: WidgetCorner = 'top-right',
  margin = 16,
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
  const target = saved ?? cornerPosition(area, size, corner, margin);
  return {
    x: clamp(target.x, area.x, area.x + area.width - size.width),
    y: clamp(target.y, area.y, area.y + area.height - size.height),
  };
}
/**
 * Размер окна настроек в логических пикселях: желаемый, но не больше 92% рабочей области
 * экрана (проектор с меньшим разрешением) и не меньше минимума, пока тот помещается на экран.
 */
export function fitSize(
  want: { width: number; height: number },
  work: { width: number; height: number },
  scale: number,
  min = { width: 640, height: 480 },
) {
  const fit = (value: number, area: number, least: number) => {
    const limit = Math.floor(area / scale);
    return Math.min(limit, Math.max(Math.min(value, Math.floor(limit * 0.92)), least));
  };
  return {
    width: fit(want.width, work.width, min.width),
    height: fit(want.height, work.height, min.height),
  };
}
