const YEAR_COLORS = ["blue", "pink", "mint", "yellow", "peach", "purple"] as const;

export function colorForYear(year: number): (typeof YEAR_COLORS)[number] {
  return YEAR_COLORS[Math.abs(year) % YEAR_COLORS.length];
}
