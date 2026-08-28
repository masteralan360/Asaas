-- The status never represented a separate operational step. Normalize any
-- legacy records before removing it from the active shipment state machine.
update delivery.delivery_shipment_events
set previous_status = 'received'
where previous_status = 'ready_for_dispatch';

update delivery.delivery_shipment_events
set status = 'received'
where status = 'ready_for_dispatch';

update delivery.delivery_shipments
set status = 'received'
where status = 'ready_for_dispatch';

alter table delivery.delivery_shipments
  drop constraint if exists delivery_shipments_status_check;

alter table delivery.delivery_shipments
  add constraint delivery_shipments_status_check
  check (status in ('received', 'assigned', 'delivered', 'postponed', 'returned', 'cancelled'));

alter table delivery.delivery_shipment_events
  drop constraint if exists delivery_shipment_events_previous_status_check,
  drop constraint if exists delivery_shipment_events_status_check;

alter table delivery.delivery_shipment_events
  add constraint delivery_shipment_events_previous_status_check
  check (previous_status is null or previous_status in ('received', 'assigned', 'delivered', 'postponed', 'returned', 'cancelled')),
  add constraint delivery_shipment_events_status_check
  check (status in ('received', 'assigned', 'delivered', 'postponed', 'returned', 'cancelled'));

notify pgrst, 'reload schema';
