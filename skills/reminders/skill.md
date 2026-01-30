# Skill: Reminders

Manage your reminders using helper scripts. Always use these scripts instead of manual file editing.

## Reminders File Path
The canonical reminders file is at: `{{REMINDERS_FILE_PATH}}`

## Operations

### 1. List Reminders
Always start by listing reminders to see current state and IDs.
`node skills/reminders/list.js`

### 2. Add a Reminder
`node skills/reminders/add.js <date> <time> <recur> "<message>"`

- `date`: YYYY-MM-DD (e.g., 2026-02-15)
- `time`: HH:MM (24h, e.g., 14:00)
- `recur`: one of `none`, `daily`, `weekly`, `monthly`
- `message`: Double-quoted string.

Example: `node skills/reminders/add.js 2026-02-15 09:00 none "Buy groceries"`

### 3. Update a Reminder
Modify an existing reminder by its ID. You must provide ALL fields.
`node skills/reminders/update.js <id> <date> <time> <recur> "<message>"`

Example: `node skills/reminders/update.js rid_K5V4M2J9Q2ZP 2026-02-15 10:00 none "Buy groceries and milk"`

### 4. Delete a Reminder
Remove a reminder by its ID.
`node skills/reminders/delete.js <id>`

Example: `node skills/reminders/delete.js rid_K5V4M2J9Q2ZP`

## Important Notes
- All times are **Europe/London**.
- The scheduler scans the file once per minute.
- One-off reminders (`recur=none`) are automatically deleted after firing.
- Confirm the action taken to the user by repeating the script's confirmation message.
