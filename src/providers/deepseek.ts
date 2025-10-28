import { BaseProvider } from './base.js';
import { ProviderResult, Message } from '../types/index.js';
import { UserConfigManager } from '../config/userConfig.js';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{type: string; text?: string; tool_use_id?: string; content?: string}>;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

interface DeepSeekTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

interface DeepSeekRequest {
  model: string;
  messages: DeepSeekMessage[];
  stream: boolean;
  tools?: DeepSeekTool[];
}

interface DeepSeekStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    delta: {
      content?: string;
      role?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    index: number;
    finish_reason: string | null;
  }>;
}

export class DeepSeekProvider extends BaseProvider {
  private apiKey: string | undefined;
  private baseUrl: string = 'https://api.deepseek.com';
  private configManager: UserConfigManager;

  constructor() {
    super('deepseek');
    this.configManager = new UserConfigManager();
    // Try config file first, fallback to environment variable
    this.apiKey = this.configManager.getApiKey('deepseek') || process.env.DEEPSEEK_API_KEY;
  }

  private getToolDefinitions(): DeepSeekTool[] {
    return [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Reads the contents of a file from the filesystem. Returns the file contents as a string.',
          parameters: {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'The absolute path to the file to read'
              }
            },
            required: ['file_path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'write_file',
          description: 'Writes content to a file on the filesystem. Creates the file if it doesn\'t exist, overwrites if it does. Returns a success message.',
          parameters: {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'The absolute path to the file to write'
              },
              content: {
                type: 'string',
                description: 'The content to write to the file'
              }
            },
            required: ['file_path', 'content']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'edit_file',
          description: 'Performs exact string replacement in a file. Replaces old_string with new_string in the specified file. If replace_all is true, replaces all occurrences; otherwise replaces only the first occurrence.',
          parameters: {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'The absolute path to the file to edit'
              },
              old_string: {
                type: 'string',
                description: 'The exact string to search for and replace'
              },
              new_string: {
                type: 'string',
                description: 'The string to replace old_string with'
              },
              replace_all: {
                type: 'boolean',
                description: 'If true, replace all occurrences. If false, replace only the first occurrence. Defaults to false.'
              }
            },
            required: ['file_path', 'old_string', 'new_string']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'list_directory',
          description: 'Lists all files and directories in the specified directory path. Returns a list with information about each entry including name, type (file/directory), and size.',
          parameters: {
            type: 'object',
            properties: {
              directory_path: {
                type: 'string',
                description: 'The absolute path to the directory to list'
              },
              recursive: {
                type: 'boolean',
                description: 'If true, list files recursively in subdirectories. Defaults to false.'
              }
            },
            required: ['directory_path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'find_in_files',
          description: 'Searches for a text pattern in files within a directory. Returns matching lines with file paths and line numbers. Useful for finding where specific code or text appears.',
          parameters: {
            type: 'object',
            properties: {
              directory_path: {
                type: 'string',
                description: 'The absolute path to the directory to search in'
              },
              pattern: {
                type: 'string',
                description: 'The text pattern to search for (plain text, not regex)'
              },
              file_pattern: {
                type: 'string',
                description: 'Optional file pattern to filter files (e.g., "*.ts", "*.js"). Defaults to searching all files.'
              },
              case_sensitive: {
                type: 'boolean',
                description: 'If true, search is case-sensitive. Defaults to false.'
              }
            },
            required: ['directory_path', 'pattern']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'execute_bash',
          description: 'Executes a shell command and returns the output. Uses cmd.exe on Windows, /bin/sh on Unix. Useful for running build commands, tests, git operations, npm scripts, or any system command. The command runs in the current working directory. Note: Use cross-platform commands when possible (e.g., npm, git, node) rather than OS-specific commands (e.g., use "dir" on Windows, "ls" on Unix).',
          parameters: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'The shell command to execute. Examples: "npm test", "git status". On Windows: "dir", "type file.txt". On Unix: "ls -la", "cat file.txt". Prefer cross-platform tools like npm, git, node.'
              },
              timeout: {
                type: 'number',
                description: 'Optional timeout in milliseconds. Defaults to 30000 (30 seconds).'
              }
            },
            required: ['command']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'grep',
          description: 'Searches for patterns in files using regex. More powerful than find_in_files as it supports regular expressions and advanced filtering. Returns matching lines with context.',
          parameters: {
            type: 'object',
            properties: {
              pattern: {
                type: 'string',
                description: 'The regex pattern to search for (supports full regex syntax)'
              },
              path: {
                type: 'string',
                description: 'File or directory path to search in. Defaults to current directory.'
              },
              file_glob: {
                type: 'string',
                description: 'Glob pattern to filter files (e.g., "*.ts", "**/*.js")'
              },
              case_insensitive: {
                type: 'boolean',
                description: 'If true, search is case-insensitive. Defaults to false.'
              },
              context_lines: {
                type: 'number',
                description: 'Number of lines to show before and after each match for context. Defaults to 0.'
              },
              max_results: {
                type: 'number',
                description: 'Maximum number of results to return. Defaults to 100.'
              }
            },
            required: ['pattern']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'glob',
          description: 'Finds files matching glob patterns. Fast file pattern matching that works with any codebase size. Returns a list of matching file paths sorted by modification time.',
          parameters: {
            type: 'object',
            properties: {
              pattern: {
                type: 'string',
                description: 'Glob pattern to match files (e.g., "**/*.ts", "src/**/*.js", "*.json")'
              },
              base_path: {
                type: 'string',
                description: 'Directory to search in. Defaults to current working directory.'
              },
              max_results: {
                type: 'number',
                description: 'Maximum number of file paths to return. Defaults to 200.'
              }
            },
            required: ['pattern']
          }
        }
      }
    ];
  }

  private async executeTool(toolName: string, args: any): Promise<string> {
    try {
      switch (toolName) {
        case 'read_file':
          return await this.executeReadFile(args.file_path);
        case 'write_file':
          return await this.executeWriteFile(args.file_path, args.content);
        case 'edit_file':
          return await this.executeEditFile(args.file_path, args.old_string, args.new_string, args.replace_all);
        case 'list_directory':
          return await this.executeListDirectory(args.directory_path, args.recursive);
        case 'find_in_files':
          return await this.executeFindInFiles(args.directory_path, args.pattern, args.file_pattern, args.case_sensitive);
        case 'execute_bash':
          return await this.executebash(args.command, args.timeout);
        case 'grep':
          return await this.executeGrep(args.pattern, args.path, args.file_glob, args.case_insensitive, args.context_lines, args.max_results);
        case 'glob':
          return await this.executeGlob(args.pattern, args.base_path, args.max_results);
        default:
          return `Error: Unknown tool ${toolName}`;
      }
    } catch (error: any) {
      return `Error executing ${toolName}: ${error.message}`;
    }
  }

  private async executeReadFile(filePath: string): Promise<string> {
    try {
      // Show tool usage to user
      if (this.shouldDisplayTool('Read') && this.inkWriter) {
        this.inkWriter.showTool('Read', { file_path: filePath });
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      return content;
    } catch (error: any) {
      throw new Error(`Failed to read file ${filePath}: ${error.message}`);
    }
  }

  private async executeWriteFile(filePath: string, content: string): Promise<string> {
    try {
      // Show tool usage to user
      if (this.shouldDisplayTool('Write') && this.inkWriter) {
        this.inkWriter.showTool('Write', { file_path: filePath, content_length: content.length });
      }

      // Create directory if it doesn't exist
      const dir = path.dirname(filePath);
      await fs.promises.mkdir(dir, { recursive: true });

      await fs.promises.writeFile(filePath, content, 'utf-8');
      return `Successfully wrote ${content.length} characters to ${filePath}`;
    } catch (error: any) {
      throw new Error(`Failed to write file ${filePath}: ${error.message}`);
    }
  }

  private async executeEditFile(filePath: string, oldString: string, newString: string, replaceAll: boolean = false): Promise<string> {
    try {
      // Show tool usage to user
      if (this.shouldDisplayTool('Edit') && this.inkWriter) {
        this.inkWriter.showTool('Edit', {
          file_path: filePath,
          old_string: oldString.substring(0, 50) + (oldString.length > 50 ? '...' : ''),
          new_string: newString.substring(0, 50) + (newString.length > 50 ? '...' : ''),
          replace_all: replaceAll
        });
      }

      // Read the file
      const content = await fs.promises.readFile(filePath, 'utf-8');

      // Check if old_string exists in the file
      if (!content.includes(oldString)) {
        throw new Error(`String not found in file: ${oldString.substring(0, 100)}`);
      }

      // Perform replacement
      let newContent: string;
      let occurrences: number;

      if (replaceAll) {
        const regex = new RegExp(oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        occurrences = (content.match(regex) || []).length;
        newContent = content.split(oldString).join(newString);
      } else {
        occurrences = 1;
        const index = content.indexOf(oldString);
        if (index === -1) {
          throw new Error(`String not found in file: ${oldString.substring(0, 100)}`);
        }
        newContent = content.substring(0, index) + newString + content.substring(index + oldString.length);
      }

      // Write the modified content back
      await fs.promises.writeFile(filePath, newContent, 'utf-8');
      return `Successfully replaced ${occurrences} occurrence(s) in ${filePath}`;
    } catch (error: any) {
      throw new Error(`Failed to edit file ${filePath}: ${error.message}`);
    }
  }

  private async executeListDirectory(directoryPath: string, recursive: boolean = false): Promise<string> {
    try {
      // Show tool usage to user
      if (this.shouldDisplayTool('List') && this.inkWriter) {
        this.inkWriter.showTool('List', { directory_path: directoryPath, recursive });
      }

      const entries: string[] = [];

      const listDir = async (dirPath: string, prefix: string = ''): Promise<void> => {
        const items = await fs.promises.readdir(dirPath, { withFileTypes: true });

        for (const item of items) {
          const fullPath = path.join(dirPath, item.name);
          const relativePath = prefix ? path.join(prefix, item.name) : item.name;

          if (item.isDirectory()) {
            entries.push(`[DIR]  ${relativePath}/`);
            if (recursive) {
              await listDir(fullPath, relativePath);
            }
          } else {
            const stats = await fs.promises.stat(fullPath);
            entries.push(`[FILE] ${relativePath} (${stats.size} bytes)`);
          }
        }
      };

      await listDir(directoryPath);

      if (entries.length === 0) {
        return `Directory ${directoryPath} is empty`;
      }

      return `Directory listing for ${directoryPath}:\n${entries.join('\n')}`;
    } catch (error: any) {
      throw new Error(`Failed to list directory ${directoryPath}: ${error.message}`);
    }
  }

  private async executeFindInFiles(
    directoryPath: string,
    pattern: string,
    filePattern?: string,
    caseSensitive: boolean = false
  ): Promise<string> {
    try {
      // Show tool usage to user
      if (this.shouldDisplayTool('Find') && this.inkWriter) {
        this.inkWriter.showTool('Find', {
          directory_path: directoryPath,
          pattern: pattern.substring(0, 50) + (pattern.length > 50 ? '...' : ''),
          file_pattern: filePattern,
          case_sensitive: caseSensitive
        });
      }

      const matches: string[] = [];
      const searchPattern = caseSensitive ? pattern : pattern.toLowerCase();

      // Convert glob pattern to regex if provided
      const fileRegex = filePattern
        ? new RegExp('^' + filePattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
        : null;

      const searchInFile = async (filePath: string, relativePath: string): Promise<void> => {
        try {
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const searchLine = caseSensitive ? line : line.toLowerCase();

            if (searchLine.includes(searchPattern)) {
              matches.push(`${relativePath}:${i + 1}: ${line.trim()}`);
            }
          }
        } catch (error: any) {
          // Skip files that can't be read (binary, permission issues, etc.)
        }
      };

      const searchDir = async (dirPath: string, prefix: string = ''): Promise<void> => {
        const items = await fs.promises.readdir(dirPath, { withFileTypes: true });

        for (const item of items) {
          const fullPath = path.join(dirPath, item.name);
          const relativePath = prefix ? path.join(prefix, item.name) : item.name;

          // Skip node_modules and .git directories
          if (item.isDirectory() && (item.name === 'node_modules' || item.name === '.git')) {
            continue;
          }

          if (item.isDirectory()) {
            await searchDir(fullPath, relativePath);
          } else {
            // Check file pattern if provided
            if (fileRegex && !fileRegex.test(item.name)) {
              continue;
            }
            await searchInFile(fullPath, relativePath);
          }
        }
      };

      await searchDir(directoryPath);

      if (matches.length === 0) {
        return `No matches found for pattern "${pattern}" in ${directoryPath}`;
      }

      // Limit results to avoid overwhelming output
      const maxResults = 100;
      const limitedMatches = matches.slice(0, maxResults);
      const result = `Found ${matches.length} match(es) for "${pattern}" in ${directoryPath}:\n${limitedMatches.join('\n')}`;

      if (matches.length > maxResults) {
        return result + `\n... (${matches.length - maxResults} more matches not shown)`;
      }

      return result;
    } catch (error: any) {
      throw new Error(`Failed to search in ${directoryPath}: ${error.message}`);
    }
  }

  private async executebash(command: string, timeout: number = 30000): Promise<string> {
    try {
      // Show tool usage to user
      if (this.shouldDisplayTool('Bash') && this.inkWriter) {
        const platform = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
        this.inkWriter.showTool('Bash', {
          command: command.substring(0, 100) + (command.length > 100 ? '...' : ''),
          shell: platform,
          timeout
        });
      }

      // Node.js automatically uses cmd.exe on Windows, /bin/sh on Unix
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        // Let Node.js choose the shell automatically based on platform
      });

      // Combine stdout and stderr
      let output = '';
      if (stdout) output += stdout;
      if (stderr) output += stderr ? `\n[STDERR]\n${stderr}` : '';

      if (!output.trim()) {
        return 'Command executed successfully (no output)';
      }

      return output;
    } catch (error: any) {
      // If timeout, include partial output
      if (error.killed) {
        throw new Error(`Command timed out after ${timeout}ms: ${error.stdout || ''}`);
      }

      // Include both stdout and stderr in error
      let errorMsg = error.message;
      if (error.stdout) errorMsg += `\n[STDOUT]\n${error.stdout}`;
      if (error.stderr) errorMsg += `\n[STDERR]\n${error.stderr}`;

      throw new Error(`Failed to execute command: ${errorMsg}`);
    }
  }

  private async executeGrep(
    pattern: string,
    searchPath?: string,
    fileGlob?: string,
    caseInsensitive: boolean = false,
    contextLines: number = 0,
    maxResults: number = 100
  ): Promise<string> {
    try {
      // Show tool usage to user
      if (this.shouldDisplayTool('Grep') && this.inkWriter) {
        this.inkWriter.showTool('Grep', {
          pattern: pattern.substring(0, 50) + (pattern.length > 50 ? '...' : ''),
          path: searchPath || '.',
          file_glob: fileGlob,
          case_insensitive: caseInsensitive,
          context_lines: contextLines
        });
      }

      const matches: string[] = [];
      const basePath = searchPath || process.cwd();

      // Convert fileGlob to regex if provided
      const fileRegex = fileGlob
        ? new RegExp('^' + fileGlob.replace(/\./g, '\\.').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.') + '$')
        : null;

      // Compile the search pattern as regex
      const searchRegex = new RegExp(pattern, caseInsensitive ? 'gi' : 'g');

      const searchInFile = async (filePath: string, relativePath: string): Promise<void> => {
        try {
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (searchRegex.test(line)) {
              // Add context lines if requested
              if (contextLines > 0) {
                const start = Math.max(0, i - contextLines);
                const end = Math.min(lines.length - 1, i + contextLines);

                let contextMatch = `${relativePath}:${i + 1}:\n`;
                for (let j = start; j <= end; j++) {
                  const prefix = j === i ? '>' : ' ';
                  contextMatch += `${prefix} ${j + 1}: ${lines[j]}\n`;
                }
                matches.push(contextMatch);
              } else {
                matches.push(`${relativePath}:${i + 1}: ${line.trim()}`);
              }

              // Reset regex state
              searchRegex.lastIndex = 0;

              if (matches.length >= maxResults) {
                return;
              }
            } else {
              // Reset regex state for next line
              searchRegex.lastIndex = 0;
            }
          }
        } catch (error: any) {
          // Skip files that can't be read
        }
      };

      const searchDir = async (dirPath: string, prefix: string = ''): Promise<void> => {
        if (matches.length >= maxResults) return;

        const items = await fs.promises.readdir(dirPath, { withFileTypes: true });

        for (const item of items) {
          if (matches.length >= maxResults) break;

          const fullPath = path.join(dirPath, item.name);
          const relativePath = prefix ? path.join(prefix, item.name) : item.name;

          // Skip common directories
          if (item.isDirectory() && (item.name === 'node_modules' || item.name === '.git' || item.name === 'dist' || item.name === 'build')) {
            continue;
          }

          if (item.isDirectory()) {
            await searchDir(fullPath, relativePath);
          } else {
            // Check file pattern if provided
            if (fileRegex && !fileRegex.test(relativePath)) {
              continue;
            }
            await searchInFile(fullPath, relativePath);
          }
        }
      };

      // Check if basePath is a file or directory
      const stats = await fs.promises.stat(basePath);
      if (stats.isFile()) {
        await searchInFile(basePath, path.basename(basePath));
      } else {
        await searchDir(basePath);
      }

      if (matches.length === 0) {
        return `No matches found for pattern /${pattern}/ in ${basePath}`;
      }

      const result = `Found ${matches.length}${matches.length >= maxResults ? '+' : ''} match(es) for pattern /${pattern}/:\n${matches.join('\n')}`;

      if (matches.length >= maxResults) {
        return result + `\n... (limited to ${maxResults} results)`;
      }

      return result;
    } catch (error: any) {
      throw new Error(`Failed to grep: ${error.message}`);
    }
  }

  private async executeGlob(pattern: string, basePath?: string, maxResults: number = 200): Promise<string> {
    try {
      // Show tool usage to user
      if (this.shouldDisplayTool('Glob') && this.inkWriter) {
        this.inkWriter.showTool('Glob', {
          pattern,
          base_path: basePath || '.',
          max_results: maxResults
        });
      }

      const searchPath = basePath || process.cwd();
      const matches: Array<{path: string, mtime: Date}> = [];

      // Convert glob pattern to regex
      // Handle ** for recursive matching
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '<!RECURSIVE!>')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.')
        .replace(/<!RECURSIVE!>/g, '.*');

      const globRegex = new RegExp('^' + regexPattern + '$');

      const searchDir = async (dirPath: string, prefix: string = ''): Promise<void> => {
        if (matches.length >= maxResults) return;

        try {
          const items = await fs.promises.readdir(dirPath, { withFileTypes: true });

          for (const item of items) {
            if (matches.length >= maxResults) break;

            const fullPath = path.join(dirPath, item.name);
            const relativePath = prefix ? path.join(prefix, item.name) : item.name;

            // Skip common directories
            if (item.isDirectory() && (item.name === 'node_modules' || item.name === '.git' || item.name === 'dist' || item.name === 'build')) {
              continue;
            }

            // Normalize path separators for regex matching
            const normalizedPath = relativePath.replace(/\\/g, '/');

            if (item.isDirectory()) {
              // Check if directory matches (for patterns like "src/**")
              if (globRegex.test(normalizedPath + '/')) {
                const stats = await fs.promises.stat(fullPath);
                matches.push({ path: relativePath + '/', mtime: stats.mtime });
              }
              await searchDir(fullPath, relativePath);
            } else {
              // Check if file matches
              if (globRegex.test(normalizedPath)) {
                const stats = await fs.promises.stat(fullPath);
                matches.push({ path: relativePath, mtime: stats.mtime });
              }
            }
          }
        } catch (error: any) {
          // Skip directories we can't read
        }
      };

      await searchDir(searchPath);

      if (matches.length === 0) {
        return `No files found matching pattern "${pattern}" in ${searchPath}`;
      }

      // Sort by modification time (most recent first)
      matches.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      const paths = matches.map(m => m.path);
      const result = `Found ${matches.length}${matches.length >= maxResults ? '+' : ''} file(s) matching "${pattern}":\n${paths.join('\n')}`;

      if (matches.length >= maxResults) {
        return result + `\n... (limited to ${maxResults} results)`;
      }

      return result;
    } catch (error: any) {
      throw new Error(`Failed to glob: ${error.message}`);
    }
  }

  // These methods are required by the abstract class but only used for availability checking
  getCommand(model?: string): string {
    // Return a dummy command - not actually used since we override execute()
    return 'echo';
  }

  parseOutput(output: string): ProviderResult {
    // Not used in our API-based implementation, but required by abstract class
    return {
      success: true,
      response: output,
      tokenLimitReached: false,
    };
  }

  detectTokenLimit(output: string): boolean {
    // Check for DeepSeek-specific token limit errors
    return false; // Temporary because we're working on this file.
    
  }

  private convertMessages(messages: Message[]): DeepSeekMessage[] {
    return messages.map(msg => ({
      role: msg.role as 'system' | 'user' | 'assistant',
      content: msg.content
    }));
  }

  private async streamResponse(
    messages: DeepSeekMessage[],
    model: string,
    onStream?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<ProviderResult> {
    const request: DeepSeekRequest = {
      model,
      messages,
      stream: true,
      tools: this.getToolDefinitions(),
    };

    if (process.env.GALDR_VERBOSE) {
      this.showVerbose(`========== DEEPSEEK API REQUEST ==========`);
      this.showVerbose(`Model: ${model}`);
      this.showVerbose(`Messages count: ${messages.length}`);
      this.showVerbose(`Request body: ${JSON.stringify(request, null, 2)}`);
      this.showVerbose(`========================================`);
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(request),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (process.env.GALDR_VERBOSE) {
          this.showVerbose(`API error response: ${errorText}`);
        }
        return {
          success: false,
          error: `DeepSeek API error: ${response.status} ${response.statusText}\n${errorText}`,
          tokenLimitReached: this.detectTokenLimit(errorText),
        };
      }

      if (!response.body) {
        return {
          success: false,
          error: 'No response body from DeepSeek API',
          tokenLimitReached: false,
        };
      }

      let fullResponse = '';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const toolCalls: Array<{id: string; name: string; arguments: string}> = [];
      let currentToolCall: {id?: string; name?: string; arguments: string} | null = null;
      let currentToolIndex = -1;

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;

            if (trimmedLine.startsWith('data: ')) {
              const jsonStr = trimmedLine.slice(6); // Remove 'data: ' prefix
              try {
                const chunk: DeepSeekStreamChunk = JSON.parse(jsonStr);
                const delta = chunk.choices[0]?.delta;
                const content = delta?.content;
                const toolCallDeltas = delta?.tool_calls;
                const finishReason = chunk.choices[0]?.finish_reason;

                if (content) {
                  fullResponse += content;
                  if (onStream) {
                    onStream(content);
                  }
                  this.handleStreamChunk(content);
                }

                // Handle tool calls
                if (toolCallDeltas && toolCallDeltas.length > 0) {
                  for (const toolCallDelta of toolCallDeltas) {
                    const index = toolCallDelta.index;

                    // New tool call
                    if (index !== currentToolIndex) {
                      // Save previous tool call if exists
                      if (currentToolCall && currentToolCall.id && currentToolCall.name) {
                        toolCalls.push({
                          id: currentToolCall.id,
                          name: currentToolCall.name,
                          arguments: currentToolCall.arguments
                        });
                      }

                      // Start new tool call
                      currentToolIndex = index;
                      currentToolCall = {
                        id: toolCallDelta.id,
                        name: toolCallDelta.function?.name,
                        arguments: toolCallDelta.function?.arguments || ''
                      };
                    } else {
                      // Continue existing tool call
                      if (currentToolCall) {
                        if (toolCallDelta.id) currentToolCall.id = toolCallDelta.id;
                        if (toolCallDelta.function?.name) currentToolCall.name = toolCallDelta.function.name;
                        if (toolCallDelta.function?.arguments) {
                          currentToolCall.arguments += toolCallDelta.function.arguments;
                        }
                      }
                    }
                  }
                }

                // If we got finish_reason === 'tool_calls', save the last tool call
                if (finishReason === 'tool_calls' && currentToolCall && currentToolCall.id && currentToolCall.name) {
                  toolCalls.push({
                    id: currentToolCall.id,
                    name: currentToolCall.name,
                    arguments: currentToolCall.arguments
                  });
                }
              } catch (parseError) {
                if (process.env.GALDR_VERBOSE) {
                  this.showVerbose(`Failed to parse SSE chunk: ${jsonStr}`);
                }
              }
            }
          }
        }
      } catch (error: any) {
        // Check if it's an abort error
        if (error.name === 'AbortError') {
          return {
            success: false,
            error: 'Operation cancelled',
            tokenLimitReached: false,
          };
        }

        // Handle stream termination errors
        if (error.message && (
          error.message.includes('terminated') ||
          error.message.includes('aborted') ||
          error.message.includes('closed') ||
          error.message.includes('network')
        )) {
          // Always output detailed termination information
          console.error('\n═══════════════════════════════════════════════════════════════');
          console.error('DeepSeek API Stream Termination Error');
          console.error('═══════════════════════════════════════════════════════════════');
          console.error('Error Message:', error.message);
          console.error('Error Type:', error.name || 'Unknown');
          console.error('Error Stack:', error.stack || 'No stack trace available');
          console.error('───────────────────────────────────────────────────────────────');
          console.error('Request Details:');
          console.error('  Model:', this.model);
          console.error('  API URL:', this.baseUrl);
          console.error('  Messages Count:', messages.length);
          console.error('  Last Message Role:', messages[messages.length - 1]?.role || 'N/A');
          console.error('  Last Message Length:', messages[messages.length - 1]?.content?.length || 0);
          console.error('───────────────────────────────────────────────────────────────');
          console.error('Response State:');
          console.error('  Partial Response Received:', fullResponse.length > 0 ? 'Yes' : 'No');
          console.error('  Partial Response Length:', fullResponse.length, 'characters');
          console.error('  Tool Calls Collected:', toolCalls.length);
          console.error('  Current Buffer:', buffer ? `"${buffer.substring(0, 100)}${buffer.length > 100 ? '...' : ''}"` : 'Empty');
          console.error('───────────────────────────────────────────────────────────────');
          console.error('Possible Causes:');
          console.error('  • Network connectivity issues');
          console.error('  • DeepSeek API rate limiting');
          console.error('  • Server-side timeout or overload');
          console.error('  • Request payload too large');
          console.error('  • API key issues');
          console.error('═══════════════════════════════════════════════════════════════\n');

          // If we have a partial response, return it
          if (fullResponse.length > 0) {
            console.error(`⚠️  Returning partial response (${fullResponse.length} characters)\n`);
            return {
              success: true,
              response: fullResponse,
              tokenLimitReached: false,
            };
          }

          // Otherwise, return the error
          return {
            success: false,
            error: `DeepSeek API connection terminated: ${error.message}. See detailed error output above.`,
            tokenLimitReached: false,
          };
        }

        throw error;
      }

      // Execute tool calls if any
      if (toolCalls.length > 0) {
        if (process.env.GALDR_VERBOSE) {
          this.showVerbose(`Executing ${toolCalls.length} tool call(s)`);
        }

        // Add assistant message with tool calls to conversation
        const assistantMessage: DeepSeekMessage = {
          role: 'assistant',
          content: fullResponse || '',
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: tc.arguments
            }
          }))
        };
        messages.push(assistantMessage);

        // Execute each tool and add results
        for (const toolCall of toolCalls) {
          try {
            const args = JSON.parse(toolCall.arguments);
            const result = await this.executeTool(toolCall.name, args);

            // Add tool result message
            messages.push({
              role: 'tool',
              content: result,
              tool_call_id: toolCall.id
            });
          } catch (error: any) {
            messages.push({
              role: 'tool',
              content: `Error executing tool: ${error.message}`,
              tool_call_id: toolCall.id
            });
          }
        }

        // Make another API call with tool results
        return this.streamResponse(messages, model, onStream, signal);
      }

      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(`========== DEEPSEEK RESPONSE COMPLETE ==========`);
        this.showVerbose(`Response length: ${fullResponse.length} characters`);
        this.showVerbose(`===============================================`);
      }

      return {
        success: true,
        response: fullResponse,
        tokenLimitReached: false,
      };
    } catch (error: any) {
      // Check if it's an abort error
      if (error.name === 'AbortError') {
        return {
          success: false,
          error: 'Operation cancelled',
          tokenLimitReached: false,
        };
      }

      if (process.env.GALDR_VERBOSE) {
        this.showVerbose(`DeepSeek API error: ${error.message}`);
      }
      return {
        success: false,
        error: `DeepSeek API request failed: ${error.message}`,
        tokenLimitReached: false,
      };
    }
  }

  public async execute(
    prompt: string,
    conversationHistory: Message[] = [],
    onStream?: (chunk: string) => void,
    onFirstChunk?: () => void,
    signal?: AbortSignal
  ): Promise<ProviderResult> {
    // Reset for each execution
    this.firstChunkReceived = false;
    this.onFirstChunk = onFirstChunk;

    if (!this.apiKey) {
      return {
        success: false,
        error: 'DeepSeek API key is not set. Please set it using: galdr config --set-key deepseek <your-api-key>',
        tokenLimitReached: false,
      };
    }

    // Convert conversation history to DeepSeek format
    const messages = this.convertMessages(conversationHistory);

    // Add system message if this is the first message (no conversation history)
    if (conversationHistory.length === 0) {
      messages.unshift({
        role: 'system',
        content: `You are a helpful AI coding assistant with access to powerful development tools. You can:

File Operations:
- Read files: Use read_file to examine file contents
- Write files: Use write_file to create or overwrite files
- Edit files: Use edit_file to make precise changes by replacing text
- List directories: Use list_directory to see what files and folders exist

Search & Discovery:
- Find in files: Use find_in_files to search for plain text patterns across files
- Grep: Use grep for regex pattern matching with context lines (more powerful than find_in_files)
- Glob: Use glob to find files matching patterns (e.g., "**/*.ts", "src/**/*.js")

Command Execution:
- Execute bash: Use execute_bash to run shell commands (npm, git, tests, builds, etc.)
  * Platform: Runs cmd.exe on Windows, /bin/sh on Unix/Linux/macOS
  * Prefer cross-platform commands: npm, git, node, python
  * OS-specific commands: Use 'dir' on Windows, 'ls' on Unix; 'type' on Windows, 'cat' on Unix

Best Practices:
- Always read files before editing them to understand the current content
- Use edit_file for targeted changes rather than rewriting entire files
- Use grep for complex pattern searches with regex support
- Use glob to discover files by patterns before reading them
- Use execute_bash for running tests, builds, git operations, and system commands
- When using execute_bash, prefer cross-platform commands (npm, git) over OS-specific ones
- Provide clear, concise responses
- Use the tools proactively to help solve the user's problems

The working directory is: ${process.cwd()}`
      });
    }

    // Add the current prompt as a user message
    messages.push({
      role: 'user',
      content: prompt,
    });

    // Use the model if set, otherwise use default
    const model = (this.model && this.model !== 'default') ? this.model : 'deepseek-chat';

    return this.streamResponse(messages, model, onStream, signal);
  }

  public async checkAvailability(): Promise<boolean> {
    // DeepSeek is available if the API key is set
    // We could also make a test API call, but checking the env var is faster
    return !!this.apiKey;
  }
}
