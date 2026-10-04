-- UP
ALTER TABLE classroom_pacing_signals ADD COLUMN segment_id TEXT;
CREATE INDEX IF NOT EXISTS idx_cps_session_segment ON classroom_pacing_signals(session_id, segment_id, student_id);

-- DOWN
DROP INDEX IF EXISTS idx_cps_session_segment;
