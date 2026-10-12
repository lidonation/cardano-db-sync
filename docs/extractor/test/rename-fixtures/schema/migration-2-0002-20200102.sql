CREATE FUNCTION migrate() RETURNS void AS $body$
DECLARE
  next_version int ;
BEGIN
  SELECT stage_two + 1 INTO next_version FROM schema_version ;
  IF next_version = 2 THEN
    -- COLUMN is optional, and the table may be schema-qualified
    EXECUTE 'ALTER TABLE IF EXISTS ONLY public."beta" RENAME "new_col" TO "newer_col"' ;
    EXECUTE 'ALTER TABLE "beta" RENAME CONSTRAINT "it''s_unique" TO "beta_unique"' ;
    UPDATE schema_version SET stage_two = next_version ;
  END IF ;
END ;
$body$ LANGUAGE plpgsql ;

SELECT migrate() ;

/* a block comment that says RENAME
   across two lines */
ALTER TABLE beta RENAME TO gamma ;
ALTER SEQUENCE "beta_id_seq" RENAME TO "gamma_id_seq" ;
