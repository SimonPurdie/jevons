# Jevons

Jevons is a streamlined AI assistant built on [pi-mono](https://github.com/badlogic/pi-mono). 

It has a minimal tool surface and a simple memory system.

Designed for simplicity, ease of interaction, elegance of design, and to be easy to maintain and extend.

## Architecture

### Core Components

- **Discord Integration**: The primary mode of interaction with the assistant is in a dedicated discord channel, or threads within that channel.
- **pi-mono Agent Runtime**: A framework providing off-the-shelf handling for agentic loops, providers, models, tools and skills. I highly recommend using pi to build your own agents/assistants!
- **Barebones Memory System**: Simple markdown conversation logs accessible by the assistant, and self-maintained long-term memory.
- **Reminder Service**: Cron-driven scheduling system with a calendar/diary stored in markdown. Simple, reliable, stored in a format that can be viewed and altered by humans (mine is inside my Obsidian vault).

## Usage

### Discord Commands

- `/new` - End current context window and reset chat history (creates new log file)

### CLI

```jevons``` starts the assistant as a foreground process

```jevons --options``` to configure models/providers

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.