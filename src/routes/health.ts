import { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get('/health', async () => {
        return {
            status: 'ok',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
        };
    });

    fastify.get('/', async () => {
        return {
            name: 'Newsportal API',
            version: '1.0.0',
            docs: '/api/v1',
        };
    });
};
