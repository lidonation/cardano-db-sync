-- Stage three runs on every start, so its renames carry no version guard.
ALTER INDEX IF EXISTS idx_alpha_note RENAME TO idx_gamma_note;
CREATE INDEX IF NOT EXISTS idx_gamma_note ON gamma (note);
