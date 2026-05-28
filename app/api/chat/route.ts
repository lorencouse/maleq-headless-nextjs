import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import { buildSystemPrompt } from '@/lib/chatbot/knowledge';
import { chatbotTools, executeTool } from '@/lib/chatbot/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MESSAGES = 30;
const MAX_CONTENT_LENGTH = 2000;
const MAX_TOOL_ITERATIONS = 4;
const KEEPALIVE_INTERVAL_MS = 15_000;

type ChatRole = 'user' | 'assistant';
type ChatMessage = { role: ChatRole; content: string };

function isValidMessage(m: unknown): m is ChatMessage {
  if (!m || typeof m !== 'object') return false;
  const msg = m as Record<string, unknown>;
  return (
    (msg.role === 'user' || msg.role === 'assistant') &&
    typeof msg.content === 'string' &&
    msg.content.length > 0 &&
    msg.content.length <= MAX_CONTENT_LENGTH
  );
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Plain-text body intentionally — the widget echoes `await res.text()`
    // into the assistant bubble and renderContent parses the `[label](/path)`
    // markdown into a clickable Link to /contact.
    return new Response(
      'Chat is offline. Please [contact us via email](/contact).',
      { status: 503 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return new Response('Invalid JSON.', { status: 400 });
  }

  const body = payload as { messages?: unknown };
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response('No messages.', { status: 400 });
  }

  const clientMessages = body.messages.slice(-MAX_MESSAGES).filter(isValidMessage);
  if (clientMessages.length === 0 || clientMessages[clientMessages.length - 1].role !== 'user') {
    return new Response('Last message must be from the user.', { status: 400 });
  }

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const responseBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writeEvent = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const writeComment = (text: string) => {
        controller.enqueue(encoder.encode(`: ${text}\n\n`));
      };

      // Flush headers immediately and signal we're alive (helps with proxies
      // that try to detect content-length up front).
      writeComment('ok');

      // Keep the connection alive during tool execution / model pauses so
      // Cloudflare / Traefik don't terminate an idle stream.
      const keepalive = setInterval(() => {
        try {
          writeComment('keepalive');
        } catch {
          // controller might be closed
        }
      }, KEEPALIVE_INTERVAL_MS);

      const messages: Anthropic.MessageParam[] = clientMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let activeStream: ReturnType<typeof client.messages.stream> | null = null;

      try {
        for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
          activeStream = client.messages.stream({
            model: 'claude-opus-4-7',
            max_tokens: 1024,
            system: [
              {
                type: 'text',
                text: buildSystemPrompt(),
                cache_control: { type: 'ephemeral', ttl: '1h' },
              },
            ],
            output_config: { effort: 'low' },
            tools: chatbotTools,
            messages,
          });

          activeStream.on('text', (delta: string) => {
            writeEvent({ type: 'delta', text: delta });
          });

          const message = await activeStream.finalMessage();
          activeStream = null;

          if (message.stop_reason !== 'tool_use') break;

          const toolUses = message.content.filter(
            (b: Anthropic.ContentBlock): b is Anthropic.ToolUseBlock =>
              b.type === 'tool_use'
          );

          if (toolUses.length === 0) break;

          messages.push({ role: 'assistant', content: message.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            const result = await executeTool(tu.name, tu.input);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: result.content,
              is_error: result.isError,
            });
          }

          messages.push({ role: 'user', content: toolResults });
        }

        writeEvent({ type: 'done' });
      } catch (err) {
        const status =
          err instanceof Anthropic.APIError ? err.status ?? null : null;
        const message =
          err instanceof Anthropic.APIError
            ? `Service error${status ? ` (${status})` : ''}. Please try again.`
            : 'Stream interrupted. Please try again.';
        writeEvent({ type: 'error', message });
        console.error('[chatbot] stream error:', err);
      } finally {
        clearInterval(keepalive);
        controller.close();
      }
    },
  });

  return new Response(responseBody, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // nginx-specific; harmless under Traefik. Kept for portability if anything
      // ever proxies this route through nginx.
      'X-Accel-Buffering': 'no',
    },
  });
}
