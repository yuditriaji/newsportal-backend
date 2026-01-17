-- Investigative News Portal Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgvector";

-- News Sources table
CREATE TABLE IF NOT EXISTS news_sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    domain TEXT UNIQUE,
    credibility_score INTEGER DEFAULT 50,
    tier TEXT DEFAULT 'standard',
    logo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Articles table
CREATE TABLE IF NOT EXISTS articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    excerpt TEXT,
    content TEXT,
    image_url TEXT,
    published_at TIMESTAMPTZ,
    source_id UUID REFERENCES news_sources(id),
    category TEXT,
    sentiment TEXT CHECK (sentiment IN ('positive', 'negative', 'neutral')),
    sentiment_score NUMERIC,
    summary TEXT,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on URL for fast duplicate checking
CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_processed ON articles(processed);

-- Entities table (people, companies, locations, etc.)
CREATE TABLE IF NOT EXISTS entities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('person', 'company', 'location', 'commodity', 'sector', 'policy', 'event')),
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(name, type)
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);

-- Article-Entity relationship
CREATE TABLE IF NOT EXISTS article_entities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    confidence NUMERIC DEFAULT 0.5,
    context TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(article_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_article_entities_article ON article_entities(article_id);
CREATE INDEX IF NOT EXISTS idx_article_entities_entity ON article_entities(entity_id);

-- Investigations table
CREATE TABLE IF NOT EXISTS investigations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    description TEXT,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
    visibility TEXT DEFAULT 'private' CHECK (visibility IN ('private', 'public', 'shared')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investigations_owner ON investigations(owner_id);
CREATE INDEX IF NOT EXISTS idx_investigations_status ON investigations(status);

-- Investigation-Article relationship
CREATE TABLE IF NOT EXISTS investigation_articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    investigation_id UUID NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    added_by UUID REFERENCES auth.users(id),
    notes TEXT,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(investigation_id, article_id)
);

-- Watchlist table
CREATE TABLE IF NOT EXISTS watchlist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    notify BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);

-- Job logs for tracking ingestion
CREATE TABLE IF NOT EXISTS job_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_type TEXT NOT NULL,
    status TEXT DEFAULT 'running',
    message TEXT,
    items_processed INTEGER DEFAULT 0,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- API quotas tracking
CREATE TABLE IF NOT EXISTS api_quotas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_name TEXT NOT NULL,
    daily_limit INTEGER,
    used_today INTEGER DEFAULT 0,
    reset_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User profiles extension
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    avatar_url TEXT,
    subscription_tier TEXT DEFAULT 'free',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE investigations ENABLE ROW LEVEL SECURITY;
ALTER TABLE investigation_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_sources ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Articles: Public read access
CREATE POLICY "Articles are viewable by everyone" ON articles
    FOR SELECT USING (true);

-- Entities: Public read access  
CREATE POLICY "Entities are viewable by everyone" ON entities
    FOR SELECT USING (true);

-- Article Entities: Public read access
CREATE POLICY "Article entities are viewable by everyone" ON article_entities
    FOR SELECT USING (true);

-- News Sources: Public read access
CREATE POLICY "News sources are viewable by everyone" ON news_sources
    FOR SELECT USING (true);

-- Investigations: Owner access
CREATE POLICY "Users can view their own investigations" ON investigations
    FOR SELECT USING (auth.uid() = owner_id OR visibility = 'public');

CREATE POLICY "Users can create their own investigations" ON investigations
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own investigations" ON investigations
    FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own investigations" ON investigations
    FOR DELETE USING (auth.uid() = owner_id);

-- Investigation Articles: Based on investigation ownership
CREATE POLICY "Users can view articles in their investigations" ON investigation_articles
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM investigations 
            WHERE id = investigation_id 
            AND (owner_id = auth.uid() OR visibility = 'public')
        )
    );

CREATE POLICY "Users can add articles to their investigations" ON investigation_articles
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM investigations 
            WHERE id = investigation_id 
            AND owner_id = auth.uid()
        )
    );

CREATE POLICY "Users can remove articles from their investigations" ON investigation_articles
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM investigations 
            WHERE id = investigation_id 
            AND owner_id = auth.uid()
        )
    );

-- Watchlist: User-specific
CREATE POLICY "Users can view their own watchlist" ON watchlist
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can add to their own watchlist" ON watchlist
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own watchlist" ON watchlist
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete from their own watchlist" ON watchlist
    FOR DELETE USING (auth.uid() = user_id);

-- Profiles: User-specific
CREATE POLICY "Users can view their own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- Service role bypass for server-side operations
-- Note: Service role key bypasses RLS automatically

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for articles
CREATE TRIGGER update_articles_updated_at
    BEFORE UPDATE ON articles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for investigations
CREATE TRIGGER update_investigations_updated_at
    BEFORE UPDATE ON investigations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Initial seed data for news sources
INSERT INTO news_sources (name, domain, credibility_score, tier) VALUES
    ('Reuters', 'reuters.com', 95, 'premium'),
    ('Associated Press', 'apnews.com', 95, 'premium'),
    ('BBC', 'bbc.com', 90, 'premium'),
    ('The Guardian', 'theguardian.com', 85, 'standard'),
    ('Bloomberg', 'bloomberg.com', 90, 'premium'),
    ('CNBC', 'cnbc.com', 80, 'standard'),
    ('Al Jazeera', 'aljazeera.com', 75, 'standard'),
    ('NPR', 'npr.org', 90, 'premium')
ON CONFLICT (name) DO NOTHING;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
