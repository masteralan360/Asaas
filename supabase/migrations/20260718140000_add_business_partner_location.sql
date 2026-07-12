-- Store a business partner's geographic location as decimal degrees (DD).
-- Both columns are optional and only populated when the user designates a
-- location from the partner form's map picker.

ALTER TABLE crm.business_partners
  ADD COLUMN IF NOT EXISTS latitude numeric NULL,
  ADD COLUMN IF NOT EXISTS longitude numeric NULL;

COMMENT ON COLUMN crm.business_partners.latitude IS
  'Partner location latitude in decimal degrees (WGS84). NULL when unset.';
COMMENT ON COLUMN crm.business_partners.longitude IS
  'Partner location longitude in decimal degrees (WGS84). NULL when unset.';

ALTER TABLE crm.business_partners
  DROP CONSTRAINT IF EXISTS business_partners_latitude_range_check;

ALTER TABLE crm.business_partners
  ADD CONSTRAINT business_partners_latitude_range_check
  CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));

ALTER TABLE crm.business_partners
  DROP CONSTRAINT IF EXISTS business_partners_longitude_range_check;

ALTER TABLE crm.business_partners
  ADD CONSTRAINT business_partners_longitude_range_check
  CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));
