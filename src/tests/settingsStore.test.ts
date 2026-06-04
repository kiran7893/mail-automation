import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeSettings } from '../main/services/settingsStore';

describe('normalizeSettings OpenRouter handling', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses current OpenRouter env values when persisted OpenAI settings are stale defaults', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-or-v1-test');
    vi.stubEnv('OPENAI_BASE_URL', 'https://api.openai.com/v1');
    vi.stubEnv('OPENAI_MODEL', 'openrouter/owl-alpha');

    const settings = normalizeSettings({
      openai: {
        apiKey: '',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.5',
      },
    });

    expect(settings.openai.apiKey).toBe('sk-or-v1-test');
    expect(settings.openai.model).toBe('openrouter/owl-alpha');
    expect(settings.openai.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('does not send OpenRouter credentials to the OpenAI base URL', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('OPENAI_BASE_URL', 'https://api.openai.com/v1');
    vi.stubEnv('OPENAI_MODEL', 'gpt-5.5');

    const settings = normalizeSettings({
      openai: {
        apiKey: 'sk-or-v1-local',
        baseUrl: 'https://api.openai.com/v1',
        model: 'openrouter/owl-alpha',
      },
    });

    expect(settings.openai.baseUrl).toBe('https://openrouter.ai/api/v1');
  });
});
