DO $$
DECLARE
  template_style_schema text;
BEGIN
  SELECT namespace.nspname
    INTO template_style_schema
  FROM pg_type AS typ
  JOIN pg_namespace AS namespace
    ON namespace.oid = typ.typnamespace
  WHERE typ.typname = 'template_style'
  LIMIT 1;

  IF template_style_schema IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_enum AS enm
      JOIN pg_type AS typ
        ON typ.oid = enm.enumtypid
      JOIN pg_namespace AS namespace
        ON namespace.oid = typ.typnamespace
      WHERE namespace.nspname = template_style_schema
        AND typ.typname = 'template_style'
        AND enm.enumlabel = 'professional'
    )
  THEN
    EXECUTE format(
      'ALTER TYPE %I.template_style ADD VALUE %L',
      template_style_schema,
      'professional'
    );
  END IF;
END $$;
