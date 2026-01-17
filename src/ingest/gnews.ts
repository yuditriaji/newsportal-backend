import { env } from '../config/env.js';

interface GNewsArticle {
    title: string;
    description: string;
    content: string;
    url: string;
    image: string;
    publishedAt: string;
    source: {
        name: string;
        url: string;
    };
}

interface GNewsResponse {
    totalArticles: number;
    articles: GNewsArticle[];
}

export async function fetchFromGNews(
    topic?: string,
    language: string = 'en'
): Promise<GNewsArticle[]> {
    if (!env.GNEWS_API_KEY) {
        console.warn('GNEWS_API_KEY not configured');
        return [];
    }

    const params = new URLSearchParams({
        token: env.GNEWS_API_KEY,
        lang: language,
        max: '10',
    });

    const endpoint = topic
        ? `https://gnews.io/api/v4/top-headlines?topic=${topic}&${params.toString()}`
        : `https://gnews.io/api/v4/top-headlines?${params.toString()}`;

    try {
        const response = await fetch(endpoint);

        if (!response.ok) {
            throw new Error(`GNews API error: ${response.status}`);
        }

        const data = await response.json() as GNewsResponse;
        return data.articles || [];
    } catch (error) {
        console.error('GNews fetch error:', error);
        return [];
    }
}

export function mapGNewsToArticle(article: GNewsArticle) {
    return {
        title: article.title,
        excerpt: article.description?.slice(0, 200) || null,
        url: article.url,
        image_url: article.image,
        published_at: new Date(article.publishedAt).toISOString(),
        source_name: article.source.name,
        language: 'en',
    };
}
