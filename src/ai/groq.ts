import { env } from '../config/env.js';

interface ExtractedEntity {
    name: string;
    type: 'person' | 'company' | 'location' | 'commodity' | 'sector' | 'policy' | 'event';
    confidence: number;
    context?: string;
}

interface SentimentResult {
    sentiment: 'positive' | 'negative' | 'neutral';
    score: number;  // -1 to 1
    reasoning?: string;
}

interface AIAnalysisResult {
    entities: ExtractedEntity[];
    sentiment: SentimentResult;
    category?: string;
    summary?: string;
}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function analyzeArticle(
    title: string,
    excerpt: string | null
): Promise<AIAnalysisResult> {
    if (!env.GROQ_API_KEY) {
        console.warn('GROQ_API_KEY not configured, returning defaults');
        return {
            entities: [],
            sentiment: { sentiment: 'neutral', score: 0 },
        };
    }

    const content = `${title}\n\n${excerpt || ''}`;

    const prompt = `Analyze this news article and extract structured information.

Article:
"""
${content}
"""

Return a JSON object with:
1. "entities": Array of entities found. Each entity has:
   - "name": Entity name
   - "type": One of "person", "company", "location", "commodity", "sector", "policy", "event"
   - "confidence": 0.0-1.0 confidence score
   - "context": Brief context of entity's role
2. "sentiment": Object with:
   - "sentiment": "positive", "negative", or "neutral"
   - "score": -1.0 to 1.0 (negative to positive)
   - "reasoning": Brief explanation
3. "category": Best fitting category from: "Geopolitics", "Business", "Technology", "Politics", "Science", "World", "Markets", "Supply Chain", "Energy"
4. "summary": One sentence summary of key impact

IMPORTANT: Return ONLY valid JSON, no markdown code blocks or explanation.`;

    try {
        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.GROQ_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a news analysis AI. Extract entities, sentiment, and categorize news articles. Always respond with valid JSON only.',
                    },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.1,
                max_tokens: 1024,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('Groq API error:', error);
            throw new Error(`Groq API error: ${response.status}`);
        }

        const data = await response.json() as {
            choices: Array<{ message: { content: string } }>;
        };

        const content_response = data.choices[0]?.message?.content || '{}';

        // Parse JSON (handle potential markdown wrapping)
        let jsonStr = content_response.trim();
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
        }

        const result = JSON.parse(jsonStr) as AIAnalysisResult;

        return {
            entities: result.entities || [],
            sentiment: result.sentiment || { sentiment: 'neutral', score: 0 },
            category: result.category,
            summary: result.summary,
        };
    } catch (error) {
        console.error('AI analysis error:', error);
        return {
            entities: [],
            sentiment: { sentiment: 'neutral', score: 0 },
        };
    }
}

// Batch process multiple articles
export async function processUnanalyzedArticles(limit: number = 10) {
    // This will be called from the processing route
    // Returns list of article IDs that need processing
    return { processed: 0, limit };
}
