# Galdr

CLI tool that combines multiple AI coding assistants (Claude, Gemini, Copilot, Cursor) with automatic provider switching and persistent context.

**Note: This tool is not stable yet. Expect bugs & breaking changes.**

## Features

- **Interactive Chat**: Full-screen terminal interface with colored provider badges and streaming responses
- **Automatic Provider Switching**: Switches between AI providers when token limits are reached
- **Persistent Context**: Conversation history stored in `.galdr` folder
  - Restored on startup with message count notification
  - Full conversation history sent to providers
- **History Management**:
  - Auto-compact at 50 messages (keeps 20 most recent, summarizes older ones using available LLM)
  - Manual compact with `/compact [N]` - creates AI-generated summary of removed messages
  - Requires at least one LLM to be available (claude, gemini, copilot, or cursor) - will error if none available
  - Statistics via `/history` command
- **Switch Modes**:
  - **Rollover**: Switch to next provider when token limit reached
  - **Manual**: User chooses provider
  - **Round-robin**: Cycle through providers for each request
  - Change modes in-chat with `/mode <mode>`
- **Usage Tracking**: Per-provider request counts
- **No Configuration Required**: Uses existing CLI tools (claude, gemini, copilot, cursor)

## Prerequisites

Install at least one of the following AI CLI tools:

- [Claude CLI](https://claude.com/claude-code)
- [Gemini CLI](https://github.com/google/generative-ai-cli)
- [GitHub Copilot CLI](https://githubnext.com/projects/copilot-cli)
- [Cursor CLI](https://www.cursor.com) Note: Very basic support

## Installation

```bash
npm install
npm run build

# Optionally link globally
npm link
```

## Usage

### Interactive Chat Mode

```bash
# Start interactive chat (default command)
galdr

# Or explicitly use the chat command
galdr chat

# Start with initial prompt
galdr "explain how async/await works in JavaScript"

# Use specific provider
galdr --provider gemini
```

Available commands:

- `/exit` or `/quit` - Exit chat
- `/switch <provider>` - Switch provider (claude, gemini, copilot, cursor)
- `/mode <mode>` - Change switch mode (manual, rollover, round-robin)
- `/model <provider> <model>` - Set model for a provider (e.g., `/model copilot claude-sonnet-4.5`)
- `/clear` - Clear history and screen
- `/compact [keep]` - Compact history, keep N recent messages (default: 10)
- `/history` - Show statistics (message count, size, age, auto-compact status)
- `/status` - Show provider availability and usage
- `/verbose` - Toggle verbose output mode
- `/help` - Show commands
- `/sessions` - List all saved sessions
- `/session-new <name> [description]` - Create a new session
- `/session-load <name>` - Switch to an existing session
- `/session-save [description]` - Save the current session
- `/session-delete <name>` - Delete a session
- `/session-rename <old-name> <new-name>` - Rename a session

Chat interface:
- Full-screen UI adapts to terminal size
- Provider badges indicate active AI
- Streaming responses
- Automatic provider fallback on token limits
- Conversation history restored on startup
- Full conversation context sent to providers
- Notifications for provider switches and auto-compaction
- Auto-compact at 50 messages

### Context Management

```bash
# Show conversation history
galdr context --show

# Clear conversation context
galdr context --clear

# Compact context (keep last 10 messages)
galdr context --compact 10
```

### Status

```bash
# Check provider availability and usage stats
galdr status
```

## How It Works

1. **Context Persistence**: Conversations saved in `.galdr/context.json`
   - Messages saved after each exchange
   - Context restored on startup
   - Full conversation history sent to providers

2. **Provider Wrapping**: Spawns CLI tools (claude, gemini, copilot, cursor) as child processes

3. **Provider Switching**: Detects token limit errors and switches based on configured mode

4. **Auto-compact**: Triggered when message count exceeds 50
   - Keeps 20 most recent messages
   - Summarizes older messages using first available LLM (claude > gemini > copilot > cursor)
   - If no LLM is available, returns an error and history is not modified
   - Manual compact: `/compact [N]` - keeps N recent messages, summarizes the rest


## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Run locally
npm start chat "your prompt here"
```

## Future Enhancements
- Improve token limit detection
- Better tool messages
- Multi-provider comparison mode (send same prompt to all providers simultaneously)?
- Search within conversation history

## License

MIT
