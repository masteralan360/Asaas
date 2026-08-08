# Jumla Khaleej standalone storefront

The standalone Vercel frontend lives in `E:\ERP System\JumlaKhaleej`. It is
bound to one Atlas workspace through the `jumla-khaleej` row in
`public.website_storefront_configs`.

## Catalog rules

The backend does not trust a workspace or price book sent by the visitor.
It resolves the site configuration and then applies the requested mode:

- `retail`: every inventory product in the selected marketplace storage, using
  its normal/base product price, regardless of price-book membership.
- `wholesale`: inventory products in the configured wholesale price book,
  using that book's prices.

Orders persist the selected `storefront_mode`, price book, source domain, and
idempotent checkout request id alongside the normal marketplace-order data.

## Deployment order

1. Apply `20260808080824_add_jumla_khaleej_storefront.sql` to the Atlas
   Supabase project.
2. Set a strong `WEBSITE_STOREFRONT_GATEWAY_SECRET` Supabase Edge Function
   secret. Do not put this value in frontend code.
3. Deploy `get-bound-storefront-catalog` and
   `place-bound-storefront-order`.
4. In the standalone Vercel project, set the matching
   `ATLAS_STOREFRONT_GATEWAY_SECRET`, plus `ATLAS_SUPABASE_URL`,
   `ATLAS_SUPABASE_ANON_KEY`, and
   `NEXT_PUBLIC_SITE_URL=https://khaleejbeauty.vercel.app`.
5. Confirm both retail and wholesale have products in the designated
   marketplace storage, then submit an inquiry order in each mode.

Before a production custom domain is enabled, update the config row's
`primary_domain` and `NEXT_PUBLIC_SITE_URL` together. The Atlas functions will
reject an origin that does not exactly match `primary_domain`.
