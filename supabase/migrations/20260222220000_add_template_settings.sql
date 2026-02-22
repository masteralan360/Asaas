-- Migration to add template selection columns to workspaces table
ALTER TABLE public.workspaces 
ADD COLUMN IF NOT EXISTS receipt_template TEXT DEFAULT 'primary' CHECK (receipt_template IN ('primary', 'modern')),
ADD COLUMN IF NOT EXISTS a4_template TEXT DEFAULT 'primary' CHECK (a4_template IN ('primary', 'modern'));

-- Update existing records if needed (though default handles it)
UPDATE public.workspaces SET receipt_template = 'primary', a4_template = 'primary' WHERE receipt_template IS NULL OR a4_template IS NULL;
