#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { ContextManager } from './context/manager.js';
import { ProviderManager } from './providers/index.js';
import { Provider, SwitchMode } from './types/index.js';
import { ChatSessionInk } from './chat/session-ink.js';

const program = new Command();

program
  .name('galdr')
  .description('Combine multiple AI coding assistants (Claude, Gemini, Copilot)')
  .version('0.1.0')
  .option('--list-sessions', 'List all available sessions')
  .option('-s, --session <name>', 'Start in a named session (creates it if it does not exist)');

// Shared chat action handler
async function handleChatAction(prompt: string | undefined, options: any) {
  // Handle list-sessions option
  if (options.listSessions) {
    const context = new ContextManager();
    const sessions = context.listSessions();

    if (sessions.length === 0) {
      console.log(chalk.yellow('No sessions found.'));
      return;
    }

    const currentSessionName = context.getCurrentSessionName();
    console.log(chalk.blue('Available sessions:'));
    sessions.forEach((session) => {
      const current = session.name === currentSessionName ? chalk.green(' (current)') : '';
      const desc = session.description ? ` - ${session.description}` : '';
      const lastAccessed = new Date(session.lastAccessed).toLocaleString();
      console.log(`  ${chalk.bold(session.name)}${current}: ${session.messageCount} messages, last accessed: ${lastAccessed}${desc}`);
    });
    return;
  }

  // Set verbose mode for this session only (not persisted)
  if (options.verbose) {
    process.env.GALDR_VERBOSE = '1';
  }

  // If a session is specified, switch to it (or create it if it doesn't exist)
  // This must happen BEFORE creating ChatSessionInk so it picks up the correct session
  if (options.session) {
    const context = new ContextManager();
    const sessionName = options.session;

    // Create the session if it doesn't exist
    if (!context.getSessionMetadata(sessionName)) {
      context.createSession(sessionName);
      console.log(chalk.green(`Created new session: ${sessionName}`));
    }

    // Switch to the session
    if (context.switchSession(sessionName)) {
      console.log(chalk.blue(`Switched to session: ${sessionName}`));
    }
  }

  const chatSession = new ChatSessionInk();

  // If a provider is specified, set it before starting
  if (options.provider) {
    const context = new ContextManager();
    const providerManager = new ProviderManager();
    const provider = options.provider as Provider;

    // Validate provider
    if (!['claude', 'gemini', 'copilot', 'cursor'].includes(provider)) {
      console.log(chalk.red('Invalid provider. Must be: claude, gemini, copilot, or cursor'));
      process.exit(1);
    }

    // Check availability
    const isAvailable = await providerManager.checkAvailability(provider);
    if (!isAvailable) {
      console.log(chalk.red(`Provider ${provider} is not available. Please install the CLI tool.`));
      process.exit(1);
    }

    context.setCurrentProvider(provider);
  }

  // Start the chat session
  await chatSession.start(prompt);
}

// Main chat command
program
  .command('chat')
  .description('Start an interactive chat session')
  .argument('[prompt]', 'Initial prompt to send')
  .option('-p, --provider <provider>', 'Specify provider (claude, gemini, copilot, cursor)')
  .option('-v, --verbose', 'Enable verbose output')
  .action(handleChatAction);

// Default action when no command is specified
program
  .argument('[prompt]', 'Initial prompt to send (defaults to chat mode)')
  .option('-p, --provider <provider>', 'Specify provider (claude, gemini, copilot, cursor)')
  .option('-v, --verbose', 'Enable verbose output')
  .action(handleChatAction);

// Config commands (now operates on context directly)
program
  .command('config')
  .description('Configure Galdr settings')
  .option('-p, --provider <provider>', 'Set current provider')
  .option('-m, --mode <mode>', 'Set switch mode (manual, rollover, round-robin)')
  .option('--model <provider> <model>', 'Set model for a provider')
  .option('-s, --show', 'Show current configuration')
  .action(async (options) => {
    const context = new ContextManager();

    if (options.show) {
      console.log(chalk.blue('Current Configuration:'));
      console.log(`  Current Provider: ${context.getCurrentProvider()}`);
      console.log(`  Switch Mode: ${context.getSwitchMode()}`);
      console.log(chalk.blue('\nProvider Models:'));
      const providers: Provider[] = ['claude', 'gemini', 'copilot', 'cursor'];
      for (const provider of providers) {
        const model = context.getProviderModel(provider);
        console.log(`  ${provider}: ${model}`);
      }
      return;
    }

    if (options.provider) {
      const provider = options.provider as Provider;
      if (!['claude', 'gemini', 'copilot', 'cursor'].includes(provider)) {
        console.log(chalk.red('Invalid provider. Must be: claude, gemini, copilot, or cursor'));
        return;
      }
      context.setCurrentProvider(provider);
      console.log(chalk.green(`Current provider set to: ${provider}`));
    }

    if (options.mode) {
      const mode = options.mode as SwitchMode;
      if (!['manual', 'rollover', 'round-robin'].includes(mode)) {
        console.log(chalk.red('Invalid mode. Must be: manual, rollover, or round-robin'));
        return;
      }
      context.setSwitchMode(mode);
      console.log(chalk.green(`Switch mode set to: ${mode}`));
    }
  });

// Context commands
program
  .command('context')
  .description('Manage conversation context')
  .option('-c, --clear', 'Clear conversation context')
  .option('-s, --show', 'Show conversation history')
  .option('--compact [keep]', 'Compact context, keeping last N messages (default: 10)')
  .action(async (options) => {
    const context = new ContextManager();

    if (options.clear) {
      context.clear();
      console.log(chalk.green('Context cleared'));
      return;
    }

    if (options.show) {
      console.log(chalk.blue('Conversation History:'));
      console.log(context.getConversationHistory());
      return;
    }

    if (options.compact !== undefined) {
      const keep = typeof options.compact === 'string' ? parseInt(options.compact) : 10;
      console.log(chalk.blue('Compacting and summarizing messages...'));
      const result = await context.compact(keep);
      if (result.error) {
        console.log(chalk.red(`Error: ${result.error}`));
      } else if (result.compacted) {
        console.log(chalk.green(`Context compacted, kept last ${keep} messages`));
      } else {
        console.log(chalk.yellow('No compaction needed.'));
      }
      return;
    }

    console.log(chalk.yellow('Use --clear, --show, or --compact'));
  });

// Status command
program
  .command('status')
  .description('Show provider availability and usage statistics')
  .action(async () => {
    const context = new ContextManager();
    const providerManager = new ProviderManager();

    console.log(chalk.blue('Galdr Status\n'));

    console.log(chalk.bold('Configuration:'));
    console.log(`  Current Provider: ${context.getCurrentProvider()}`);
    console.log(`  Switch Mode: ${context.getSwitchMode()}\n`);

    console.log(chalk.bold('Provider Availability:'));
    const availability = await providerManager.checkAllAvailability();
    for (const [provider, available] of availability) {
      const status = available 
        ? chalk.green('✓ Available') 
        : chalk.red('✗ Not found');
      console.log(`  ${provider}: ${status}`);
    }

    console.log(chalk.bold('\nUsage Statistics:'));
    const usage = context.getProviderUsage();
    console.log(`  Claude: ${usage.claude} requests`);
    console.log(`  Gemini: ${usage.gemini} requests`);
    console.log(`  Copilot: ${usage.copilot} requests`);
    console.log(`  Cursor: ${usage.cursor} requests`);
  });

program.parse();
