-- v14: rename legacy categories to the Phase 3 list. Apply together with the deploy that ships the new categorizer.
update receipts set category = 'Dining'    where category = 'Restaurant';
update receipts set category = 'Health'    where category = 'Healthcare';
update receipts set category = 'Transport' where category = 'Transportation';
update receipts set category = 'Fuel'      where category = 'Gas';
-- line items carry their own category inside line_items jsonb
update receipts r set line_items = (
  select coalesce(jsonb_agg(
    case item->>'category'
      when 'Restaurant' then jsonb_set(item, '{category}', '"Dining"')
      when 'Healthcare' then jsonb_set(item, '{category}', '"Health"')
      when 'Transportation' then jsonb_set(item, '{category}', '"Transport"')
      when 'Gas' then jsonb_set(item, '{category}', '"Fuel"')
      else item end), '[]'::jsonb)
  from jsonb_array_elements(r.line_items) item)
where jsonb_typeof(r.line_items) = 'array' and r.line_items::text ~ '"(Restaurant|Healthcare|Transportation|Gas)"';
