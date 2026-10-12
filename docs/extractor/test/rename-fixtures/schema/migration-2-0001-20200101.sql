-- Fixture: a versioned migration. We rename things below; this comment must not count.

CREATE FUNCTION migrate() RETURNS void AS $$
DECLARE
  next_version int ;
BEGIN
  SELECT stage_two + 1 INTO next_version FROM schema_version ;
  IF next_version = 1 THEN
    EXECUTE 'ALTER TABLE "alpha" RENAME TO "beta"' ;
    -- unquoted identifiers fold to lower case
    EXECUTE 'ALTER TABLE beta RENAME COLUMN Old_Col TO new_col' ;
    EXECUTE 'ALTER TABLE "beta" ADD COLUMN "note" text NULL' ;
    UPDATE schema_version SET stage_two = next_version ;
  END IF ;
END ;
$$ LANGUAGE plpgsql ;

SELECT migrate() ;

DROP FUNCTION migrate() ;
