import neo4j, { Driver } from 'neo4j-driver';
import { env } from '../config/env.js';

let driver: Driver | null = null;

export function getNeo4jDriver(): Driver {
    if (!driver) {
        driver = neo4j.driver(
            env.NEO4J_URI,
            neo4j.auth.basic(env.NEO4J_USERNAME, env.NEO4J_PASSWORD)
        );
    }
    return driver;
}

export async function closeNeo4j(): Promise<void> {
    if (driver) {
        await driver.close();
        driver = null;
    }
}

// Helper for running Cypher queries
export async function runCypher<T>(
    query: string,
    params: Record<string, unknown> = {}
): Promise<T[]> {
    const session = getNeo4jDriver().session();
    try {
        const result = await session.run(query, params);
        return result.records.map((record) => record.toObject() as T);
    } finally {
        await session.close();
    }
}
