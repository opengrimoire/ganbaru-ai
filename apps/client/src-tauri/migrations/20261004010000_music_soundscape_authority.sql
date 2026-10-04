-- Automatic background intent is restored only by the native phase owner.
ALTER TABLE music_soundscape_state
ADD COLUMN automatic_intent INTEGER NOT NULL DEFAULT 0 CHECK (automatic_intent IN (0, 1));
