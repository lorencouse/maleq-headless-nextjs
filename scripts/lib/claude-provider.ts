/**
 * Claude API LLM Provider
 *
 * Implements the LLMProvider interface using the Anthropic SDK.
 *
 * Usage:
 *   const llm = new ClaudeProvider({ model: 'claude-haiku-4-5-20251001' });
 *   await llm.healthCheck();
 *   const html = await llm.generate(prompt, { system: '...', temperature: 0.7 });
 *
 * Requires ANTHROPIC_API_KEY env var.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMGenerateOptions, TokenUsage } from './llm-provider';

export interface ClaudeConfig {
  model?: string;
  apiKey?: string;
  maxRetries?: number;
  timeoutMs?: number;
}

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;
  private maxRetries: number;
  private timeoutMs: number;
  private usage: TokenUsage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalCalls: 0 };

  constructor(config: ClaudeConfig = {}) {
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is required. Set it as an env var or pass apiKey in config.'
      );
    }

    this.client = new Anthropic({ apiKey });
    this.model = config.model || 'claude-haiku-4-5-20251001';
    this.maxRetries = config.maxRetries || 3;
    this.timeoutMs = config.timeoutMs || 60_000;
  }

  async healthCheck(): Promise<void> {
    try {
      const resp = await this.client.messages.create({
        model: this.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Reply with "ok"' }],
      });
      const text =
        resp.content[0]?.type === 'text' ? resp.content[0].text : '';
      if (!text) {
        throw new Error('Empty response from Claude API');
      }
      console.log(`✓ Claude API connected (model: ${this.model})`);
    } catch (err: any) {
      if (err.status === 401) {
        throw new Error('Invalid ANTHROPIC_API_KEY. Check your API key.');
      }
      if (err.status === 404) {
        throw new Error(
          `Model "${this.model}" not found. Check the model ID.`
        );
      }
      throw new Error(`Claude API health check failed: ${err.message}`);
    }
  }

  async generate(
    prompt: string,
    options: LLMGenerateOptions = {}
  ): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const resp = await this.client.messages.create({
          model: this.model,
          max_tokens: options.maxTokens ?? 1024,
          temperature: options.temperature ?? 0.7,
          system: options.system || undefined,
          messages: [{ role: 'user', content: prompt }],
        });

        // Track usage
        if (resp.usage) {
          this.usage.inputTokens += resp.usage.input_tokens;
          this.usage.outputTokens += resp.usage.output_tokens;
          this.usage.totalCalls++;
        }

        const text =
          resp.content[0]?.type === 'text' ? resp.content[0].text : '';
        if (!text) {
          throw new Error('Claude returned empty response');
        }

        return text.trim();
      } catch (err: any) {
        lastError = err;

        // Don't retry on auth/model errors
        if (err.status === 401 || err.status === 404) throw err;

        if (attempt < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10_000);
          console.warn(
            `  ⚠ Claude attempt ${attempt}/${this.maxRetries} failed: ${err.message}. Retrying in ${delay}ms...`
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw new Error(
      `Claude failed after ${this.maxRetries} attempts: ${lastError?.message}`
    );
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
