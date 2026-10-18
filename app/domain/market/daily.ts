/** UTC daily sample key, shared by every client. */
export function dailySeed(date = new Date()): string {
  return `daily-${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

/**
 * Anchor the scenario calendar to the seed date so the same daily key produces
 * the same sample on every device and in every timezone.
 */
export function dailyScenarioNow(seed: string): Date {
  const match = /^daily-(\d{4})-(\d{2})-(\d{2})$/.exec(seed)
  if (!match) return new Date()
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
}
