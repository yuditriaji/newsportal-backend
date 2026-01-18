/**
 * Stories API Routes
 * 
 * REST endpoints for stories (synthesized article clusters)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../config/database.js';
import { runClusteringJob } from '../services/clustering.js';

interface StoriesQuery {
    limit?: number;
    offset?: number;
    sector?: string;
}

interface StoryParams {
    slug: string;
}

export default async function storiesRoutes(fastify: FastifyInstance) {

    /**
     * GET /api/stories
     * List published stories with summary, sources, and impacts
     */
    fastify.get<{ Querystring: StoriesQuery }>(
        '/stories',
        async (request, reply) => {
            const { limit = 20, offset = 0, sector } = request.query;

            let query = supabase
                .from('stories')
                .select(`
          id,
          title,
          slug,
          summary,
          hero_image_url,
          source_count,
          published_at,
          story_articles (
            articles (
              id,
              url,
              news_sources ( name, logo_url )
            )
          ),
          story_impacts (
            sector_id,
            impact_type,
            severity,
            prediction,
            confidence
          )
        `)
                .eq('status', 'published')
                .order('published_at', { ascending: false })
                .range(offset, offset + limit - 1);

            const { data: stories, error } = await query;

            if (error) {
                return reply.status(500).send({ error: error.message });
            }

            // Transform to flatten nested data
            const transformed = stories?.map(story => ({
                id: story.id,
                title: story.title,
                slug: story.slug,
                summary: story.summary,
                hero_image_url: story.hero_image_url,
                source_count: story.source_count,
                published_at: story.published_at,
                sources: story.story_articles?.map((sa: any) => ({
                    name: sa.articles?.news_sources?.name,
                    logo_url: sa.articles?.news_sources?.logo_url,
                })).filter((s: any) => s.name) || [],
                impacts: story.story_impacts?.map((impact: any) => ({
                    sector: impact.sector_id,
                    type: impact.impact_type,
                    severity: impact.severity,
                    prediction: impact.prediction,
                    confidence: impact.confidence,
                })) || [],
            }));

            return reply.send({ stories: transformed });
        }
    );

    /**
     * GET /api/stories/:slug
     * Full story detail with synthesis, entities, connections, and source articles
     */
    fastify.get<{ Params: StoryParams }>(
        '/stories/:slug',
        async (request, reply) => {
            const { slug } = request.params;

            // Get story with all related data
            const { data: story, error } = await supabase
                .from('stories')
                .select(`
          *,
          story_articles (
            relevance_score,
            articles (
              id,
              title,
              excerpt,
              url,
              image_url,
              published_at,
              news_sources ( name, logo_url )
            )
          ),
          story_entities (
            role,
            context,
            entities (
              id,
              name,
              type
            )
          ),
          story_impacts (
            sector_id,
            impact_type,
            severity,
            prediction,
            confidence,
            impact_sectors ( name, icon, color )
          )
        `)
                .eq('slug', slug)
                .single();

            if (error || !story) {
                return reply.status(404).send({ error: 'Story not found' });
            }

            // Get entity connections for entities in this story
            const entityIds = story.story_entities?.map((se: any) => se.entities?.id).filter(Boolean) || [];

            let connections: any[] = [];
            if (entityIds.length > 0) {
                const { data: connData } = await supabase
                    .from('entity_connections')
                    .select(`
            id,
            relationship_type,
            relationship_label,
            strength,
            evidence,
            source_entity:entities!source_entity_id ( id, name, type ),
            target_entity:entities!target_entity_id ( id, name, type )
          `)
                    .or(`source_entity_id.in.(${entityIds.join(',')}),target_entity_id.in.(${entityIds.join(',')})`);

                connections = connData || [];
            }

            // Increment view count
            await supabase
                .from('stories')
                .update({ view_count: (story.view_count || 0) + 1 })
                .eq('id', story.id);

            // Transform response
            const response = {
                id: story.id,
                title: story.title,
                slug: story.slug,
                summary: story.summary,
                synthesis: story.synthesis,
                hero_image_url: story.hero_image_url,
                source_count: story.source_count,
                view_count: story.view_count,
                published_at: story.published_at,
                articles: story.story_articles?.map((sa: any) => ({
                    id: sa.articles?.id,
                    title: sa.articles?.title,
                    excerpt: sa.articles?.excerpt,
                    url: sa.articles?.url,
                    image_url: sa.articles?.image_url,
                    published_at: sa.articles?.published_at,
                    source: sa.articles?.news_sources?.name,
                    source_logo: sa.articles?.news_sources?.logo_url,
                    relevance: sa.relevance_score,
                })).filter((a: any) => a.id) || [],
                entities: story.story_entities?.map((se: any) => ({
                    id: se.entities?.id,
                    name: se.entities?.name,
                    type: se.entities?.type,
                    role: se.role,
                    context: se.context,
                })).filter((e: any) => e.id) || [],
                connections: connections.map((c: any) => ({
                    id: c.id,
                    source: {
                        id: c.source_entity?.id,
                        name: c.source_entity?.name,
                        type: c.source_entity?.type,
                    },
                    target: {
                        id: c.target_entity?.id,
                        name: c.target_entity?.name,
                        type: c.target_entity?.type,
                    },
                    relationship: c.relationship_type,
                    label: c.relationship_label,
                    strength: c.strength,
                    evidence: c.evidence,
                })),
                impacts: story.story_impacts?.map((impact: any) => ({
                    sector: impact.sector_id,
                    sectorName: impact.impact_sectors?.name,
                    icon: impact.impact_sectors?.icon,
                    color: impact.impact_sectors?.color,
                    type: impact.impact_type,
                    severity: impact.severity,
                    prediction: impact.prediction,
                    confidence: impact.confidence,
                })) || [],
            };

            return reply.send(response);
        }
    );

    /**
     * POST /api/stories/cluster
     * Trigger clustering job (dev/admin only)
     */
    fastify.post(
        '/stories/cluster',
        async (request, reply) => {
            try {
                const result = await runClusteringJob();
                return reply.send({
                    success: true,
                    ...result
                });
            } catch (error) {
                return reply.status(500).send({
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }
    );

    /**
     * GET /api/stories/trending
     * Get trending stories (most viewed in last 24h)
     */
    fastify.get(
        '/stories/trending',
        async (request, reply) => {
            const { data: stories, error } = await supabase
                .from('stories')
                .select(`
          id,
          title,
          slug,
          summary,
          hero_image_url,
          source_count,
          view_count,
          published_at
        `)
                .eq('status', 'published')
                .order('view_count', { ascending: false })
                .limit(10);

            if (error) {
                return reply.status(500).send({ error: error.message });
            }

            return reply.send({ stories });
        }
    );

    /**
     * GET /api/stories/by-sector/:sector
     * Get stories filtered by impact sector
     */
    fastify.get<{ Params: { sector: string } }>(
        '/stories/by-sector/:sector',
        async (request, reply) => {
            const { sector } = request.params;

            // Get story IDs that have this sector impact
            const { data: impacts } = await supabase
                .from('story_impacts')
                .select('story_id')
                .eq('sector_id', sector);

            if (!impacts || impacts.length === 0) {
                return reply.send({ stories: [] });
            }

            const storyIds = impacts.map(i => i.story_id);

            const { data: stories, error } = await supabase
                .from('stories')
                .select(`
          id,
          title,
          slug,
          summary,
          hero_image_url,
          source_count,
          published_at,
          story_impacts (
            sector_id,
            impact_type,
            severity
          )
        `)
                .in('id', storyIds)
                .eq('status', 'published')
                .order('published_at', { ascending: false })
                .limit(20);

            if (error) {
                return reply.status(500).send({ error: error.message });
            }

            return reply.send({ stories });
        }
    );
}
