DELETE FROM public.profiles WHERE workspace_id IN (
  'a79ee9c6-b1a8-4e8a-b246-6b05288f29bd',
  'b31bb707-2817-4d72-8f48-1a963e7f7bb3'
);

DELETE FROM public.workspaces WHERE id IN (
  'a79ee9c6-b1a8-4e8a-b246-6b05288f29bd',
  'b31bb707-2817-4d72-8f48-1a963e7f7bb3'

);
