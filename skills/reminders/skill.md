# Skill: Reminders

You can create, modify, and delete reminders by interacting with a specific markdown file using the `bash` tool.

## Reminders File Format
Each reminder is a single line:
`- [ ] date=YYYY-MM-DD time=HH:MM recur=none|daily|weekly|monthly msg="..." id=RID`

- `date`: YYYY-MM-DD (UK Local Time)
- `time`: HH:MM (UK Local Time, 24h)
- `recur`: One of `none`, `daily`, `weekly`, `monthly`
- `msg`: The message in double quotes. Use `\"` for internal quotes.
- `id`: Unique identifier (e.g., `rid_K5V4M2J9Q2ZP`). You can omit this when creating; the scheduler will assign one.

## Operations

### 1. Create a Reminder
Append a new line to the file.
Example: `echo "- [ ] date=2026-02-01 time=09:00 recur=none msg=\"Buy milk\"" >> {{REMINDERS_FILE_PATH}}`

### 2. List Reminders
Read the file.
Example: `cat {{REMINDERS_FILE_PATH}}`

### 3. Delete a Reminder
Remove the line containing the specific `id`.
Example: `grep -v "id=rid_K5V4M2J9Q2ZP" {{REMINDERS_FILE_PATH}} > {{REMINDERS_FILE_PATH}}.tmp && mv {{REMINDERS_FILE_PATH}}.tmp {{REMINDERS_FILE_PATH}}`

### 4. Modify a Reminder
Replace the line or delete and re-add.

## Important Notes
- All times are **Europe/London**.
- The scheduler scans this file once per minute.
- One-off reminders are automatically deleted after they fire.
- Always confirm to the user the exact line you wrote or the action you took.
