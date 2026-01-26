/**
 * Scheduler Service
 * 
 * Runs periodic jobs for news ingestion and story clustering.
 * Uses node-cron for scheduling.
 */

import cron from 'node-cron';
import { runClusteringJob } from './clustering.js';

// Track job status
const jobStatus = {
    ingestion: {
        lastRun: null as Date | null,
        isRunning: false,
        lastResult: null as any,
    },
    clustering: {
        lastRun: null as Date | null,
        isRunning: false,
        lastResult: null as any,
    },
};

/**
 * Run news ingestion from all configured sources
 */
async function runIngestionJob() {
    if (jobStatus.ingestion.isRunning) {
        console.log('[Scheduler] Ingestion job already running, skipping...');
        return;
    }

    console.log('[Scheduler] Starting ingestion job...');
    jobStatus.ingestion.isRunning = true;
    jobStatus.ingestion.lastRun = new Date();

    try {
        // Dynamically import to avoid circular dependencies
        const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 8080}`;

        // Trigger ingestion via internal API call
        const response = await fetch(`${baseUrl}/api/ingest/all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        const result = await response.json();
        jobStatus.ingestion.lastResult = result;
        console.log('[Scheduler] Ingestion completed:', result);

    } catch (error) {
        console.error('[Scheduler] Ingestion error:', error);
        jobStatus.ingestion.lastResult = { error: String(error) };
    } finally {
        jobStatus.ingestion.isRunning = false;
    }
}

/**
 * Run story clustering job
 */
async function runClusteringJobWrapper() {
    if (jobStatus.clustering.isRunning) {
        console.log('[Scheduler] Clustering job already running, skipping...');
        return;
    }

    console.log('[Scheduler] Starting clustering job...');
    jobStatus.clustering.isRunning = true;
    jobStatus.clustering.lastRun = new Date();

    try {
        const result = await runClusteringJob();
        jobStatus.clustering.lastResult = result;
        console.log('[Scheduler] Clustering completed:', result);

    } catch (error) {
        console.error('[Scheduler] Clustering error:', error);
        jobStatus.clustering.lastResult = { error: String(error) };
    } finally {
        jobStatus.clustering.isRunning = false;
    }
}

/**
 * Initialize all scheduled jobs
 */
export function initializeScheduler() {
    console.log('[Scheduler] Initializing scheduled jobs...');

    // News ingestion: Every 2 hours
    // Cron: At minute 0 past every 2nd hour
    cron.schedule('0 */2 * * *', () => {
        console.log('[Scheduler] Triggering scheduled ingestion...');
        runIngestionJob();
    }, {
        timezone: 'UTC'
    });

    // Story clustering: Every 4 hours (after ingestion has time to complete)
    // Cron: At minute 30 past every 4th hour
    cron.schedule('30 */4 * * *', () => {
        console.log('[Scheduler] Triggering scheduled clustering...');
        runClusteringJobWrapper();
    }, {
        timezone: 'UTC'
    });

    console.log('[Scheduler] Jobs scheduled:');
    console.log('  - Ingestion: Every 2 hours (at :00)');
    console.log('  - Clustering: Every 4 hours (at :30)');

    // Run initial jobs after 1 minute delay (let server fully start)
    setTimeout(() => {
        console.log('[Scheduler] Running initial ingestion after startup...');
        runIngestionJob();
    }, 60000);

    setTimeout(() => {
        console.log('[Scheduler] Running initial clustering after startup...');
        runClusteringJobWrapper();
    }, 120000);
}

/**
 * Get current job status (for health check endpoint)
 */
export function getJobStatus() {
    return {
        ingestion: {
            lastRun: jobStatus.ingestion.lastRun?.toISOString() || null,
            isRunning: jobStatus.ingestion.isRunning,
            lastResult: jobStatus.ingestion.lastResult,
        },
        clustering: {
            lastRun: jobStatus.clustering.lastRun?.toISOString() || null,
            isRunning: jobStatus.clustering.isRunning,
            lastResult: jobStatus.clustering.lastResult,
        },
    };
}

/**
 * Manually trigger ingestion (for API endpoint)
 */
export async function triggerIngestion() {
    return runIngestionJob();
}

/**
 * Manually trigger clustering (for API endpoint)
 */
export async function triggerClustering() {
    return runClusteringJobWrapper();
}
