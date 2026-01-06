-- Secure Registration Passkey Setup

-- 1. Create a secure table to store the valid registration keys
create table if not exists public.app_permissions (
    key_name text primary key,
    key_value text not null
);

-- 2. Insert the specific passkeys for each role
insert into public.app_permissions (key_name, key_value)
values 
    ('admin_passkey', '8KZ5XqC2r9WW6YpB7nD4AdTMV'),
    ('staff_passkey', 'Q7mA4ZxK9VnP9R2dc8TWBHY6E'),
    ('viewer_passkey', 'N6V9QZ6xR5YB7T5D4C2AWHpK')
on conflict (key_name) do update set key_value = excluded.key_value;

-- Enable RLS to prevent public reading of this table directly
alter table public.app_permissions enable row level security;

-- 3. Create a User-Defined Function to validate the passkey based on role
create or replace function public.check_registration_passkey()
returns trigger
language plpgsql
security definer
as $$
declare
    provided_key text;
    requested_role text;
    required_key_name text;
    valid_key text;
begin
    -- Extract the passkey and role from the user_metadata sent by the client
    provided_key := NEW.raw_user_meta_data->>'passkey';
    requested_role := NEW.raw_user_meta_data->>'role';
    
    -- Determine which key to check against
    case requested_role
        when 'admin' then required_key_name := 'admin_passkey';
        when 'staff' then required_key_name := 'staff_passkey';
        when 'viewer' then required_key_name := 'viewer_passkey';
        else raise exception 'Invalid role requested: %', requested_role;
    end case;

    -- Get the valid key from our configuration table
    select key_value into valid_key 
    from public.app_permissions 
    where key_name = required_key_name;

    if valid_key is null then
        raise exception 'System Error: Passkey for role % is not configured.', requested_role;
    end if;

    -- Perform the validation
    if provided_key is null or provided_key != valid_key then
        raise exception 'Invalid Access Code: You must provide the correct % passkey to register.', requested_role;
    end if;

    return NEW;
end;
$$;

-- 4. Attach the trigger to the auth.users table
drop trigger if exists ensure_registration_passkey on auth.users;

create trigger ensure_registration_passkey
    before insert on auth.users
    for each row execute function public.check_registration_passkey();

