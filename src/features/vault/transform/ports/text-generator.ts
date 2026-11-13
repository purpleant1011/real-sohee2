export interface TextGeneratorOptions {
  temperature?: number;
  responseMimeType?: 'application/json' | 'text/plain';
}

export interface TextGenerator {
  generateText(prompt: string, options?: TextGeneratorOptions): Promise<string>;
}
