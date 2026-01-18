-- Enhanced News Processing Schema
-- Migration: 002_stories_and_connections.sql
-- Adds tables for multi-source story synthesis, entity connections, and impact predictions

-- ============================================
-- STORIES: Grouped articles about the same event
-- ============================================
CREATE TABLE IF NOT EXISTS stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT UNIQUE,
  summary TEXT,                    -- AI-generated 2-3 sentence hook
  synthesis JSONB,                 -- Full structured content with citations
  hero_image_url TEXT,             -- Primary image for the story
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  source_count INT DEFAULT 0,
  view_count INT DEFAULT 0,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- STORY_ARTICLES: Junction table linking stories to source articles
-- ============================================
CREATE TABLE IF NOT EXISTS story_articles (
  story_id UUID REFERENCES stories(id) ON DELETE CASCADE,
  article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
  relevance_score FLOAT DEFAULT 1.0,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (story_id, article_id)
);

-- ============================================
-- STORY_ENTITIES: Entities mentioned in each story with their role
-- ============================================
CREATE TABLE IF NOT EXISTS story_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID REFERENCES stories(id) ON DELETE CASCADE,
  entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'mentioned' CHECK (role IN ('primary', 'secondary', 'mentioned')),
  context TEXT,                    -- Why this entity is relevant to the story
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(story_id, entity_id)
);

-- ============================================
-- ENTITY_CONNECTIONS: Relationships between entities discovered from stories
-- ============================================
CREATE TABLE IF NOT EXISTS entity_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  target_entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL, -- 'works_for', 'located_in', 'related_to', 'owns', 'investigated_by', etc.
  relationship_label TEXT,         -- Human-readable label
  strength FLOAT DEFAULT 0.5 CHECK (strength >= 0 AND strength <= 1),
  evidence TEXT,                   -- Source/reason for this connection
  story_id UUID REFERENCES stories(id) ON DELETE SET NULL, -- Story that established this
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_entity_id, target_entity_id, relationship_type)
);

-- ============================================
-- IMPACT_SECTORS: Define the sectors we track
-- ============================================
CREATE TABLE IF NOT EXISTS impact_sectors (
  id TEXT PRIMARY KEY,             -- 'economic', 'geopolitical', etc.
  name TEXT NOT NULL,
  icon TEXT,                       -- Emoji or icon name
  color TEXT,                      -- Hex color
  description TEXT
);

-- Insert default sectors
INSERT INTO impact_sectors (id, name, icon, color, description) VALUES
  ('economic', 'Economic', '📊', '#3b82f6', 'Markets, trade, financial impacts'),
  ('geopolitical', 'Geopolitical', '🌐', '#ef4444', 'International relations, conflicts, alliances'),
  ('political', 'Political', '🏛️', '#8b5cf6', 'Government, elections, policy'),
  ('social', 'Social', '👥', '#22c55e', 'Society, public opinion, demographics'),
  ('technological', 'Technological', '💻', '#f97316', 'Tech industry, innovation, digital'),
  ('supply_chain', 'Supply Chain', '🚚', '#f59e0b', 'Logistics, manufacturing, commodities'),
  ('ecological', 'Ecological', '🌍', '#14b8a6', 'Environment, climate, natural resources')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- STORY_IMPACTS: Predicted impact of stories on various sectors
-- ============================================
CREATE TABLE IF NOT EXISTS story_impacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID REFERENCES stories(id) ON DELETE CASCADE,
  sector_id TEXT REFERENCES impact_sectors(id) ON DELETE CASCADE,
  impact_type TEXT CHECK (impact_type IN ('positive', 'negative', 'neutral', 'uncertain')),
  severity INT CHECK (severity >= 1 AND severity <= 5),
  prediction TEXT,                 -- AI explanation of potential impact
  confidence FLOAT CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(story_id, sector_id)
);

-- ============================================
-- INDEXES for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_stories_published ON stories(published_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_stories_slug ON stories(slug);
CREATE INDEX IF NOT EXISTS idx_story_articles_story ON story_articles(story_id);
CREATE INDEX IF NOT EXISTS idx_story_articles_article ON story_articles(article_id);
CREATE INDEX IF NOT EXISTS idx_story_entities_story ON story_entities(story_id);
CREATE INDEX IF NOT EXISTS idx_story_entities_entity ON story_entities(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_connections_source ON entity_connections(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_connections_target ON entity_connections(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_connections_story ON entity_connections(story_id);
CREATE INDEX IF NOT EXISTS idx_story_impacts_story ON story_impacts(story_id);
CREATE INDEX IF NOT EXISTS idx_story_impacts_sector ON story_impacts(sector_id);

-- ============================================
-- Note: Embedding column for article clustering requires pgvector extension
-- Run this separately if pgvector is enabled:
-- ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedding vector(1536);
-- CREATE INDEX IF NOT EXISTS idx_articles_embedding ON articles USING ivfflat (embedding vector_cosine_ops);
-- ============================================

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_impacts ENABLE ROW LEVEL SECURITY;

-- Public read access for published stories
CREATE POLICY "Public can view published stories" ON stories
  FOR SELECT USING (status = 'published');

CREATE POLICY "Public can view story articles" ON story_articles
  FOR SELECT USING (true);

CREATE POLICY "Public can view story entities" ON story_entities
  FOR SELECT USING (true);

CREATE POLICY "Public can view entity connections" ON entity_connections
  FOR SELECT USING (true);

CREATE POLICY "Public can view story impacts" ON story_impacts
  FOR SELECT USING (true);

-- Service role can do everything
CREATE POLICY "Service can manage stories" ON stories
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service can manage story_articles" ON story_articles
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service can manage story_entities" ON story_entities
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service can manage entity_connections" ON entity_connections
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service can manage story_impacts" ON story_impacts
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- HELPER FUNCTION: Generate slug from title
-- ============================================
CREATE OR REPLACE FUNCTION generate_story_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NULL THEN
    NEW.slug := lower(regexp_replace(NEW.title, '[^a-zA-Z0-9]+', '-', 'g'));
    NEW.slug := regexp_replace(NEW.slug, '-+', '-', 'g');
    NEW.slug := trim(both '-' from NEW.slug);
    NEW.slug := NEW.slug || '-' || substr(NEW.id::text, 1, 8);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stories_generate_slug
  BEFORE INSERT ON stories
  FOR EACH ROW
  EXECUTE FUNCTION generate_story_slug();

-- ============================================
-- HELPER FUNCTION: Update source_count on story
-- ============================================
CREATE OR REPLACE FUNCTION update_story_source_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE stories SET source_count = source_count + 1, updated_at = NOW()
    WHERE id = NEW.story_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE stories SET source_count = source_count - 1, updated_at = NOW()
    WHERE id = OLD.story_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER story_articles_count_trigger
  AFTER INSERT OR DELETE ON story_articles
  FOR EACH ROW
  EXECUTE FUNCTION update_story_source_count();
