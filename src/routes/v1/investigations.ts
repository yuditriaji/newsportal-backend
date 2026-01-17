import { FastifyPluginAsync } from 'fastify';
import { supabase } from '../../config/database.js';
import { requireAuth } from '../../middleware/auth.js';

export const investigationsRoutes: FastifyPluginAsync = async (fastify) => {
    // All investigation routes require authentication
    fastify.addHook('preHandler', requireAuth);

    // GET /api/v1/investigations - List user's investigations
    fastify.get('/', async (request) => {
        const userId = request.user!.id;

        const { data, error } = await supabase
            .from('investigations')
            .select('*')
            .eq('owner_id', userId)
            .order('updated_at', { ascending: false });

        if (error) {
            fastify.log.error(error);
            throw new Error('Failed to fetch investigations');
        }

        return { data };
    });

    // POST /api/v1/investigations - Create investigation
    fastify.post<{ Body: { title: string; description?: string } }>(
        '/',
        async (request, reply) => {
            const userId = request.user!.id;
            const { title, description } = request.body;

            const { data, error } = await supabase
                .from('investigations')
                .insert({
                    title,
                    description,
                    owner_id: userId,
                })
                .select()
                .single();

            if (error) {
                fastify.log.error(error);
                return reply.code(400).send({ error: 'Failed to create investigation' });
            }

            return reply.code(201).send(data);
        }
    );

    // GET /api/v1/investigations/:id - Get investigation with articles
    fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
        const { id } = request.params;
        const userId = request.user!.id;

        const { data, error } = await supabase
            .from('investigations')
            .select(`
        *,
        investigation_articles (
          notes,
          added_at,
          articles (
            id,
            title,
            excerpt,
            url,
            published_at
          )
        )
      `)
            .eq('id', id)
            .single();

        if (error || !data) {
            return reply.code(404).send({ error: 'Investigation not found' });
        }

        // Check ownership (OWASP A01)
        if (data.owner_id !== userId && data.visibility === 'private') {
            return reply.code(403).send({ error: 'Forbidden' });
        }

        return data;
    });

    // POST /api/v1/investigations/:id/articles - Add article to investigation
    fastify.post<{ Params: { id: string }; Body: { article_id: string; notes?: string } }>(
        '/:id/articles',
        async (request, reply) => {
            const { id } = request.params;
            const { article_id, notes } = request.body;
            const userId = request.user!.id;

            // Verify ownership
            const { data: investigation } = await supabase
                .from('investigations')
                .select('owner_id')
                .eq('id', id)
                .single();

            if (!investigation || investigation.owner_id !== userId) {
                return reply.code(403).send({ error: 'Forbidden' });
            }

            const { data, error } = await supabase
                .from('investigation_articles')
                .insert({
                    investigation_id: id,
                    article_id,
                    added_by: userId,
                    notes,
                })
                .select()
                .single();

            if (error) {
                fastify.log.error(error);
                return reply.code(400).send({ error: 'Failed to add article' });
            }

            return reply.code(201).send(data);
        }
    );

    // DELETE /api/v1/investigations/:id - Delete investigation
    fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
        const { id } = request.params;
        const userId = request.user!.id;

        // Verify ownership
        const { data: investigation } = await supabase
            .from('investigations')
            .select('owner_id')
            .eq('id', id)
            .single();

        if (!investigation || investigation.owner_id !== userId) {
            return reply.code(403).send({ error: 'Forbidden' });
        }

        const { error } = await supabase
            .from('investigations')
            .delete()
            .eq('id', id);

        if (error) {
            fastify.log.error(error);
            return reply.code(400).send({ error: 'Failed to delete' });
        }

        return reply.code(204).send();
    });
};
