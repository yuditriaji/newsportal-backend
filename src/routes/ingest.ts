import { FastifyPluginAsync } from 'fastify';
import { supabase } from '../config/database.js';
import { fetchFromNewsData, mapNewsDataToArticle } from '../ingest/newsdata.js';
import { fetchFromGNews, mapGNewsToArticle } from '../ingest/gnews.js';

export const ingestRoutes: FastifyPluginAsync = async (fastify) => {
    // POST /api/ingest/newsdata - Fetch and store from NewsData.io
    fastify.post('/newsdata', async (request, reply) => {
        try {
            const articles = await fetchFromNewsData();

            if (articles.length === 0) {
                return { message: 'No articles fetched', count: 0 };
            }

            const mapped = articles.map(mapNewsDataToArticle);

            // Upsert articles (avoid duplicates by URL)
            const { data, error } = await supabase
                .from('articles')
                .upsert(
                    mapped.map((article) => ({
                        ...article,
                        processed: false,
                    })),
                    { onConflict: 'url', ignoreDuplicates: true }
                )
                .select();

            if (error) {
                fastify.log.error(error);
                return reply.code(500).send({ error: 'Failed to store articles' });
            }

            // Log the job
            await supabase.from('job_logs').insert({
                job_type: 'ingest',
                status: 'completed',
                message: `NewsData.io: Fetched ${articles.length}, stored ${data?.length || 0}`,
                items_processed: data?.length || 0,
                completed_at: new Date().toISOString(),
            });

            return {
                message: 'NewsData ingestion complete',
                fetched: articles.length,
                stored: data?.length || 0,
            };
        } catch (error) {
            fastify.log.error(error);
            return reply.code(500).send({ error: 'Ingestion failed' });
        }
    });

    // POST /api/ingest/gnews - Fetch and store from GNews
    fastify.post('/gnews', async (request, reply) => {
        try {
            const articles = await fetchFromGNews();

            if (articles.length === 0) {
                return { message: 'No articles fetched', count: 0 };
            }

            const mapped = articles.map(mapGNewsToArticle);

            const { data, error } = await supabase
                .from('articles')
                .upsert(
                    mapped.map((article) => ({
                        ...article,
                        processed: false,
                    })),
                    { onConflict: 'url', ignoreDuplicates: true }
                )
                .select();

            if (error) {
                fastify.log.error(error);
                return reply.code(500).send({ error: 'Failed to store articles' });
            }

            await supabase.from('job_logs').insert({
                job_type: 'ingest',
                status: 'completed',
                message: `GNews: Fetched ${articles.length}, stored ${data?.length || 0}`,
                items_processed: data?.length || 0,
                completed_at: new Date().toISOString(),
            });

            return {
                message: 'GNews ingestion complete',
                fetched: articles.length,
                stored: data?.length || 0,
            };
        } catch (error) {
            fastify.log.error(error);
            return reply.code(500).send({ error: 'Ingestion failed' });
        }
    });

    // POST /api/ingest/all - Run all ingestion sources
    fastify.post('/all', async (request, reply) => {
        const results = {
            newsdata: { fetched: 0, stored: 0 },
            gnews: { fetched: 0, stored: 0 },
        };

        // NewsData
        try {
            const newsDataArticles = await fetchFromNewsData();
            results.newsdata.fetched = newsDataArticles.length;

            if (newsDataArticles.length > 0) {
                const mapped = newsDataArticles.map(mapNewsDataToArticle);
                const { data } = await supabase
                    .from('articles')
                    .upsert(mapped.map((a) => ({ ...a, processed: false })), {
                        onConflict: 'url',
                        ignoreDuplicates: true
                    })
                    .select();
                results.newsdata.stored = data?.length || 0;
            }
        } catch (e) {
            fastify.log.error(`NewsData ingestion error: ${e}`);
        }

        // GNews
        try {
            const gnewsArticles = await fetchFromGNews();
            results.gnews.fetched = gnewsArticles.length;

            if (gnewsArticles.length > 0) {
                const mapped = gnewsArticles.map(mapGNewsToArticle);
                const { data } = await supabase
                    .from('articles')
                    .upsert(mapped.map((a) => ({ ...a, processed: false })), {
                        onConflict: 'url',
                        ignoreDuplicates: true
                    })
                    .select();
                results.gnews.stored = data?.length || 0;
            }
        } catch (e) {
            fastify.log.error(`GNews ingestion error: ${e}`);
        }

        // Log combined job
        await supabase.from('job_logs').insert({
            job_type: 'ingest',
            status: 'completed',
            message: `Combined: NewsData ${results.newsdata.stored}, GNews ${results.gnews.stored}`,
            items_processed: results.newsdata.stored + results.gnews.stored,
            completed_at: new Date().toISOString(),
        });

        return {
            message: 'All ingestion complete',
            results,
            totalStored: results.newsdata.stored + results.gnews.stored,
        };
    });

    // GET /api/ingest/status - Check quota usage
    fastify.get('/status', async () => {
        const { data: quotas } = await supabase
            .from('api_quota_usage')
            .select('*')
            .eq('date', new Date().toISOString().split('T')[0]);

        const { data: recentJobs } = await supabase
            .from('job_logs')
            .select('*')
            .order('started_at', { ascending: false })
            .limit(5);

        return {
            quotas: quotas || [],
            recentJobs: recentJobs || [],
        };
    });
};
