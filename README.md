# Galdr

A CLI tool that integrates multiple AI coding assistants (Claude, Gemini, Copilot, DeepSeek API, Cursor) with provider switching and persistent context management.

**Note: This tool is currently in development. Expect bugs and breaking changes.**

## Features

- **Multi-Provider Integration**: Single interface for Claude, Gemini, Copilot, DeepSeek, and Cursor
- **Provider Switching**: Automatic switching between providers when token limits are reached
- **Switching Modes**: Rollover, manual, and round-robin provider selection strategies
- **Context Persistence**: Complete conversation history stored and restored between sessions
- **Context Compaction**: Automatic summarization of long conversations to manage token limits
- **Session Management**: Save, load, and manage multiple conversation sessions
- **DeepSeek Tool Integration**: Built-in support for file operations (read, write, list, find, edit, Google search, DuckDuckGo search, web fetch)
- **Existing Tool Integration**: Leverages installed AI CLI tools without additional configuration

## Installation

### Prerequisites

Install at least one of these AI CLI tools:

- [Claude CLI](https://claude.com/claude-code)
- [Gemini CLI](https://github.com/google/generative-ai-cli)
- [GitHub Copilot CLI](https://githubnext.com/projects/copilot-cli)
- [DeepSeek API](https://platform.deepseek.com) *(requires API key)*
- [Cursor CLI](https://www.cursor.com) *untested*

### Setup

```bash
# Clone and install
npm install
npm run build

# Optional: Install globally
npm link
```

## Usage

### Basic Commands

```bash
# Start interactive chat
galdr

# Chat with initial prompt
galdr "explain how async/await works in JavaScript"

# Use specific provider
galdr --provider gemini
```

#### Chat Commands

| Command | Description |
|---------|-------------|
| `/exit`, `/quit` | Exit the chat |
| `/switch <provider>` | Switch to specific provider |
| `/mode <mode>` | Change switching mode |
| `/model <provider> <model>` | Set model for provider |
| `/clear` | Clear history and screen |
| `/compact [keep]` | Compact history, keep N recent messages |
| `/history` | Show conversation statistics |
| `/status` | Show provider availability |
| `/verbose` | Toggle verbose output |
| `/help` | Show all commands |
| `/sessions` | List saved sessions |
| `/session-new <name> [desc]` | Create new session |
| `/session-load <name>` | Load existing session |
| `/session-save [desc]` | Save current session |
| `/session-delete <name>` | Delete session |
| `/session-rename <old> <new>` | Rename session |

### Context Management

```bash
# Show conversation history
galdr context --show

# Clear conversation context
galdr context --clear

# Compact context (keep last 10 messages)
galdr context --compact 10
```

### Provider Status

```bash
# Check provider availability and usage
galdr status
```

## Configuration

### Switching Modes

Galdr supports three provider switching strategies:

- **Manual** (Default): User manually chooses provider for each request
- **Rollover**: Automatically switches to next provider when token limits are reached
- **Round-robin**: Cycles through providers for each request

Change modes in-chat with `/mode <mode>`

### Auto-Compaction

When conversation history exceeds 50 messages, Galdr automatically:
- Keeps the 20 most recent messages
- Summarizes older messages using available LLMs
- Maintains conversation context while staying within token limits

Manual compaction: `/compact [N]` - keeps N recent messages, summarizes the rest

### Session Management

Organize conversations into sessions:
- Create, save, and load multiple conversation contexts
- Store sessions for different projects or topics
- Persistent storage in `.galdr/sessions/`

### Data Storage

- **Sessions**: `.galdr/sessions/` directory
- **Configuration**: `~/.galdr/config.json` (for defaults and DeepSeek API key)

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run locally
npm start
```

### Planned Enhancements

- Improve token limit detection
- Improve session management (todo list-like?)
- Context usage indicator
- Multi-provider comparison mode?

## License

MIT License
