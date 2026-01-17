import { FastifyPluginAsync } from 'fastify';
import { supabase } from '../config/database.js';
import { analyzeArticle } from '../ai/groq.js';

export const aiRoutes: FastifyPluginAsync = async (fastify) => {
    // POST /api/ai/process - Process unanalyzed articles with AI
    fastify.post('/process', async (request, reply) => {
        const { limit = 5 } = request.body as { limit?: number };

        try {
            // Get unprocessed articles
            const { data: articles, error } = await supabase
                .from('articles')
                .select('id, title, excerpt')
                .eq('processed', false)
                .order('published_at', { ascending: false })
                .limit(limit);

            if (error) {
                fastify.log.error(error);
                return reply.code(500).send({ error: 'Failed to fetch articles' });
            }

            if (!articles || articles.length === 0) {
                return { message: 'No unprocessed articles', processed: 0 };
            }

            const results: Array<{ id: string; success: boolean; entities?: number }> = [];

            for (const article of articles) {
                try {
                    // Analyze with AI
                    const analysis = await analyzeArticle(article.title, article.excerpt);

                    // Update article with sentiment and category
                    await supabase
                        .from('articles')
                        .update({
                            sentiment: analysis.sentiment.sentiment,
                            sentiment_score: analysis.sentiment.score,
                            category: analysis.category || null,
                            summary: analysis.summary || null,
                            processed: true,
                        })
                        .eq('id', article.id);

                    // Insert entities
                    if (analysis.entities.length > 0) {
                        for (const entity of analysis.entities) {
                            // Upsert entity
                            const { data: existingEntity } = await supabase
                                .from('entities')
                                .select('id')
                                .eq('name', entity.name)
                                .eq('type', entity.type)
                                .single();

                            let entityId = existingEntity?.id;

                            if (!entityId) {
                                const { data: newEntity } = await supabase
                                    .from('entities')
                                    .insert({
                                        name: entity.name,
                                        type: entity.type,
                                    })
                                    .select('id')
                                    .single();
                                entityId = newEntity?.id;
                            }

                            // Link entity to article
                            if (entityId) {
                                await supabase
                                    .from('article_entities')
                                    .upsert({
                                        article_id: article.id,
                                        entity_id: entityId,
                                        confidence: entity.confidence,
                                        context: entity.context,
                                    }, { onConflict: 'article_id,entity_id' });
                            }
                        }
                    }

                    results.push({
                        id: article.id,
                        success: true,
                        entities: analysis.entities.length,
                    });
                } catch (err) {
                    fastify.log.error(`Failed to process article ${article.id}: ${err}`);
                    results.push({ id: article.id, success: false });
                }
            }

            // Log the job
            await supabase.from('job_logs').insert({
                job_type: 'process',
                status: 'completed',
                message: `Processed ${results.filter((r) => r.success).length}/${articles.length} articles`,
                items_processed: results.filter((r) => r.success).length,
                completed_at: new Date().toISOString(),
            });

            return {
                message: 'AI processing complete',
                processed: results.filter((r) => r.success).length,
                failed: results.filter((r) => !r.success).length,
                results,
            };
        } catch (error) {
            fastify.log.error(`AI processing error: ${error}`);
            return reply.code(500).send({ error: 'Processing failed' });
        }
    });

    // POST /api/ai/analyze - Analyze a single article by ID
    fastify.post('/analyze/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        const { data: article, error } = await supabase
            .from('articles')
            .select('id, title, excerpt')
            .eq('id', id)
            .single();

        if (error || !article) {
            return reply.code(404).send({ error: 'Article not found' });
        }

        try {
            const analysis = await analyzeArticle(article.title, article.excerpt);

            // Update the article
            await supabase
                .from('articles')
                .update({
                    sentiment: analysis.sentiment.sentiment,
                    sentiment_score: analysis.sentiment.score,
                    category: analysis.category || null,
                    summary: analysis.summary || null,
                    processed: true,
                })
                .eq('id', id);

            return {
                articleId: id,
                analysis,
            };
        } catch (err) {
            fastify.log.error(`Analysis error: ${err}`);
            return reply.code(500).send({ error: 'Analysis failed' });
        }
    });

    // GET /api/ai/entities - Get all extracted entities
    fastify.get('/entities', async (request, reply) => {
        const { type, limit = 50 } = request.query as { type?: string; limit?: number };

        let query = supabase
            .from('entities')
            .select(`
        id,
        name,
        type,
        article_entities (
          article_id,
          confidence
        )
      `)
            .limit(limit);

        if (type) {
            query = query.eq('type', type);
        }

        const { data, error } = await query;

        if (error) {
            return reply.code(500).send({ error: 'Failed to fetch entities' });
        }

        // Add article count
        const withCounts = (data || []).map((entity: any) => ({
            ...entity,
            articleCount: entity.article_entities?.length || 0,
        }));

        return { entities: withCounts };
    });

    // GET /api/ai/stats - Get AI processing stats
    fastify.get('/stats', async () => {
        const { count: totalArticles } = await supabase
            .from('articles')
            .select('*', { count: 'exact', head: true });

        const { count: processedArticles } = await supabase
            .from('articles')
            .select('*', { count: 'exact', head: true })
            .eq('processed', true);

        const { count: totalEntities } = await supabase
            .from('entities')
            .select('*', { count: 'exact', head: true });

        const { data: sentimentBreakdown } = await supabase
            .from('articles')
            .select('sentiment')
            .not('sentiment', 'is', null);

        const sentimentCounts = {
            positive: 0,
            negative: 0,
            neutral: 0,
        };

        (sentimentBreakdown || []).forEach((a: any) => {
            if (a.sentiment in sentimentCounts) {
                sentimentCounts[a.sentiment as keyof typeof sentimentCounts]++;
            }
        });

        return {
            articles: {
                total: totalArticles || 0,
                processed: processedArticles || 0,
                pending: (totalArticles || 0) - (processedArticles || 0),
            },
            entities: {
                total: totalEntities || 0,
            },
            sentiment: sentimentCounts,
        };
    });
};
