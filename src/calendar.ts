export function millisecondsUntilMidnight(now: Date): number {
  return (
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime() + 50
  );
}
export function lessonCount(n: number): string {
  const mod = n % 100;
  return `${n} ${mod >= 11 && mod <= 14 ? 'уроков' : n % 10 === 1 ? 'урок' : n % 10 >= 2 && n % 10 <= 4 ? 'урока' : 'уроков'}`;
}
export const dateKey = (date: Date) => date.toDateString();
