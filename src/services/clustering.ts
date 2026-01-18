/**
 * Article Clustering Service
 * 
 * Groups similar articles together using text similarity.
 * Uses a simple TF-IDF approach for free-tier compatibility.
 */

import { supabase } from '../config/database.js';
import { synthesizeArticles, SynthesisResult } from '../ai/synthesis.js';

interface Article {
    id: string;
    title: string;
    excerpt: string;
    url: string;
    source: string;
    published_at: string;
    image_url?: string;
}

interface Cluster {
    articles: Article[];
    similarity: number;
}

/**
 * Simple text tokenizer - extracts significant words
 */
function tokenize(text: string): string[] {
    const stopWords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
        'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
        'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
        'its', 'it', 'this', 'that', 'these', 'those', 'he', 'she', 'they',
        'we', 'you', 'i', 'his', 'her', 'their', 'our', 'your', 'my', 'as',
        'said', 'says', 'according', 'also', 'just', 'about', 'after', 'before',
        'new', 'first', 'last', 'year', 'years', 'day', 'days', 'time', 'more',
        'some', 'any', 'all', 'most', 'other', 'into', 'over', 'such', 'no',
        'not', 'only', 'than', 'then', 'now', 'out', 'up', 'down', 'so', 'if',
    ]);

    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.has(word));
}

/**
 * Calculate Jaccard similarity between two token sets
 */
function jaccardSimilarity(tokens1: string[], tokens2: string[]): number {
    const set1 = new Set(tokens1);
    const set2 = new Set(tokens2);

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
}

/**
 * Calculate cosine similarity using term frequencies
 */
function cosineSimilarity(tokens1: string[], tokens2: string[]): number {
    const freq1 = new Map<string, number>();
    const freq2 = new Map<string, number>();

    tokens1.forEach(t => freq1.set(t, (freq1.get(t) || 0) + 1));
    tokens2.forEach(t => freq2.set(t, (freq2.get(t) || 0) + 1));

    const allTerms = new Set([...freq1.keys(), ...freq2.keys()]);

    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;

    allTerms.forEach(term => {
        const v1 = freq1.get(term) || 0;
        const v2 = freq2.get(term) || 0;
        dotProduct += v1 * v2;
        magnitude1 += v1 * v1;
        magnitude2 += v2 * v2;
    });

    if (magnitude1 === 0 || magnitude2 === 0) return 0;

    return dotProduct / (Math.sqrt(magnitude1) * Math.sqrt(magnitude2));
}

/**
 * Combined similarity score (Jaccard + Cosine average)
 */
function calculateSimilarity(article1: Article, article2: Article): number {
    const text1 = `${article1.title} ${article1.excerpt}`;
    const text2 = `${article2.title} ${article2.excerpt}`;

    const tokens1 = tokenize(text1);
    const tokens2 = tokenize(text2);

    const jaccard = jaccardSimilarity(tokens1, tokens2);
    const cosine = cosineSimilarity(tokens1, tokens2);

    return (jaccard + cosine) / 2;
}

/**
 * Cluster articles by similarity using greedy clustering
 */
function clusterArticles(articles: Article[], threshold: number = 0.35): Cluster[] {
    const clusters: Cluster[] = [];
    const assigned = new Set<string>();

    // Sort by recency (newest first)
    const sorted = [...articles].sort((a, b) =>
        new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );

    for (const article of sorted) {
        if (assigned.has(article.id)) continue;

        // Start a new cluster with this article
        const cluster: Cluster = { articles: [article], similarity: 1 };
        assigned.add(article.id);

        // Find similar articles to add to this cluster
        for (const candidate of sorted) {
            if (assigned.has(candidate.id)) continue;

            // Check similarity against all articles in cluster
            const similarities = cluster.articles.map(a => calculateSimilarity(a, candidate));
            const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;

            if (avgSimilarity >= threshold) {
                cluster.articles.push(candidate);
                cluster.similarity = Math.min(cluster.similarity, avgSimilarity);
                assigned.add(candidate.id);
            }
        }

        clusters.push(cluster);
    }

    return clusters;
}

/**
 * Get recent articles that haven't been assigned to a story yet
 */
async function getUnassignedArticles(hoursBack: number = 48): Promise<Article[]> {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
        .from('articles')
        .select('id, title, excerpt, url, published_at, image_url, news_sources(name)')
        .gte('published_at', since)
        .order('published_at', { ascending: false })
        .limit(100);

    if (error) {
        console.error('Error fetching articles:', error);
        return [];
    }

    // Check which articles already have stories
    const articleIds = data.map(a => a.id);
    const { data: existingLinks } = await supabase
        .from('story_articles')
        .select('article_id')
        .in('article_id', articleIds);

    const assignedIds = new Set(existingLinks?.map(l => l.article_id) || []);

    return data
        .filter(a => !assignedIds.has(a.id))
        .map(a => ({
            id: a.id,
            title: a.title,
            excerpt: a.excerpt || '',
            url: a.url,
            source: (a.news_sources as any)?.name || 'Unknown',
            published_at: a.published_at,
            image_url: a.image_url,
        }));
}

/**
 * Create a story from a cluster of articles
 */
async function createStoryFromCluster(cluster: Cluster): Promise<string | null> {
    const { articles } = cluster;

    // Need at least 2 articles to form a story
    if (articles.length < 2) return null;

    try {
        // Generate synthesis using AI
        console.log(`Synthesizing ${articles.length} articles...`);
        const synthesis = await synthesizeArticles(articles);

        // Pick the best hero image
        const heroImage = articles.find(a => a.image_url)?.image_url;

        // Create the story
        const { data: story, error: storyError } = await supabase
            .from('stories')
            .insert({
                title: synthesis.title,
                summary: synthesis.summary,
                synthesis: synthesis.sections,
                hero_image_url: heroImage,
                status: 'published',
                published_at: new Date().toISOString(),
            })
            .select('id')
            .single();

        if (storyError || !story) {
            console.error('Error creating story:', storyError);
            return null;
        }

        // Link articles to story
        const articleLinks = articles.map(a => ({
            story_id: story.id,
            article_id: a.id,
            relevance_score: cluster.similarity,
        }));

        await supabase.from('story_articles').insert(articleLinks);

        // Save entities and create/link them
        for (const entity of synthesis.entities) {
            // Find or create entity
            const { data: existingEntity } = await supabase
                .from('entities')
                .select('id')
                .ilike('name', entity.name)
                .single();

            let entityId: string;

            if (existingEntity) {
                entityId = existingEntity.id;
            } else {
                const { data: newEntity } = await supabase
                    .from('entities')
                    .insert({
                        name: entity.name,
                        type: entity.type,
                    })
                    .select('id')
                    .single();

                if (!newEntity) continue;
                entityId = newEntity.id;
            }

            // Link entity to story
            await supabase.from('story_entities').upsert({
                story_id: story.id,
                entity_id: entityId,
                role: entity.role,
                context: entity.context,
            });
        }

        // Save entity connections
        for (const connection of synthesis.connections) {
            // Find source and target entities by name
            const { data: sourceEntity } = await supabase
                .from('entities')
                .select('id')
                .ilike('name', connection.source)
                .single();

            const { data: targetEntity } = await supabase
                .from('entities')
                .select('id')
                .ilike('name', connection.target)
                .single();

            if (sourceEntity && targetEntity) {
                await supabase.from('entity_connections').upsert({
                    source_entity_id: sourceEntity.id,
                    target_entity_id: targetEntity.id,
                    relationship_type: connection.relationship,
                    relationship_label: connection.relationship.replace(/_/g, ' '),
                    strength: connection.strength,
                    evidence: connection.evidence,
                    story_id: story.id,
                }, {
                    onConflict: 'source_entity_id,target_entity_id,relationship_type'
                });
            }
        }

        // Save impact predictions
        const impactInserts = synthesis.impacts.map(impact => ({
            story_id: story.id,
            sector_id: impact.sector,
            impact_type: impact.type,
            severity: impact.severity,
            prediction: impact.prediction,
            confidence: impact.confidence,
        }));

        if (impactInserts.length > 0) {
            await supabase.from('story_impacts').insert(impactInserts);
        }

        console.log(`Created story: ${synthesis.title} (${story.id})`);
        return story.id;

    } catch (error) {
        console.error('Error creating story from cluster:', error);
        return null;
    }
}

/**
 * Main clustering job - run periodically
 */
export async function runClusteringJob(): Promise<{
    articlesProcessed: number;
    storiesCreated: number;
    clusters: number;
}> {
    console.log('Starting clustering job...');

    // Get unassigned articles from last 48 hours
    const articles = await getUnassignedArticles(48);
    console.log(`Found ${articles.length} unassigned articles`);

    if (articles.length < 2) {
        return { articlesProcessed: 0, storiesCreated: 0, clusters: 0 };
    }

    // Cluster by similarity
    const clusters = clusterArticles(articles, 0.35);
    console.log(`Formed ${clusters.length} clusters`);

    // Filter to clusters with 2+ articles
    const validClusters = clusters.filter(c => c.articles.length >= 2);
    console.log(`${validClusters.length} clusters have 2+ articles`);

    // Create stories from valid clusters
    let storiesCreated = 0;
    for (const cluster of validClusters) {
        const storyId = await createStoryFromCluster(cluster);
        if (storyId) storiesCreated++;
    }

    return {
        articlesProcessed: articles.length,
        storiesCreated,
        clusters: validClusters.length,
    };
}

export { clusterArticles, calculateSimilarity, getUnassignedArticles };
