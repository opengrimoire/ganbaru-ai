CREATE TABLE project_reorder_receipts (
    operation_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_json TEXT NOT NULL,
    response_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX project_reorder_receipts_project ON project_reorder_receipts(project_id);

ALTER TABLE project_custom_fields ADD COLUMN revision INTEGER NOT NULL DEFAULT 0
    CHECK (revision BETWEEN 0 AND 9007199254740991);
ALTER TABLE project_custom_field_options ADD COLUMN revision INTEGER NOT NULL DEFAULT 0
    CHECK (revision BETWEEN 0 AND 9007199254740991);

CREATE TRIGGER project_custom_field_revision AFTER UPDATE ON project_custom_fields
WHEN NEW.revision = OLD.revision
BEGIN
    UPDATE project_custom_fields SET revision = OLD.revision + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER project_custom_field_option_revision AFTER UPDATE ON project_custom_field_options
WHEN NEW.revision = OLD.revision
BEGIN
    UPDATE project_custom_field_options SET revision = OLD.revision + 1 WHERE id = NEW.id;
END;
