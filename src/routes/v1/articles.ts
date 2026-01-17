import { FastifyPluginAsync } from 'fastify';
import { supabase } from '../../config/database.js';

interface ArticleQuery {
    page?: number;
    limit?: number;
    category?: string;
    source?: string;
    search?: string;
}

export const articlesRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /api/v1/articles - List articles with filters
    fastify.get<{ Querystring: ArticleQuery }>('/', async (request) => {
        const { page = 1, limit = 20, category, source, search } = request.query;
        const offset = (page - 1) * limit;

        let query = supabase
            .from('articles')
            .select(`
        id,
        title,
        excerpt,
        summary,
        url,
        image_url,
        source_id,
        published_at,
        category,
        region,
        sentiment,
        sentiment_score,
        created_at,
        news_sources (
          name,
          credibility_score,
          tier
        )
      `, { count: 'exact' })
            .order('published_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (category) {
            query = query.eq('category', category);
        }

        if (source) {
            query = query.eq('source', source);
        }

        if (search) {
            query = query.textSearch('title', search);
        }

        const { data, count, error } = await query;

        if (error) {
            fastify.log.error(error);
            throw new Error('Failed to fetch articles');
        }

        return {
            data,
            meta: {
                page,
                limit,
                total: count || 0,
                totalPages: Math.ceil((count || 0) / limit),
            },
        };
    });

    // GET /api/v1/articles/:id - Get single article with entities
    fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
        const { id } = request.params;

        const { data: article, error } = await supabase
            .from('articles')
            .select(`
        *,
        news_sources (
          name,
          credibility_score,
          tier,
          logo_url
        ),
        article_entities (
          confidence,
          context,
          entities (
            id,
            name,
            type
          )
        )
      `)
            .eq('id', id)
            .single();

        if (error || !article) {
            return reply.code(404).send({ error: 'Article not found' });
        }

        return article;
    });

    // GET /api/v1/articles/:id/related - Get related articles
    fastify.get<{ Params: { id: string } }>('/:id/related', async (request, reply) => {
        const { id } = request.params;

        // Get the article's entities first
        const { data: articleEntities } = await supabase
            .from('article_entities')
            .select('entity_id')
            .eq('article_id', id);

        if (!articleEntities || articleEntities.length === 0) {
            return { data: [] };
        }

        const entityIds = articleEntities.map((ae) => ae.entity_id);

        // Find articles sharing these entities
        const { data: relatedArticles } = await supabase
            .from('article_entities')
            .select(`
        articles (
          id,
          title,
          excerpt,
          image_url,
          published_at,
          category
        )
      `)
            .in('entity_id', entityIds)
            .neq('article_id', id)
            .limit(10);

        // Deduplicate and format
        const uniqueArticles = new Map();
        relatedArticles?.forEach((ra: any) => {
            if (ra.articles && !uniqueArticles.has(ra.articles.id)) {
                uniqueArticles.set(ra.articles.id, ra.articles);
            }
        });

        return { data: Array.from(uniqueArticles.values()) };
    });
};
