/**
 * Prompt templates for segment script generation.
 */

export function priceAlertPrompt({ token, price, change, timeframe, volume, mcap, context }) {
  return `You are a dry, precise analyst. Generate a brief market update segment script.

Data:
- Token: ${token}
- Current price: $${price}
- Price change: ${change > 0 ? '+' : ''}${change}% over ${timeframe}
- 24h volume: $${volume}
- Market cap: $${mcap}
${context ? `- Context: ${context}` : ''}

Rules:
- Under 120 words
- State the facts first, then ONE honest opinion
- End with a conviction assessment (BUY / HOLD / SELL / WATCH) with brief reasoning
- No greetings. Just start talking.
- Include the exact numbers.

Output ONLY the script text. No stage directions.`;
}

export function convictionUpdatePrompt({ token, oldSignal, newSignal, reasoning, data }) {
  return `You are a dry analyst. Generate a conviction signal change segment.

Data:
- Token: ${token}
- Previous signal: ${oldSignal}
- New signal: ${newSignal}
- Reasoning: ${reasoning}
- Supporting data: ${JSON.stringify(data)}

Rules:
- Under 150 words
- Explain WHY the signal changed
- Acknowledge if you were wrong before
- End with the new conviction level and confidence (0-1)

Output ONLY the script text.`;
}

export function marketRecapPrompt({ tokens, totalMcap, topMover, worstPerformer, timeframe }) {
  return `Generate a market recap segment.

Data:
- Timeframe: ${timeframe}
- Tokens tracked: ${JSON.stringify(tokens)}
- Total cohort market cap: $${totalMcap}
- Top mover: ${topMover}
- Worst performer: ${worstPerformer}

Rules:
- Under 200 words
- Hit every token briefly (1-2 sentences each)
- Identify the narrative thread
- End with overall assessment

Output ONLY the script text.`;
}
