-- Follow only the selected imported component subtree during scoped edit reads.
CREATE INDEX idx_icalendar_components_parent
ON icalendar_components(parent_component_id);
