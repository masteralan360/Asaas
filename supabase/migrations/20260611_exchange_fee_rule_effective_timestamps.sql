ALTER TABLE fx.exchange_fee_rules
  ALTER COLUMN effective_start_date TYPE timestamp with time zone
  USING (effective_start_date::timestamp AT TIME ZONE 'UTC'),
  ALTER COLUMN effective_end_date TYPE timestamp with time zone
  USING (
    CASE
      WHEN effective_end_date IS NULL THEN NULL
      ELSE ((effective_end_date::timestamp + interval '1 day' - interval '1 millisecond') AT TIME ZONE 'UTC')
    END
  );
