ALTER TABLE music_playlists
ADD COLUMN mix_enabled INTEGER NOT NULL DEFAULT 0 CHECK (mix_enabled IN (0, 1));
