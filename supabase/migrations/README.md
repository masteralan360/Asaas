# Migration rules

- Add only production schema or data transitions here; do not add test cleanup scripts or manual rollback scripts.
- Name new migrations `YYYYMMDDHHMMSS_description.sql` so each has a unique version.
- Treat an applied migration as immutable. Follow it with a new forward-only migration instead of editing or replacing it.
- Keep one final migration for each function rewrite when an intermediate revision has not been deployed.

The older short-date migration names are retained as historical compatibility files. New migrations must use the full timestamp format.
