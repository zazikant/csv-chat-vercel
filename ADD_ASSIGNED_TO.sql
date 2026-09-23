-- Add 'assigned_to' text[] column to main_contacts
ALTER TABLE public.main_contacts ADD COLUMN IF NOT EXISTS assigned_to text[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS main_contacts_assigned_to_gin_idx ON public.main_contacts USING gin (assigned_to);
