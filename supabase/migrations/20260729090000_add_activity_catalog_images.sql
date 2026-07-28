-- Optional image shown for activity cards in the POS Activities storage.
ALTER TABLE activities.activity_catalog
  ADD COLUMN IF NOT EXISTS image_url text NULL;
