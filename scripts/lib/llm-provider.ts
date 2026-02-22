/**
 * Pluggable LLM provider interface with Ollama implementation.
 *
 * Usage:
 *   const llm = new OllamaProvider({ model: 'qwen3:14b' });
 *   await llm.healthCheck();
 *   const html = await llm.generate(prompt);
 */

export interface LLMGenerateOptions {
  temperature?: number;
  maxTokens?: number;
  /** System prompt prepended to the conversation */
  system?: string;
  /** Called with each token chunk as it streams in */
  onToken?: (token: string) => void;
}

export interface LLMProvider {
  generate(prompt: string, options?: LLMGenerateOptions): Promise<string>;
  healthCheck(): Promise<void>;
}

export interface OllamaConfig {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * Context window size in tokens. Lower = less RAM.
   * Default 4096 is conservative. With qwen3:14b on 32GB M1, you can safely
   * increase to 8192 or higher if needed for batch product context.
   */
  numCtx?: number;
}

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;
  private maxRetries: number;
  private numCtx: number;

  constructor(config: OllamaConfig = {}) {
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
    this.model = config.model || 'qwen3:14b';
    this.timeoutMs = config.timeoutMs || 180_000;
    this.maxRetries = config.maxRetries || 3;
    this.numCtx = config.numCtx || 4096;
  }

  async healthCheck(): Promise<void> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!resp.ok) {
        throw new Error(`Ollama returned ${resp.status}`);
      }
      const data = (await resp.json()) as { models?: Array<{ name: string }> };
      const models = data.models || [];
      const modelNames = models.map((m) => m.name.replace(/:latest$/, ''));

      if (!modelNames.some((n) => n === this.model || n.startsWith(this.model + ':'))) {
        const available = modelNames.join(', ') || '(none)';
        throw new Error(
          `Model "${this.model}" not found. Available: ${available}\n` +
            `Pull it with: ollama pull ${this.model}`
        );
      }
      console.log(`✓ Ollama is running with model "${this.model}"`);
    } catch (err: any) {
      if (err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED') {
        throw new Error(
          'Ollama is not running. Start it with: ollama serve\n' +
            `Then pull the model: ollama pull ${this.model}`
        );
      }
      throw err;
    }
  }

  async generate(prompt: string, options: LLMGenerateOptions = {}): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this._doGenerate(prompt, options);
      } catch (err: any) {
        lastError = err;
        if (attempt < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10_000);
          console.warn(
            `  ⚠ LLM attempt ${attempt}/${this.maxRetries} failed: ${err.message}. Retrying in ${delay}ms...`
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw new Error(`LLM failed after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  private async _doGenerate(prompt: string, options: LLMGenerateOptions): Promise<string> {
    const useStreaming = !!options.onToken;

    const body: Record<string, any> = {
      model: this.model,
      prompt,
      stream: useStreaming,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens ?? 1024,
        num_ctx: this.numCtx,
      },
    };

    if (options.system) {
      body.system = options.system;
    }

    const resp = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Ollama API error ${resp.status}: ${text}`);
    }

    if (useStreaming) {
      return this._readStream(resp, options.onToken!);
    }

    const data = (await resp.json()) as { response?: string };
    if (!data.response) {
      throw new Error('Ollama returned empty response');
    }

    let result = data.response.trim();

    // Strip <think>...</think> reasoning blocks (qwen3 models output these)
    result = result.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();

    if (!result) {
      throw new Error('Ollama response was empty after stripping think tags');
    }

    return result;
  }

  private async _readStream(
    resp: Response,
    onToken: (token: string) => void
  ): Promise<string> {
    const reader = resp.body?.getReader();
    if (!reader) throw new Error('No response body for streaming');

    const decoder = new TextDecoder();
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      // Ollama streams newline-delimited JSON objects
      const lines = chunk.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const data = JSON.parse(line) as { response?: string; done?: boolean };
          if (data.response) {
            fullResponse += data.response;
            onToken(data.response);
          }
        } catch {
          // Skip malformed lines
        }
      }
    }

    if (!fullResponse) {
      throw new Error('Ollama returned empty response');
    }

    return fullResponse.trim();
  }
}
