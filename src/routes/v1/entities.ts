import { FastifyPluginAsync } from 'fastify';
import { supabase } from '../../config/database.js';
import { runCypher } from '../../db/neo4j.js';

interface EntityQuery {
    page?: number;
    limit?: number;
    type?: string;
}

export const entitiesRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /api/v1/entities - List entities
    fastify.get<{ Querystring: EntityQuery }>('/', async (request) => {
        const { page = 1, limit = 50, type } = request.query;
        const offset = (page - 1) * limit;

        let query = supabase
            .from('entities')
            .select('*', { count: 'exact' })
            .order('name', { ascending: true })
            .range(offset, offset + limit - 1);

        if (type) {
            query = query.eq('type', type);
        }

        const { data, count, error } = await query;

        if (error) {
            fastify.log.error(error);
            throw new Error('Failed to fetch entities');
        }

        return {
            data,
            meta: {
                page,
                limit,
                total: count || 0,
            },
        };
    });

    // GET /api/v1/entities/:id - Get entity with connections
    fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
        const { id } = request.params;

        const { data: entity, error } = await supabase
            .from('entities')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !entity) {
            return reply.code(404).send({ error: 'Entity not found' });
        }

        // Get related articles count
        const { count } = await supabase
            .from('article_entities')
            .select('*', { count: 'exact', head: true })
            .eq('entity_id', id);

        return {
            ...entity,
            articleCount: count || 0,
        };
    });

    // GET /api/v1/entities/:id/connections - Get entity graph connections from Neo4j
    fastify.get<{ Params: { id: string } }>('/:id/connections', async (request, reply) => {
        const { id } = request.params;

        try {
            const connections = await runCypher<{
                relatedEntity: { id: string; name: string; type: string };
                relationship: { type: string; weight: number };
            }>(
                `
        MATCH (e:Entity {id: $id})-[r:RELATED_TO]-(other:Entity)
        RETURN other as relatedEntity, r as relationship
        LIMIT 50
        `,
                { id }
            );

            return { data: connections };
        } catch (err) {
            fastify.log.error(err);
            return reply.code(500).send({ error: 'Failed to fetch connections' });
        }
    });
};
