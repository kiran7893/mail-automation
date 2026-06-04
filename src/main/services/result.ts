import type { ErrorResult, OkResult } from '../../shared/types';

export async function invokeResult<T extends object>(
  work: () => Promise<T>,
): Promise<(T & OkResult) | ErrorResult> {
  try {
    const result = await work();
    return { ok: true, ...result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
