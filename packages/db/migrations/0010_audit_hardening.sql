-- Tighter audit log guard: setting actor_id to NULL is only allowed when
-- that user no longer exists (the foreign key's ON DELETE SET NULL), and
-- TRUNCATE is refused outright.
CREATE OR REPLACE FUNCTION audit_log_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM workspace WHERE id = OLD.workspace_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit_log is append-only';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.actor_id IS NULL
       AND OLD.actor_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "user" WHERE id = OLD.actor_id)
       AND NEW.id = OLD.id
       AND NEW.workspace_id = OLD.workspace_id
       AND NEW.action = OLD.action
       AND NEW.target_type IS NOT DISTINCT FROM OLD.target_type
       AND NEW.target_id IS NOT DISTINCT FROM OLD.target_id
       AND NEW.data = OLD.data
       AND NEW.created_at = OLD.created_at THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'audit_log is append-only';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_log_no_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_no_truncate();
