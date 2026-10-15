-- Complete schema upgrade script for executive_ai database
-- Safe to run on existing or fresh PostgreSQL databases (uses IF NOT EXISTS)

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Upgrade executive_profiles table
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS responsibilities TEXT DEFAULT '';
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS thinking_examples TEXT DEFAULT '';
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS default_tone VARCHAR(40) DEFAULT 'professional';
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS default_directness VARCHAR(30) DEFAULT 'balanced';
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS response_length VARCHAR(30) DEFAULT 'moderate';
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS formality VARCHAR(30) DEFAULT 'formal';
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS humor_level VARCHAR(30) DEFAULT 'occasional';
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS greeting VARCHAR(500) DEFAULT '';
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS closing VARCHAR(500) DEFAULT '';
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS risk_tolerance INTEGER NOT NULL DEFAULT 50;
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS long_term_orientation INTEGER NOT NULL DEFAULT 65;
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS attention_to_detail INTEGER NOT NULL DEFAULT 70;
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS decision_speed INTEGER NOT NULL DEFAULT 55;
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS openness_to_ideas INTEGER NOT NULL DEFAULT 65;
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS preferred_evidence VARCHAR(50) NOT NULL DEFAULT 'balanced';
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS speaking_pace VARCHAR(40) NOT NULL DEFAULT 'moderate';
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS accent_notes VARCHAR(500) NOT NULL DEFAULT '';
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata';

-- 2. Upgrade clients table
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email VARCHAR(320) DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone VARCHAR(50) DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;

-- 3. Create missing tables if they do not exist
CREATE TABLE IF NOT EXISTS communication_situations (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    audience VARCHAR(80) DEFAULT 'general',
    trigger_description TEXT DEFAULT '',
    tone VARCHAR(40) DEFAULT 'professional',
    response_guidelines TEXT DEFAULT '',
    example_response TEXT DEFAULT '',
    priority INTEGER DEFAULT 100,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_communication_situations_client_id ON communication_situations(client_id);

CREATE TABLE IF NOT EXISTS executive_profile_versions (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    change_summary VARCHAR(500) DEFAULT 'Profile updated',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_executive_profile_versions_client_id ON executive_profile_versions(client_id);

CREATE TABLE IF NOT EXISTS executive_profile_records (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    record_type VARCHAR(80) NOT NULL,
    title VARCHAR(240) NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    source_type VARCHAR(40) NOT NULL DEFAULT 'explicit',
    verification_status VARCHAR(40) NOT NULL DEFAULT 'needs_review',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_executive_profile_records_client_id ON executive_profile_records(client_id);
CREATE INDEX IF NOT EXISTS ix_executive_profile_records_record_type ON executive_profile_records(record_type);

CREATE TABLE IF NOT EXISTS voice_clones (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    voice_id VARCHAR(200) NOT NULL,
    provider VARCHAR(50) DEFAULT 'elevenlabs',
    description TEXT DEFAULT '',
    consent_text TEXT DEFAULT '',
    sample_filename VARCHAR(300) DEFAULT '',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_voice_clones_client_id ON voice_clones(client_id);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    source_name VARCHAR(500) DEFAULT 'upload',
    chunk_index INTEGER DEFAULT 0,
    content TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_knowledge_chunks_client_id ON knowledge_chunks(client_id);
