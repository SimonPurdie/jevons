# TOOLS.md - Local Notes

Skills define *how* tools work. This file is for *your* specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:
- Camera names and locations
- SSH hosts and aliases  
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras
- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH
- home-server → 192.168.1.100, user: admin

### TTS
- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

## Available Skills

- ~/projects/jevons/skills/
- Before using a skill:
  - list the contents of its folder
  - read the SKILL.md
- **brave-search** – Use when you need a quick web search or article extraction without leaving this environment.
- **reminders** – Use to list, add, or otherwise manage reminders through the dedicated helper scripts.

## PowerShell from WSL
- Helper script: `wpwsh`
- Location: `~/.local/bin/wpwsh`
- Purpose: Run **Windows PowerShell** from inside WSL, non-interactively
- Implementation:
  ```bash
  #!/usr/bin/env bash
  "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe" -NoLogo -NoProfile "$@"
  ```
- Usage examples:
  - `wpwsh -Command "$PSVersionTable"`
  - `wpwsh -Command "Get-ChildItem C:\"`

---

Add whatever helps you do your job. This is your cheat sheet.
