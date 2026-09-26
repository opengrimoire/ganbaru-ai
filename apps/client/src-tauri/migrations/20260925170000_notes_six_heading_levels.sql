-- Widen heading support without rebuilding parent tables or disabling foreign keys.
-- The migration runner commits the column copy and constraint replacement atomically.

ALTER TABLE notes_blocks ADD COLUMN expanded_type TEXT NOT NULL DEFAULT 'paragraph' CHECK (
        expanded_type IN (
            'paragraph',
            'heading_1',
            'heading_2',
            'heading_3',
            'heading_4',
            'heading_5',
            'heading_6',
            'bulleted_list_item',
            'numbered_list_item',
            'to_do',
            'toggle',
            'callout',
            'quote',
            'child_page',
            'child_database',
            'breadcrumb',
            'table_of_contents',
            'column_list',
            'column',
            'table',
            'table_row',
            'tab',
            'image',
            'video',
            'audio',
            'file',
            'pdf',
            'bookmark',
            'link_preview',
            'synced_block',
            'template',
            'button',
            'embed',
            'equation',
            'divider',
            'code',
            'unsupported'
        )
    );
UPDATE notes_blocks SET expanded_type = type;
ALTER TABLE notes_blocks DROP COLUMN type;
ALTER TABLE notes_blocks RENAME COLUMN expanded_type TO type;

ALTER TABLE notes_page_template_blocks ADD COLUMN expanded_type TEXT NOT NULL DEFAULT 'paragraph' CHECK (
        expanded_type IN (
            'paragraph',
            'heading_1',
            'heading_2',
            'heading_3',
            'heading_4',
            'heading_5',
            'heading_6',
            'bulleted_list_item',
            'numbered_list_item',
            'to_do',
            'toggle',
            'callout',
            'quote',
            'child_page',
            'child_database',
            'breadcrumb',
            'table_of_contents',
            'column_list',
            'column',
            'table',
            'table_row',
            'tab',
            'image',
            'video',
            'audio',
            'file',
            'pdf',
            'bookmark',
            'link_preview',
            'synced_block',
            'template',
            'button',
            'embed',
            'equation',
            'divider',
            'code',
            'unsupported'
        )
    );
UPDATE notes_page_template_blocks SET expanded_type = type;
ALTER TABLE notes_page_template_blocks DROP COLUMN type;
ALTER TABLE notes_page_template_blocks RENAME COLUMN expanded_type TO type;
