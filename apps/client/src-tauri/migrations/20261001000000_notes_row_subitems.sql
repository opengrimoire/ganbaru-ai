CREATE TABLE notes_data_source_row_hierarchy (
    row_page_id TEXT PRIMARY KEY REFERENCES notes_pages(id) ON DELETE CASCADE,
    data_source_id TEXT NOT NULL REFERENCES notes_data_sources(id) ON DELETE CASCADE,
    parent_row_page_id TEXT NOT NULL REFERENCES notes_pages(id) ON DELETE CASCADE,
    CHECK (row_page_id <> parent_row_page_id)
);

CREATE INDEX notes_row_hierarchy_source_parent
    ON notes_data_source_row_hierarchy(data_source_id, parent_row_page_id, row_page_id);

CREATE TRIGGER notes_row_hierarchy_detach_moved_page
AFTER UPDATE OF parent_type, parent_data_source_id ON notes_pages
BEGIN
    DELETE FROM notes_data_source_row_hierarchy
    WHERE (row_page_id = NEW.id OR parent_row_page_id = NEW.id)
      AND (NEW.parent_type <> 'data_source_id'
        OR NEW.parent_data_source_id IS NULL
        OR data_source_id <> NEW.parent_data_source_id);
END;
