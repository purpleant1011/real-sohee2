import { describe, expect, it, vi } from 'vitest';
import { GeminiTextGenerator } from '../adapters/gemini';

describe('ANI-1538: GeminiTextGenerator (Adapter Tests)', () => {
  it('sends proper payload and returns candidate text on success', async () => {
    const mockFetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '{"threads":{"text":"스레드 카피"}}' }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const adapter = new GeminiTextGenerator({
      apiKey: 'test-api-key',
      baseUrl: 'https://example-gemini.internal',
      fetcher: mockFetcher as any,
    });

    const result = await adapter.generateText('프롬프트 내용', {
      temperature: 0.5,
      responseMimeType: 'application/json',
    });

    expect(result).toBe('{"threads":{"text":"스레드 카피"}}');
    expect(mockFetcher).toHaveBeenCalledTimes(1);

    const [callUrl, callOptions] = mockFetcher.mock.calls[0];
    expect(callUrl).toContain('https://example-gemini.internal');
    expect(callUrl).toContain('key=test-api-key');

    const body = JSON.parse(callOptions.body);
    expect(body.contents[0].parts[0].text).toBe('프롬프트 내용');
    expect(body.generationConfig.temperature).toBe(0.5);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('throws an error when API key is missing', async () => {
    const prevKey = process.env.GEMINI_API_KEY;
    const prevTextKey = process.env.GEMINI_TEXT_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_TEXT_API_KEY;

    try {
      const adapter = new GeminiTextGenerator({ apiKey: '' });
      await expect(adapter.generateText('테스트')).rejects.toThrow('Gemini API key is missing');
    } finally {
      if (prevKey) process.env.GEMINI_API_KEY = prevKey;
      if (prevTextKey) process.env.GEMINI_TEXT_API_KEY = prevTextKey;
    }
  });

  it('throws an error on HTTP error response', async () => {
    const mockFetcher = vi.fn().mockResolvedValue(
      new Response('Rate limit exceeded', { status: 429 })
    );

    const adapter = new GeminiTextGenerator({
      apiKey: 'test-api-key',
      fetcher: mockFetcher as any,
    });

    await expect(adapter.generateText('테스트')).rejects.toThrow(
      'Gemini API call failed with status 429'
    );
  });

  it('throws an error on empty response text', async () => {
    const mockFetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '   ' }],
              },
            },
          ],
        }),
        { status: 200 }
      )
    );

    const adapter = new GeminiTextGenerator({
      apiKey: 'test-api-key',
      fetcher: mockFetcher as any,
    });

    await expect(adapter.generateText('테스트')).rejects.toThrow(
      'Gemini returned an empty response'
    );
  });
});
