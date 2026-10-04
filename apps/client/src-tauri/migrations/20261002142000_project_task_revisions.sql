ALTER TABLE project_tasks ADD COLUMN revision INTEGER NOT NULL DEFAULT 0
    CHECK (revision >= 0 AND revision <= 9007199254740991);

CREATE TRIGGER project_task_revision_after_update
AFTER UPDATE ON project_tasks
WHEN NEW.revision = OLD.revision
BEGIN
    UPDATE project_tasks SET revision = OLD.revision + 1 WHERE id = NEW.id;
END;
