#!/usr/bin/env npx tsx
/**
 * Database Migration Runner
 * Connects directly to Supabase PostgreSQL and runs migrations
 * 
 * Usage:
 *   npx tsx scripts/migrate.ts
 * 
 * Environment:
 *   DATABASE_URL - Full PostgreSQL connection string (from Supabase project settings)
 */

import pg from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Client } = pg;

async function runMigrations() {
    // Get DATABASE_URL from environment
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
        console.error('❌ DATABASE_URL environment variable is required');
        console.log('\nGet it from Supabase Dashboard:');
        console.log('  Project Settings → Database → Connection string → URI\n');
        console.log('Then run:');
        console.log('  DATABASE_URL="postgresql://..." npx tsx scripts/migrate.ts');
        process.exit(1);
    }

    console.log('🚀 Starting database migration...\n');

    // Connect to database
    const client = new Client({
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false },
    });

    try {
        await client.connect();
        console.log('✅ Connected to database\n');

        // Read migration file
        const migrationPath = path.join(__dirname, '../migrations/001_initial_schema.sql');

        if (!fs.existsSync(migrationPath)) {
            console.error('❌ Migration file not found:', migrationPath);
            process.exit(1);
        }

        const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

        console.log('📋 Executing migration...\n');

        // Execute the entire migration as a single transaction
        await client.query('BEGIN');

        try {
            await client.query(migrationSQL);
            await client.query('COMMIT');
            console.log('✅ Migration completed successfully!\n');
        } catch (error: any) {
            await client.query('ROLLBACK');
            console.error('❌ Migration failed:', error.message);

            // Show more details for debugging
            if (error.position) {
                const lines = migrationSQL.split('\n');
                let charCount = 0;
                for (let i = 0; i < lines.length; i++) {
                    charCount += lines[i].length + 1;
                    if (charCount >= parseInt(error.position)) {
                        console.error(`\n   Error near line ${i + 1}: ${lines[i].trim()}`);
                        break;
                    }
                }
            }
            process.exit(1);
        }

        // Verify tables were created
        const { rows } = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);

        console.log('📊 Tables in database:');
        rows.forEach((row: any) => {
            console.log(`   • ${row.table_name}`);
        });
        console.log('');

    } catch (error: any) {
        console.error('❌ Connection failed:', error.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

runMigrations().catch(console.error);
