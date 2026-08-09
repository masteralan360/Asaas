# Product variants

Variants are normal products with a nullable `parentProductId` relationship to
their sellable parent product. Each product keeps its own barcode, image, price,
cost, stock, inventory transactions, and return settings. A SKU can be shared
only within one family: its parent product and that parent's direct variants.
Separate parent products and independent products must use a different SKU.

The relationship is one level deep: only an unlinked product can be a parent,
and a product with variants cannot itself become a variant. Deleting a parent
unlinks its active variants instead of deleting or changing their product data.
If two variants share the same SKU, they must be given distinct SKUs before the
parent can be deleted or either variant can be unlinked.

The product editor is the management surface. Saved root products show a
Variants section that can create a new linked product or link an eligible,
existing product. A variant editor shows its parent and allows unlinking.
