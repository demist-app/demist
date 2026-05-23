# Demist Backend

Supabase edge functions for the Demist backend.

## Functions
- `transcribe` — receives audio chunk, returns transcript via Whisper
- `detect-terms` — receives transcript chunk, returns unfamiliar terms with definitions
- `generate-summary` — receives session id, returns post-lecture summary
