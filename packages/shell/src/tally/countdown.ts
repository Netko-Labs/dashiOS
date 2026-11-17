/** A countdown's words: "3:12", "0:00", "1:02:05"; never below zero. */
export function countdownText(until: number, now: number): string {
  const total = Math.max(0, Math.ceil((until - now) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** The item's words as the bar and Glance say them: its label, and the time left when it counts down. */
export function onAirWords(item: { label: string; countdown?: number }, now: number): string {
  return item.countdown === undefined ? item.label : `${item.label} ${countdownText(item.countdown, now)}`;
}
