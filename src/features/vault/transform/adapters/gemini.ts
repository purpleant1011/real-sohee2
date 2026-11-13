import { getGeminiApiBaseUrl, getTextApiKey } from '@/lib/ai/model-profiles';
import type {
  TextGenerator,
  TextGeneratorOptions,
} from '../ports/text-generator';

export interface GeminiAdapterConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
}

export class GeminiTextGenerator implements TextGenerator {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl?: string;
  private readonly fetcher: typeof fetch;

  constructor(config: GeminiAdapterConfig = {}) {
    this.apiKey = config.apiKey;
    this.model =
      config.model ??
      process.env.GEMINI_ACTION_MODEL?.trim() ??
      'gemini-3.8-flash';
    this.baseUrl = config.baseUrl;
    this.fetcher = config.fetcher ?? fetch;
  }

  async generateText(prompt: string, options: TextGeneratorOptions = {}): Promise<string> {
    const key = (this.apiKey ?? getTextApiKey() ?? '').trim();
    if (!key) {
      throw new Error('Gemini API key is missing. Set GEMINI_API_KEY environment variable.');
    }

    const base = this.baseUrl ?? getGeminiApiBaseUrl();
    const endpoint = `${base}/v1beta/models/${this.model}:generateContent?key=${key}`;

    const bodyPayload: Record<string, unknown> = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: options.responseMimeType ?? 'application/json',
        temperature: options.temperature ?? 0.7,
      },
    };

    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
    } catch (err: any) {
      throw new Error(`Gemini network failure: ${err?.message ?? String(err)}`);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Gemini API call failed with status ${response.status}: ${errText}`);
    }

    const data: any = await response.json().catch(() => null);
    const candidateText: unknown = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (typeof candidateText !== 'string' || !candidateText.trim()) {
      throw new Error('Gemini returned an empty response.');
    }

    return candidateText;
  }
}

export function createGeminiTextGenerator(config?: GeminiAdapterConfig): TextGenerator {
  return new GeminiTextGenerator(config);
}
