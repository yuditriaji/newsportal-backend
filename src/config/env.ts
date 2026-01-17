import 'dotenv/config';

export const env = {
    // Server
    PORT: parseInt(process.env.PORT || '8080', 10),
    NODE_ENV: process.env.NODE_ENV || 'development',
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',

    // Supabase
    SUPABASE_URL: process.env.SUPABASE_URL || '',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',

    // Neo4j
    NEO4J_URI: process.env.NEO4J_URI || '',
    NEO4J_USERNAME: process.env.NEO4J_USERNAME || 'neo4j',
    NEO4J_PASSWORD: process.env.NEO4J_PASSWORD || '',

    // AI APIs
    GROQ_API_KEY: process.env.GROQ_API_KEY || '',
    GOOGLE_GEMINI_API_KEY: process.env.GOOGLE_GEMINI_API_KEY || '',
    JINA_API_KEY: process.env.JINA_API_KEY || '',

    // News APIs
    NEWSDATA_API_KEY: process.env.NEWSDATA_API_KEY || '',
    GNEWS_API_KEY: process.env.GNEWS_API_KEY || '',

    // Redis (Upstash)
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL || '',
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN || '',

    // Validation
    isProduction: process.env.NODE_ENV === 'production',
    isDevelopment: process.env.NODE_ENV === 'development',
};

export function validateEnv(): void {
    const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0 && env.isProduction) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
}
