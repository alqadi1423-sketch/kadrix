-- The audit log is append-only. Two narrow exceptions exist so that foreign
-- keys keep working: deleting a whole workspace cascades to its log, and
-- deleting a user sets actor_id to NULL. Everything else is rejected.
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
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
