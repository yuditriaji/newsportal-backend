import { FastifyPluginAsync } from 'fastify';
import { supabase } from '../../config/database.js';

export const authRoutes: FastifyPluginAsync = async (fastify) => {
    // Verify JWT token
    fastify.post('/verify', async (request, reply) => {
        const authHeader = request.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return reply.code(401).send({ error: 'Missing authorization header' });
        }

        const token = authHeader.split(' ')[1];

        try {
            const { data, error } = await supabase.auth.getUser(token);

            if (error || !data.user) {
                return reply.code(401).send({ error: 'Invalid token' });
            }

            return { user: data.user };
        } catch (err) {
            fastify.log.error(err);
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });

    // Get user profile
    fastify.get('/me', async (request, reply) => {
        const authHeader = request.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return reply.code(401).send({ error: 'Unauthorized' });
        }

        const token = authHeader.split(' ')[1];

        try {
            const { data: { user }, error } = await supabase.auth.getUser(token);

            if (error || !user) {
                return reply.code(401).send({ error: 'Invalid token' });
            }

            // Get extended profile
            const { data: profile } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();

            return {
                id: user.id,
                email: user.email,
                ...profile,
            };
        } catch (err) {
            fastify.log.error(err);
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });
};
