/**
 * AI Synthesis Service
 * 
 * Generates comprehensive story briefings from multiple source articles
 * using Groq LLM with inline citations and impact predictions.
 */

import Groq from 'groq-sdk';

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

// Types
export interface Article {
    id: string;
    title: string;
    excerpt: string;
    url: string;
    source: string;
    published_at: string;
    image_url?: string;
}

export interface SynthesisSection {
    title: string;
    content: string;
    citations: Array<{
        source: string;
        article_id: string;
    }>;
}

export interface ExtractedEntity {
    name: string;
    type: 'person' | 'company' | 'location' | 'organization' | 'commodity' | 'policy' | 'event';
    role: 'primary' | 'secondary' | 'mentioned';
    context: string;
}

export interface EntityConnection {
    source: string;
    target: string;
    relationship: string;
    evidence: string;
    strength: number;
}

export interface ImpactPrediction {
    sector: 'economic' | 'geopolitical' | 'political' | 'social' | 'technological' | 'supply_chain' | 'ecological';
    type: 'positive' | 'negative' | 'neutral' | 'uncertain';
    severity: number; // 1-5
    prediction: string;
    confidence: number; // 0-1
}

export interface SynthesisResult {
    title: string;
    summary: string;
    sections: SynthesisSection[];
    entities: ExtractedEntity[];
    connections: EntityConnection[];
    impacts: ImpactPrediction[];
    timeline?: Array<{ date: string; event: string }>;
}

const SYNTHESIS_PROMPT = `You are an investigative journalist AI for "The Investigation" news portal. 
Given multiple news articles about the same event/topic, create a comprehensive briefing.

ARTICLES TO SYNTHESIZE:
{{ARTICLES}}

Your task is to:
1. Write a synthesized briefing (NOT copy-paste)
2. Add inline citations [Source Name] after each factual claim
3. Extract ALL entities (people, companies, locations, organizations)
4. Map connections between entities
5. Predict impacts on various sectors

OUTPUT FORMAT (valid JSON only, no markdown):
{
  "title": "Clear, concise headline for the story (max 100 chars)",
  "summary": "2-3 sentence hook summarizing the key development. Include main entities and significance.",
  "sections": [
    {
      "title": "Summary",
      "content": "Main paragraph synthesizing the core news. Every fact must have [Source Name] citation inline.",
      "citations": [{"source": "AP", "article_index": 0}]
    },
    {
      "title": "Key Developments",
      "content": "Timeline of events or additional details. [Source] citations required.",
      "citations": [{"source": "Reuters", "article_index": 1}]
    },
    {
      "title": "Background",
      "content": "Context and history if relevant. [Source] citations.",
      "citations": []
    },
    {
      "title": "Reactions",
      "content": "Quotes and responses from stakeholders. [Source] citations.",
      "citations": []
    }
  ],
  "entities": [
    {
      "name": "Entity Name",
      "type": "person|company|location|organization|commodity|policy|event",
      "role": "primary|secondary|mentioned",
      "context": "Brief explanation of this entity's relevance"
    }
  ],
  "connections": [
    {
      "source": "Entity A Name",
      "target": "Entity B Name",
      "relationship": "works_for|located_in|owns|investigated_by|allied_with|opposes|related_to|supplies|regulates",
      "evidence": "Brief evidence/reason for this connection from the articles",
      "strength": 0.8
    }
  ],
  "impacts": [
    {
      "sector": "economic|geopolitical|political|social|technological|supply_chain|ecological",
      "type": "positive|negative|neutral|uncertain",
      "severity": 3,
      "prediction": "What could happen as a result of this news",
      "confidence": 0.7
    }
  ],
  "timeline": [
    {"date": "2026-01-18", "event": "Brief event description"}
  ]
}

RULES:
1. NEVER copy full sentences from articles - always synthesize in your own words
2. Every factual claim MUST have a [Source Name] citation
3. Identify at least 3-5 entities
4. Create at least 2-3 entity connections
5. Predict at least 2-3 sector impacts
6. Be objective and balanced - present multiple viewpoints
7. Output ONLY valid JSON, no explanation or markdown`;

export async function synthesizeArticles(articles: Article[]): Promise<SynthesisResult> {
    if (articles.length === 0) {
        throw new Error('No articles provided for synthesis');
    }

    // Format articles for the prompt
    const articlesText = articles.map((article, index) => `
[ARTICLE ${index + 1}]
Source: ${article.source}
Title: ${article.title}
Published: ${article.published_at}
Content: ${article.excerpt}
URL: ${article.url}
`).join('\n---\n');

    const prompt = SYNTHESIS_PROMPT.replace('{{ARTICLES}}', articlesText);

    try {
        const completion = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                {
                    role: 'system',
                    content: 'You are a news synthesis AI. Output only valid JSON, no markdown or explanation.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.3,
            max_tokens: 4000,
        });

        const content = completion.choices[0]?.message?.content;
        if (!content) {
            throw new Error('No content returned from Groq');
        }

        // Parse JSON (handle potential markdown code blocks)
        let jsonStr = content.trim();
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
        }

        const result: SynthesisResult = JSON.parse(jsonStr);

        // Map article_index in citations to actual article_ids
        result.sections = result.sections.map(section => ({
            ...section,
            citations: section.citations.map(citation => {
                const articleIndex = (citation as any).article_index ?? 0;
                return {
                    source: citation.source,
                    article_id: articles[articleIndex]?.id || articles[0].id
                };
            })
        }));

        return result;
    } catch (error) {
        console.error('Synthesis error:', error);

        // Return a basic synthesis on error
        return {
            title: articles[0].title,
            summary: articles[0].excerpt,
            sections: [{
                title: 'Summary',
                content: articles.map(a => `${a.excerpt} [${a.source}]`).join(' '),
                citations: articles.map(a => ({ source: a.source, article_id: a.id }))
            }],
            entities: [],
            connections: [],
            impacts: []
        };
    }
}

/**
 * Generate a shorter summary for card display
 */
export async function generateSummary(articles: Article[]): Promise<string> {
    const titles = articles.map(a => a.title).join('; ');

    const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
            {
                role: 'user',
                content: `Summarize these news headlines in 2 sentences (under 200 chars):\n${titles}`
            }
        ],
        temperature: 0.3,
        max_tokens: 200,
    });

    return completion.choices[0]?.message?.content?.trim() || articles[0].excerpt;
}
