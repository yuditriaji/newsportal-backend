import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../config/database.js';

interface User {
    id: string;
    email?: string;
}

// Extend FastifyRequest to include user
declare module 'fastify' {
    interface FastifyRequest {
        user?: User;
    }
}

// Auth middleware - verifies Supabase JWT (OWASP A01)
export async function requireAuth(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
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

        request.user = { id: user.id, email: user.email };
    } catch (err) {
        request.log.error(err);
        return reply.code(401).send({ error: 'Authentication failed' });
    }
}

// Ownership check middleware (OWASP A01)
export function requireOwnership(resourceKey: string = 'owner_id') {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const resourceOwnerId = (request as any).resource?.[resourceKey];

        if (!request.user) {
            return reply.code(401).send({ error: 'Unauthorized' });
        }

        if (resourceOwnerId && resourceOwnerId !== request.user.id) {
            return reply.code(403).send({ error: 'Forbidden' });
        }
    };
}
