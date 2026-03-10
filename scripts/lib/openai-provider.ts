/**
 * OpenAI API LLM Provider
 *
 * Implements the LLMProvider interface using the OpenAI Responses API.
 * Supports both reasoning models (gpt-5-nano) and standard models (gpt-4.1-nano).
 * For reasoning models, uses reasoning.effort=low for fast, cheap responses.
 * For standard models, uses temperature and standard parameters.
 *
 * Usage:
 *   const llm = new OpenAIProvider({ model: 'gpt-4.1-nano' });
 *   await llm.healthCheck();
 *   const html = await llm.generate(prompt, { system: '...', temperature: 0.7 });
 *
 * Requires OPENAI_API_KEY env var.
 */

import type { LLMProvider, LLMGenerateOptions, TokenUsage } from './llm-provider';

interface OpenAIResponsesApiResponse {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    output_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
}

/** Models that support reasoning.effort parameter */
const REASONING_MODELS = ['gpt-5-nano', 'gpt-5-mini', 'o4-mini', 'o3', 'o3-mini', 'o1', 'o1-mini', 'o1-preview'];

function isReasoningModel(model: string): boolean {
  return REASONING_MODELS.some((rm) => model.startsWith(rm));
}

export interface OpenAIConfig {
  model?: string;
  apiKey?: string;
  maxRetries?: number;
  timeoutMs?: number;
  /** Reasoning effort (only for reasoning models): 'minimal' | 'low' | 'medium' | 'high'. Default: 'low' */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
}

export class OpenAIProvider implements LLMProvider {
  private baseUrl = 'https://api.openai.com';
  private model: string;
  private apiKey: string;
  private maxRetries: number;
  private timeoutMs: number;
  private reasoningEffort: string;
  private isReasoning: boolean;
  private usage: TokenUsage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalCalls: 0 };

  constructor(config: OpenAIConfig = {}) {
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY is required. Set it as an env var or pass apiKey in config.'
      );
    }

    this.apiKey = apiKey;
    this.model = config.model || 'gpt-4.1-nano';
    this.maxRetries = config.maxRetries || 3;
    this.timeoutMs = config.timeoutMs || 120_000;
    this.reasoningEffort = config.reasoningEffort || 'low';
    this.isReasoning = isReasoningModel(this.model);
  }

  async healthCheck(): Promise<void> {
    try {
      const resp = await this._callResponsesApi('Reply with "ok"', {});
      const text = this._extractText(resp);
      if (!text) {
        throw new Error('Empty response from OpenAI API');
      }
      const extras = this.isReasoning ? `, reasoning: ${this.reasoningEffort}` : '';
      console.log(`✓ OpenAI API connected (model: ${this.model}${extras})`);
    } catch (err: any) {
      if (err.message?.includes('401')) {
        throw new Error('Invalid OPENAI_API_KEY. Check your API key.');
      }
      if (err.message?.includes('404')) {
        throw new Error(`Model "${this.model}" not found. Check the model ID.`);
      }
      throw new Error(`OpenAI API health check failed: ${err.message}`);
    }
  }

  async generate(
    prompt: string,
    options: LLMGenerateOptions = {}
  ): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const resp = await this._callResponsesApi(prompt, options);

        // Track usage
        if (resp.usage) {
          this.usage.inputTokens += resp.usage.input_tokens ?? 0;
          this.usage.outputTokens += resp.usage.output_tokens ?? 0;
          this.usage.reasoningTokens += resp.usage.output_tokens_details?.reasoning_tokens ?? 0;
          this.usage.totalCalls++;
        }

        const text = this._extractText(resp);
        if (!text) {
          throw new Error('OpenAI returned empty response');
        }

        return text;
      } catch (err: any) {
        lastError = err;

        // Don't retry on auth/model/validation errors
        if (/40[0-4]|422/.test(err.message)) throw err;

        if (attempt < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10_000);
          console.warn(
            `  ⚠ OpenAI attempt ${attempt}/${this.maxRetries} failed: ${err.message}. Retrying in ${delay}ms...`
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw new Error(
      `OpenAI failed after ${this.maxRetries} attempts: ${lastError?.message}`
    );
  }

  private async _callResponsesApi(
    prompt: string,
    options: LLMGenerateOptions
  ): Promise<OpenAIResponsesApiResponse> {
    const input: Array<Record<string, unknown>> = [];

    if (options.system) {
      input.push({
        role: 'system',
        content: [{ type: 'input_text', text: options.system }],
      });
    }

    input.push({
      role: 'user',
      content: [{ type: 'input_text', text: prompt }],
    });

    const body: Record<string, unknown> = {
      model: this.model,
      input,
    };

    if (this.isReasoning) {
      // Reasoning models: use reasoning.effort, enforce min token headroom
      body.max_output_tokens = Math.max(options.maxTokens ?? 1024, 1024);
      body.reasoning = { effort: this.reasoningEffort };
      // Reasoning models don't support temperature
    } else {
      // Standard models: use temperature and exact max_output_tokens
      body.max_output_tokens = options.maxTokens ?? 1024;
      if (options.temperature !== undefined) {
        body.temperature = options.temperature;
      }
    }

    const resp = await fetch(`${this.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`OpenAI API error ${resp.status}: ${text}`);
    }

    return (await resp.json()) as OpenAIResponsesApiResponse;
  }

  private _extractText(data: OpenAIResponsesApiResponse): string {
    // Try direct output_text first
    const direct = (data.output_text || '').trim();
    if (direct) return direct;

    // Fall back to parsing output array
    const parts: string[] = [];
    for (const item of data.output || []) {
      for (const c of item.content || []) {
        if (c.type === 'output_text' && c.text) {
          parts.push(c.text);
        }
      }
    }
    return parts.join('\n').trim();
  }

  getModel(): string {
    return this.model;
  }

  getUsage(): TokenUsage {
    return { ...this.usage };
  }

  resetUsage(): void {
    this.usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalCalls: 0 };
  }
}
