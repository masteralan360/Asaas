-- Seed data for public schema configuration tables

-- App Permissions
INSERT INTO public.app_permissions (key_name, key_value) VALUES
('registration_passkey', '8KZ5XqC2r9WW6YpB7nD4AdTMV'),
('admin_passkey', '8KZ5XqC2r9WW6YpB7nD4AdTMV'),
('staff_passkey', 'Q7mA4ZxK9VnP9R2dc8TWBHY6E'),
('viewer_passkey', 'N6V9QZ6xR5YB7T5D4C2AWHpK'),
('super_admin_passkey', 'F7mQ4ZKx9h8aB5YtC6RDP4VJH'),
('connection_admin', 'Q9FZ7bM4K8xYtH6PVa5R2CJDW')
ON CONFLICT (key_name) DO UPDATE SET key_value = EXCLUDED.key_value;
