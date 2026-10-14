-- Apply once to an existing PostgreSQL database before deploying this version.
-- New tables are also created by SQLAlchemy create_all on a fresh database.
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS risk_tolerance INTEGER NOT NULL DEFAULT 50;
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS long_term_orientation INTEGER NOT NULL DEFAULT 65;
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS attention_to_detail INTEGER NOT NULL DEFAULT 70;
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS decision_speed INTEGER NOT NULL DEFAULT 55;
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS openness_to_ideas INTEGER NOT NULL DEFAULT 65;
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS preferred_evidence VARCHAR(50) NOT NULL DEFAULT 'balanced';
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS speaking_pace VARCHAR(40) NOT NULL DEFAULT 'moderate';
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS accent_notes VARCHAR(500) NOT NULL DEFAULT '';
ALTER TABLE executive_profiles ADD COLUMN IF NOT EXISTS timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata';
CREATE TABLE IF NOT EXISTS executive_profile_records (
 id SERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 record_type VARCHAR(80) NOT NULL, title VARCHAR(240) NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
 source_type VARCHAR(40) NOT NULL DEFAULT 'explicit', verification_status VARCHAR(40) NOT NULL DEFAULT 'needs_review',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_executive_profile_records_client_id ON executive_profile_records(client_id);
CREATE INDEX IF NOT EXISTS ix_executive_profile_records_record_type ON executive_profile_records(record_type);
