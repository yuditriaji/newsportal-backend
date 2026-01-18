import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env, validateEnv } from './config/env.js';
import { closeNeo4j } from './db/neo4j.js';

// Import routes
import { healthRoutes } from './routes/health.js';
import { articlesRoutes } from './routes/v1/articles.js';
import { entitiesRoutes } from './routes/v1/entities.js';
import { investigationsRoutes } from './routes/v1/investigations.js';
import { authRoutes } from './routes/v1/auth.js';
import { ingestRoutes } from './routes/ingest.js';
import { aiRoutes } from './routes/ai.js';
import storiesRoutes from './routes/stories.js';

// Validate environment variables
validateEnv();

// Create Fastify instance
const fastify = Fastify({
    logger: {
        level: env.isDevelopment ? 'debug' : 'info',
        transport: env.isDevelopment
            ? {
                target: 'pino-pretty',
                options: { colorize: true },
            }
            : undefined,
    },
});

// Register plugins
async function registerPlugins() {
    // CORS - allow frontend origin
    await fastify.register(cors, {
        origin: [env.FRONTEND_URL, 'http://localhost:3000'],
        credentials: true,
    });

    // Security headers
    await fastify.register(helmet, {
        contentSecurityPolicy: env.isProduction,
    });

    // Rate limiting (OWASP A04)
    await fastify.register(rateLimit, {
        max: 100,
        timeWindow: '1 minute',
    });
}

// Register routes
async function registerRoutes() {
    // Health check (no prefix)
    await fastify.register(healthRoutes);

    // API v1 routes
    await fastify.register(authRoutes, { prefix: '/api/v1/auth' });
    await fastify.register(articlesRoutes, { prefix: '/api/v1/articles' });
    await fastify.register(entitiesRoutes, { prefix: '/api/v1/entities' });
    await fastify.register(investigationsRoutes, { prefix: '/api/v1/investigations' });

    // Stories API (synthesized news)
    await fastify.register(storiesRoutes, { prefix: '/api' });

    // Internal ingestion routes
    await fastify.register(ingestRoutes, { prefix: '/api/ingest' });

    // AI processing routes
    await fastify.register(aiRoutes, { prefix: '/api/ai' });
}

// Graceful shutdown
async function gracefulShutdown() {
    fastify.log.info('Shutting down gracefully...');
    await closeNeo4j();
    await fastify.close();
    process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Start server
async function start() {
    try {
        await registerPlugins();
        await registerRoutes();

        await fastify.listen({ port: env.PORT, host: '0.0.0.0' });
        fastify.log.info(`Server running on http://localhost:${env.PORT}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
}

start();
