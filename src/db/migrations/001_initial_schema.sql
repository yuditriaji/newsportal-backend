-- =====================================================
-- Investigative News Portal - Database Schema
-- Run this in Supabase SQL Editor
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- =====================================================
-- PROFILES (extends Supabase auth.users)
-- =====================================================
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    avatar_url TEXT,
    role TEXT DEFAULT 'user' CHECK (role IN ('user', 'editor', 'admin')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'avatar_url'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- NEWS SOURCES
-- =====================================================
CREATE TABLE IF NOT EXISTS news_sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    domain TEXT UNIQUE,
    credibility_score INTEGER DEFAULT 50 CHECK (credibility_score >= 0 AND credibility_score <= 100),
    bias TEXT CHECK (bias IN ('left', 'center-left', 'center', 'center-right', 'right', 'unknown')),
    tier TEXT DEFAULT 'standard' CHECK (tier IN ('premium', 'standard', 'community')),
    logo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial sources
INSERT INTO news_sources (name, domain, credibility_score, tier) VALUES
    ('Reuters', 'reuters.com', 95, 'premium'),
    ('AP News', 'apnews.com', 94, 'premium'),
    ('Bloomberg', 'bloomberg.com', 92, 'premium'),
    ('Financial Times', 'ft.com', 93, 'premium'),
    ('BBC', 'bbc.com', 90, 'premium'),
    ('The Guardian', 'theguardian.com', 85, 'premium'),
    ('CNBC', 'cnbc.com', 82, 'standard'),
    ('TechCrunch', 'techcrunch.com', 78, 'standard')
ON CONFLICT (name) DO NOTHING;

-- =====================================================
-- ARTICLES
-- =====================================================
CREATE TABLE IF NOT EXISTS articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    excerpt TEXT,  -- First 200 chars only (fair use)
    summary TEXT,  -- AI-generated summary
    url TEXT NOT NULL UNIQUE,
    image_url TEXT,
    source_id UUID REFERENCES news_sources(id),
    published_at TIMESTAMPTZ,
    category TEXT,
    region TEXT,
    language TEXT DEFAULT 'en',
    sentiment TEXT CHECK (sentiment IN ('positive', 'negative', 'neutral')),
    sentiment_score DECIMAL(3,2),
    embedding VECTOR(1024),  -- Jina embeddings
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_processed ON articles(processed);
CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source_id);

-- =====================================================
-- ENTITIES
-- =====================================================
CREATE TABLE IF NOT EXISTS entities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('person', 'company', 'location', 'commodity', 'sector', 'policy', 'event')),
    aliases TEXT[],
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_name_type ON entities(name, type);

-- =====================================================
-- ARTICLE <-> ENTITY JUNCTION
-- =====================================================
CREATE TABLE IF NOT EXISTS article_entities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    confidence DECIMAL(3,2) DEFAULT 0.80,
    context TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(article_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_article_entities_article ON article_entities(article_id);
CREATE INDEX IF NOT EXISTS idx_article_entities_entity ON article_entities(entity_id);

-- =====================================================
-- INVESTIGATIONS
-- =====================================================
CREATE TABLE IF NOT EXISTS investigations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    description TEXT,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'draft')),
    visibility TEXT DEFAULT 'private' CHECK (visibility IN ('private', 'team', 'public')),
    canvas_state JSONB DEFAULT '{}',  -- React Flow state
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investigations_owner ON investigations(owner_id);

-- =====================================================
-- INVESTIGATION <-> ARTICLES
-- =====================================================
CREATE TABLE IF NOT EXISTS investigation_articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    investigation_id UUID NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    added_by UUID REFERENCES auth.users(id),
    notes TEXT,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(investigation_id, article_id)
);

-- =====================================================
-- WATCHLIST
-- =====================================================
CREATE TABLE IF NOT EXISTS watchlist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
    custom_name TEXT,  -- For custom watchlist items
    custom_type TEXT,
    notify BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);

-- =====================================================
-- API QUOTA TRACKING
-- =====================================================
CREATE TABLE IF NOT EXISTS api_quota_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service TEXT NOT NULL,  -- newsdata, gnews, groq, gemini, jina
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    requests_used INTEGER DEFAULT 0,
    daily_limit INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(service, date)
);

-- =====================================================
-- JOB LOGS
-- =====================================================
CREATE TABLE IF NOT EXISTS job_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_type TEXT NOT NULL,  -- ingest, process, embed
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    message TEXT,
    items_processed INTEGER DEFAULT 0,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE investigations ENABLE ROW LEVEL SECURITY;
ALTER TABLE investigation_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can read all, update own
CREATE POLICY "Profiles are viewable by everyone" ON profiles
    FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- Investigations: Owner or public visibility
CREATE POLICY "Users can view own or public investigations" ON investigations
    FOR SELECT USING (owner_id = auth.uid() OR visibility = 'public');
CREATE POLICY "Users can insert own investigations" ON investigations
    FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Users can update own investigations" ON investigations
    FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY "Users can delete own investigations" ON investigations
    FOR DELETE USING (owner_id = auth.uid());

-- Investigation articles: Owner only
CREATE POLICY "Users can view articles in viewable investigations" ON investigation_articles
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM investigations i 
            WHERE i.id = investigation_id 
            AND (i.owner_id = auth.uid() OR i.visibility = 'public')
        )
    );
CREATE POLICY "Users can modify articles in own investigations" ON investigation_articles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM investigations i 
            WHERE i.id = investigation_id 
            AND i.owner_id = auth.uid()
        )
    );

-- Watchlist: User's own only
CREATE POLICY "Users can manage own watchlist" ON watchlist
    FOR ALL USING (user_id = auth.uid());

-- =====================================================
-- Grant access to service role for backend
-- =====================================================
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
