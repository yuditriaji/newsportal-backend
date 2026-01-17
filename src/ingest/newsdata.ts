import { env } from '../config/env.js';

interface NewsDataArticle {
    article_id: string;
    title: string;
    description: string | null;
    link: string;
    image_url: string | null;
    pubDate: string;
    source_id: string;
    source_name?: string;
    category: string[];
    country: string[];
    language: string;
}

interface NewsDataResponse {
    status: string;
    totalResults: number;
    results: NewsDataArticle[];
    nextPage?: string;
}

export async function fetchFromNewsData(
    category?: string,
    language: string = 'en'
): Promise<NewsDataArticle[]> {
    if (!env.NEWSDATA_API_KEY) {
        console.warn('NEWSDATA_API_KEY not configured');
        return [];
    }

    const params = new URLSearchParams({
        apikey: env.NEWSDATA_API_KEY,
        language,
    });

    if (category) {
        params.append('category', category);
    }

    try {
        const response = await fetch(
            `https://newsdata.io/api/1/latest?${params.toString()}`
        );

        if (!response.ok) {
            throw new Error(`NewsData API error: ${response.status}`);
        }

        const data = await response.json() as NewsDataResponse;
        return data.results || [];
    } catch (error) {
        console.error('NewsData fetch error:', error);
        return [];
    }
}

// Map NewsData categories to our categories
const categoryMap: Record<string, string> = {
    business: 'Business',
    politics: 'Politics',
    technology: 'Technology',
    science: 'Science',
    world: 'World',
    top: 'Breaking',
};

export function mapNewsDataToArticle(article: NewsDataArticle) {
    return {
        title: article.title,
        excerpt: article.description?.slice(0, 200) || null,
        url: article.link,
        image_url: article.image_url,
        published_at: new Date(article.pubDate).toISOString(),
        category: categoryMap[article.category?.[0]] || article.category?.[0] || 'World',
        region: article.country?.[0] || null,
        language: article.language,
        source_name: article.source_name || article.source_id,
    };
}
