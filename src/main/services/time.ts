export function nowIso(): string {
  return new Date().toISOString();
}

export function clampNumber(value: unknown, fallback: number, min: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(min, Math.floor(value));
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(min, Math.floor(parsed));
    }
  }
  return fallback;
}

export function splitScopes(value: string | string[] | undefined, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((scope) => scope.trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
  }
  return fallback;
}
