# 🕵️ The Investigation — Backend

The powerful backend service for **The Investigation**, an AI-powered news portal that analyzes global impacts, tracks entities, and connects the dots across complex investigative stories.

## ⚡ Tech Stack

- **Framework**: Fastify (Node.js)
- **Language**: TypeScript
- **Database**: Supabase (PostgreSQL + pgvector)
- **AI**: Groq (Llama 3.3 70B) for entity extraction and sentiment analysis
- **News Data**: NewsData.io, GNews
- **Deployment**: Render

## 🛠️ Setup & Installation

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd newsportal-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment**
   Create a `.env` file based on `.env.example`:
   ```env
   # Server
   PORT=8080
   NODE_ENV=development

   # Database (Supabase)
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-key

   # AI Provider
   GROQ_API_KEY=your-groq-key

   # News APIs
   NEWSDATA_API_KEY=your-key
   GNEWS_API_KEY=your-key
   ```

4. **Run Database Migrations**
   Use Supabase CLI to push the schema:
   ```bash
   supabase link --project-ref <your-project-id>
   supabase db push
   ```

5. **Start Development Server**
   ```bash
   npm run dev
   ```

## 📡 API Endpoints

### Ingestion
- `POST /api/ingest/all`: Trigger fetching from all news sources
- `POST /api/ingest/newsdata`: Fetch only from NewsData.io
- `POST /api/ingest/gnews`: Fetch only from GNews
- `GET /api/ingest/status`: detailed ingestion stats and logs

### AI Processing
- `POST /api/ai/process`: Run AI analysis on unindexed articles
  - Body: `{ "limit": 10 }`
- `GET /api/ai/stats`: View AI processing statistics

### System
- `GET /health`: Server health check

## 🗄️ Database Schema

Key tables in Supabase:
- `articles`: Core news content and metadata
- `entities`: Extracted people, companies, locations
- `article_entities`: Many-to-many relationships (The Graph)
- `investigations`: User-created case files
- `watchlist`: User-tracked entities

## 🚀 Deployment

This project is configured for **Render**.
- **Build Command**: `npm run build`
- **Start Command**: `npm start`
- Ensure all environment variables are set in the Render dashboard.
