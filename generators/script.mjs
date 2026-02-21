/**
 * Generate segment script text from event type + data (Claude or Gemini).
 */

import { priceAlertPrompt, convictionUpdatePrompt, marketRecapPrompt } from '../templates/price-alert.mjs';

const TEMPLATES = {
  'price-alert': priceAlertPrompt,
  'conviction-update': convictionUpdatePrompt,
  'market-recap': marketRecapPrompt,
};

/**
 * Generate a segment script from event data.
 * Returns { script: string, wordCount: number, estimatedDurationSec: number }
 */
export async function generateScript(eventType, eventData) {
  const templateFn = TEMPLATES[eventType];
  if (!templateFn) throw new Error(`Unknown event type: ${eventType}`);

  const prompt = templateFn(eventData);

  if (process.env.ANTHROPIC_API_KEY) {
    return await generateWithClaude(prompt);
  }
  if (process.env.GEMINI_API_KEY) {
    return await generateWithGemini(prompt);
  }
  throw new Error('Set ANTHROPIC_API_KEY or GEMINI_API_KEY.');
}

async function generateWithClaude(prompt) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });
  return formatResult(message.content[0].text.trim());
}

async function generateWithGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  const models = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'];

  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 500, temperature: 0.7 }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return formatResult(text);
      }

      if (response.status === 429) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
        continue;
      }
      break;
    }
  }

  throw new Error('All Gemini models exhausted');
}

function formatResult(script) {
  const wordCount = script.split(/\s+/).length;
  const estimatedDurationSec = Math.round(wordCount / 2.7);
  return { script, wordCount, estimatedDurationSec };
}
