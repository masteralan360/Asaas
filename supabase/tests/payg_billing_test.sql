BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

SELECT is(billing.calculate_payg_amount(
  (SELECT id FROM billing.payg_pricing_versions WHERE retired_at IS NULL),
  1000000000
), 0::numeric, 'one GB is free');
SELECT is(billing.calculate_payg_amount(
  (SELECT id FROM billing.payg_pricing_versions WHERE retired_at IS NULL),
  3000000000
), 1429::numeric, 'three exact decimal GB linearly interpolate to 1,429 IQD');
SELECT is(billing.calculate_payg_amount(
  (SELECT id FROM billing.payg_pricing_versions WHERE retired_at IS NULL),
  3002000000
), 1430::numeric, 'exact bytes are used and only the final IQD amount is rounded');
SELECT is(billing.calculate_payg_amount(
  (SELECT id FROM billing.payg_pricing_versions WHERE retired_at IS NULL),
  15000000000
), 10000::numeric, 'the protected 15 GB checkpoint is exact');
SELECT is(billing.calculate_payg_amount(
  (SELECT id FROM billing.payg_pricing_versions WHERE retired_at IS NULL),
  100000000000
), 40000::numeric, 'the protected 100 GB checkpoint is exact');

SELECT throws_ok(
  $$SELECT billing.validate_payg_checkpoints('[{"gb":1,"amount_iqd":0},{"gb":15,"amount_iqd":9999},{"gb":100,"amount_iqd":40000}]'::jsonb)$$,
  '23514', 'protected_payg_pricing_checkpoints_required',
  'protected checkpoints cannot be edited'
);
SELECT throws_ok(
  $$SELECT billing.validate_payg_checkpoints('[{"gb":1,"amount_iqd":0},{"gb":15,"amount_iqd":10000},{"gb":20,"amount_iqd":9000},{"gb":100,"amount_iqd":40000}]'::jsonb)$$,
  '23514', 'invalid_payg_pricing_schedule',
  'pricing totals cannot decrease'
);

INSERT INTO public.workspaces (id, name, subscription_expires_at, data_mode)
VALUES
  ('93000000-0000-0000-0000-000000000001', 'PAYG family source', now() + interval '1 year', 'cloud'),
  ('93000000-0000-0000-0000-000000000002', 'PAYG family branch', now() + interval '1 year', 'hybrid'),
  ('93000000-0000-0000-0000-000000000003', 'PAYG free cycle', now() + interval '1 year', 'cloud'),
  ('93000000-0000-0000-0000-000000000004', 'PAYG local rejected', now() + interval '1 year', 'local'),
  ('93000000-0000-0000-0000-000000000005', 'PAYG staged monthly switch', now() + interval '1 year', 'cloud'),
  ('93000000-0000-0000-0000-000000000006', 'Existing free monthly subscription', now() + interval '1 year', 'cloud');

INSERT INTO public.workspace_branches (source_workspace_id, branch_workspace_id, name)
VALUES ('93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000002', 'PAYG branch');

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '94000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'payg-admin@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"name":"PAYG Admin","role":"admin","workspace_id":"93000000-0000-0000-0000-000000000002"}'::jsonb,
  now(), now()
);

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT lives_ok(
  $$INSERT INTO billing.workspace_payment_configurations (
    workspace_id, subscription_amount, is_payment_enabled, usage_enabled, gb_per_payment
  ) VALUES (
    '93000000-0000-0000-0000-000000000006', 0, true, false, 0
  )$$,
  'enabled zero-IQD monthly subscriptions remain valid after adding PAYG'
);
SELECT lives_ok(
  $$SELECT public.admin_upsert_workspace_payment_configuration_v2(
    '93000000-0000-0000-0000-000000000001', '0', true, false, true,
    '0', (now() + interval '1 month')::text, 'PAYG test administrator'
  )$$,
  'PAYG can be activated on the family source'
);
SELECT throws_ok(
  $$SELECT public.admin_upsert_workspace_payment_configuration_v2(
    '93000000-0000-0000-0000-000000000004', '0', true, false, true,
    '0', (now() + interval '1 month')::text, 'PAYG test administrator'
  )$$,
  '23514', 'payg_requires_cloud_or_hybrid_workspace',
  'local workspaces cannot use PAYG'
);
SELECT throws_ok(
  $$SELECT public.admin_upsert_workspace_payment_configuration_v2(
    '93000000-0000-0000-0000-000000000002', '0', true, false, true,
    '0', (now() + interval '1 month')::text, 'PAYG test administrator'
  )$$,
  '23514', 'payg_is_managed_by_source_workspace',
  'a branch cannot own the family PAYG toggle'
);
SELECT is((SELECT count(*) FROM billing.payg_cycles WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000001' AND status = 'open'), 1::bigint, 'activation creates exactly one open family cycle');
SELECT is((SELECT data_transfer_bytes FROM public.workspace_usage WHERE workspace_id = '93000000-0000-0000-0000-000000000001'), 0::bigint, 'activation starts the native charged counter clean');
SELECT results_eq(
  $$SELECT monthly_data_transfer_limit_bytes, tracking_only FROM public.workspace_usage_limits WHERE workspace_id = '93000000-0000-0000-0000-000000000001'$$,
  $$VALUES (NULL::bigint, true)$$,
  'PAYG tracks native charged usage without enforcing a transfer allowance'
);

SELECT is(
  public.apply_workspace_charged_usage(
    '93000000-0000-0000-0000-000000000002', 3000000000, 'tauri', 'payg-test', gen_random_uuid()
  ),
  3000000000::bigint,
  'a branch records PAYG usage through the app native charged-usage counter'
);
SELECT is(
  (SELECT data_transfer_bytes FROM public.workspace_usage WHERE workspace_id = '93000000-0000-0000-0000-000000000001'),
  3000000000::bigint,
  'branch usage accumulates on the source-owned family counter'
);
UPDATE billing.payg_cycles SET renewal_due_at = now() - interval '1 second'
WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000001' AND status = 'open';
UPDATE billing.workspace_payment_configurations SET renewal_due_at = now() - interval '1 second'
WHERE workspace_id = '93000000-0000-0000-0000-000000000001';
SELECT lives_ok(
  $$SELECT billing.close_due_payg_cycle('93000000-0000-0000-0000-000000000001')$$,
  'a due cycle closes atomically'
);
SELECT results_eq(
  $$SELECT charged_usage_bytes, amount_iqd, status FROM billing.payg_cycles WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000001'$$,
  $$VALUES (3000000000::bigint, 1429::numeric, 'awaiting_payment'::text)$$,
  'cycle closure freezes exact usage, rounded amount, and awaiting-payment state'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"94000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.submit_workspace_payg_payment('fib', 'PAYG TEST ADMIN')$$,
  'a branch workspace administrator can submit the shared exact PAYG payment'
);
SELECT lives_ok(
  $$SELECT public.submit_workspace_payg_payment('fib', 'PAYG TEST ADMIN')$$,
  'duplicate PAYG submission is idempotent for the same administrator'
);
RESET ROLE;
SELECT is((SELECT count(*) FROM billing.payment_transactions WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000001' AND status = 'pending'), 1::bigint, 'family concurrency guard permits one pending payment');
SELECT results_eq(
  $$SELECT amount, billed_usage_bytes, billed_usage_gb, payment_type FROM billing.payment_transactions WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000001'$$,
  $$VALUES (1429::numeric, 3000000000::bigint, 3::numeric, 'payg'::text)$$,
  'the pending transaction is an immutable exact cycle snapshot'
);

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT lives_ok(
  format(
    'SELECT public.admin_review_workspace_payment_transaction_v2(%L::uuid, %L, %L, %L, %L)',
    (SELECT id FROM billing.payment_transactions WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000001'),
    'approved', 'Verified', 'PAYG reviewer', 'PAYG-TEST-1'
  ),
  'approval settles the frozen PAYG cycle'
);
SELECT is((SELECT data_transfer_bytes FROM public.workspace_usage WHERE workspace_id = '93000000-0000-0000-0000-000000000001'), 0::bigint, 'approval resets only the native charged-usage counter');
SELECT is((SELECT count(*) FROM billing.payg_cycles WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000001' AND status = 'paid'), 1::bigint, 'paid history remains immutable');
SELECT is((SELECT count(*) FROM billing.payg_cycles WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000001' AND status = 'open'), 1::bigint, 'approval starts one clean next cycle');
SELECT ok(
  (SELECT renewal_due_at > now() + interval '27 days' FROM billing.payg_cycles WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000001' AND status = 'open'),
  'approval advances Renewal due by one month from the later of the old deadline or approval time'
);

-- Rejection leaves the frozen obligation open and permits a fresh exact submission.
UPDATE public.workspace_usage SET data_transfer_bytes = 2000000000
WHERE workspace_id = '93000000-0000-0000-0000-000000000001';
UPDATE billing.payg_cycles SET renewal_due_at = now() - interval '1 second'
WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000001' AND status = 'open';
UPDATE billing.workspace_payment_configurations SET renewal_due_at = now() - interval '1 second'
WHERE workspace_id = '93000000-0000-0000-0000-000000000001';
SELECT billing.close_due_payg_cycle('93000000-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"94000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT public.submit_workspace_payg_payment('qicard', 'PAYG TEST ADMIN');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT lives_ok(
  format(
    'SELECT public.admin_review_workspace_payment_transaction_v2(%L::uuid, %L, %L, %L, NULL)',
    (SELECT id FROM billing.payment_transactions WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000001' AND status = 'pending'),
    'rejected', 'Reference did not match', 'PAYG reviewer'
  ),
  'a PAYG payment can be rejected without changing the obligation'
);
SELECT is((SELECT status FROM billing.payg_cycles WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000001' AND status = 'awaiting_payment'), 'awaiting_payment', 'rejection keeps the closed cycle awaiting payment');
SELECT is((SELECT payment_transaction_id FROM billing.payg_cycles WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000001' AND status = 'awaiting_payment'), NULL::uuid, 'rejection unlinks the rejected submission');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"94000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.submit_workspace_payg_payment('fib', 'PAYG TEST ADMIN')$$,
  'a fresh exact submission is allowed after rejection'
);
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

CREATE TEMP TABLE payg_test_version AS
SELECT id, version_number FROM billing.payg_pricing_versions WHERE retired_at IS NULL;
SELECT throws_ok(
  $$UPDATE billing.payg_pricing_versions SET checkpoints = '[{"gb":1,"amount_iqd":0},{"gb":15,"amount_iqd":10000},{"gb":100,"amount_iqd":39999}]'::jsonb WHERE retired_at IS NULL$$,
  '23514', 'payg_pricing_version_is_immutable',
  'a published pricing version cannot be edited in place'
);
SELECT lives_ok(
  $$SELECT public.admin_publish_payg_pricing_schedule(
    '[{"gb":1,"amount_iqd":0},{"gb":5,"amount_iqd":8000},{"gb":15,"amount_iqd":10000},{"gb":100,"amount_iqd":40000}]'::jsonb,
    'PAYG pricing publisher'
  )$$,
  'a valid intermediate checkpoint publishes atomically as a new version'
);
SELECT is(
  (SELECT pricing_version_id FROM billing.payg_cycles WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000001' AND status = 'awaiting_payment'),
  (SELECT id FROM payg_test_version),
  'an already-opened cycle retains its frozen pricing version after publish'
);
SELECT lives_ok(
  format(
    'SELECT public.admin_review_workspace_payment_transaction_v2(%L::uuid, %L, NULL, %L, %L)',
    (SELECT id FROM billing.payment_transactions WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000001' AND status = 'pending'),
    'approved', 'PAYG reviewer', 'PAYG-TEST-2'
  ),
  'the replacement submission can be approved'
);
SELECT is(
  (SELECT pricing_version_number FROM billing.payg_cycles WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000001' AND status = 'open'),
  (SELECT version_number FROM billing.payg_pricing_versions WHERE retired_at IS NULL),
  'the next clean cycle uses the newly published pricing version'
);

-- A PAYG-to-monthly change with accrued usage is staged through settlement.
SELECT public.admin_upsert_workspace_payment_configuration_v2(
  '93000000-0000-0000-0000-000000000005', '0', true, false, true,
  '0', (now() + interval '1 month')::text, 'PAYG test administrator'
);
SELECT public.apply_workspace_charged_usage(
  '93000000-0000-0000-0000-000000000005', 2000000000, 'tauri', 'payg-test', gen_random_uuid()
);
SELECT public.admin_upsert_workspace_payment_configuration_v2(
  '93000000-0000-0000-0000-000000000005', '50000', true, false, false,
  '0', NULL, 'PAYG test administrator'
);
SELECT results_eq(
  $$SELECT payg_enabled, pending_billing_mode FROM billing.workspace_payment_configurations WHERE workspace_id = '93000000-0000-0000-0000-000000000005'$$,
  $$VALUES (true, 'monthly'::text)$$,
  'switching away with accrued usage keeps PAYG active and stages Monthly subscription'
);
UPDATE billing.payg_cycles SET renewal_due_at = now() - interval '1 second'
WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000005' AND status = 'open';
UPDATE billing.workspace_payment_configurations SET renewal_due_at = now() - interval '1 second'
WHERE workspace_id = '93000000-0000-0000-0000-000000000005';
SELECT billing.close_due_payg_cycle('93000000-0000-0000-0000-000000000005');
UPDATE public.profiles SET workspace_id = '93000000-0000-0000-0000-000000000005'
WHERE id = '94000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"94000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT public.submit_workspace_payg_payment('fib', 'PAYG TEST ADMIN');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT public.admin_review_workspace_payment_transaction_v2(
  (SELECT id FROM billing.payment_transactions WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000005' AND status = 'pending'),
  'approved', 'Verified', 'PAYG reviewer', 'PAYG-TO-MONTHLY'
);
SELECT results_eq(
  $$SELECT payg_enabled, usage_enabled, subscription_amount FROM billing.workspace_payment_configurations WHERE workspace_id = '93000000-0000-0000-0000-000000000005'$$,
  $$VALUES (false, false, 50000::numeric)$$,
  'approval applies the staged 50,000 IQD Monthly subscription outside PAYG'
);
SELECT is((SELECT count(*) FROM billing.payg_cycles WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000005' AND status = 'open'), 0::bigint, 'a staged switch does not start another PAYG cycle');
SELECT is((SELECT data_transfer_bytes FROM public.workspace_usage WHERE workspace_id = '93000000-0000-0000-0000-000000000005'), 0::bigint, 'settlement leaves the audited native counter clean');

SELECT lives_ok(
  $$SELECT public.admin_upsert_workspace_payment_configuration_v2(
    '93000000-0000-0000-0000-000000000003', '0', true, false, true,
    '0', (now() + interval '1 month')::text, 'PAYG test administrator'
  )$$,
  'a second PAYG family can be activated'
);
UPDATE public.workspace_usage SET data_transfer_bytes = 1000000000
WHERE workspace_id = '93000000-0000-0000-0000-000000000003';
UPDATE billing.payg_cycles SET renewal_due_at = now() - interval '1 second'
WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000003' AND status = 'open';
UPDATE billing.workspace_payment_configurations SET renewal_due_at = now() - interval '1 second'
WHERE workspace_id = '93000000-0000-0000-0000-000000000003';
SELECT lives_ok(
  $$SELECT billing.close_due_payg_cycle('93000000-0000-0000-0000-000000000003')$$,
  'a free-threshold cycle auto-settles'
);
SELECT is((SELECT count(*) FROM billing.payg_cycles WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000003' AND status = 'no_payment_required'), 1::bigint, 'zero-IQD cycles retain no-payment-required audit history');
SELECT is((SELECT count(*) FROM billing.payment_transactions WHERE billing_workspace_id = '93000000-0000-0000-0000-000000000003'), 0::bigint, 'zero-IQD cycles do not create payment submissions');

SELECT * FROM finish();
ROLLBACK;
