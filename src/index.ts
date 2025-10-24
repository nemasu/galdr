#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { ContextManager } from './context/manager';
import { ConfigManager } from './config/manager';
import { ProviderManager } from './providers';
import { Provider, SwitchMode } from './types';
import { ChatSession } from './chat/session';

const program = new Command();

program
  .name('galdr')
  .description('Combine multiple AI coding assistants (Claude, Gemini, Copilot)')
  .version('0.1.0');

// Shared chat action handler
async function handleChatAction(prompt: string | undefined, options: any) {
  const chatSession = new ChatSession();

  // If a provider is specified, set it before starting
  if (options.provider) {
    const context = new ContextManager();
    const providerManager = new ProviderManager();
    const provider = options.provider as Provider;

    // Validate provider
    if (!['claude', 'gemini', 'copilot'].includes(provider)) {
      console.log(chalk.red('Invalid provider. Must be: claude, gemini, or copilot'));
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
  .option('-p, --provider <provider>', 'Specify provider (claude, gemini, copilot)')
  .action(handleChatAction);

// Default action when no command is specified
program
  .argument('[prompt]', 'Initial prompt to send (defaults to chat mode)')
  .option('-p, --provider <provider>', 'Specify provider (claude, gemini, copilot)')
  .action(handleChatAction);

// Config commands
program
  .command('config')
  .description('Configure Galdr settings')
  .option('-p, --provider <provider>', 'Set default provider')
  .option('-m, --mode <mode>', 'Set switch mode (manual, rollover, round-robin)')
  .option('-s, --show', 'Show current configuration')
  .action(async (options) => {
    const config = new ConfigManager();

    if (options.show) {
      console.log(chalk.blue('Current Configuration:'));
      console.log(JSON.stringify(config.getConfig(), null, 2));
      return;
    }

    if (options.provider) {
      const provider = options.provider as Provider;
      if (!['claude', 'gemini', 'copilot'].includes(provider)) {
        console.log(chalk.red('Invalid provider. Must be: claude, gemini, or copilot'));
        return;
      }
      config.setDefaultProvider(provider);
      console.log(chalk.green(`Default provider set to: ${provider}`));
    }

    if (options.mode) {
      const mode = options.mode as SwitchMode;
      if (!['manual', 'rollover', 'round-robin'].includes(mode)) {
        console.log(chalk.red('Invalid mode. Must be: manual, rollover, or round-robin'));
        return;
      }
      config.setSwitchMode(mode);
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
  .action((options) => {
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
      context.compact(keep);
      console.log(chalk.green(`Context compacted, kept last ${keep} messages`));
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
    const config = new ConfigManager();
    const providerManager = new ProviderManager();

    console.log(chalk.blue('Galdr Status\n'));

    console.log(chalk.bold('Configuration:'));
    console.log(`  Default Provider: ${config.getDefaultProvider()}`);
    console.log(`  Switch Mode: ${config.getSwitchMode()}`);
    console.log(`  Current Provider: ${context.getCurrentProvider()}\n`);

    console.log(chalk.bold('Provider Availability:'));
    const availability = await providerManager.checkAllAvailability();
    for (const [provider, available] of availability) {
      const status = available ? chalk.green('✓ Available') : chalk.red('✗ Not found');
      console.log(`  ${provider}: ${status}`);
    }

    console.log(chalk.bold('\nUsage Statistics:'));
    const usage = context.getProviderUsage();
    console.log(`  Claude: ${usage.claude} requests`);
    console.log(`  Gemini: ${usage.gemini} requests`);
    console.log(`  Copilot: ${usage.copilot} requests`);
  });

program.parse();
