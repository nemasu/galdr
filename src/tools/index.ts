import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { UserConfigManager } from '../config/userConfig.js';

const execAsync = promisify(exec);

/**
 * Tool definition interface compatible with various AI providers
 */
export interface ToolDefinition {
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

/**
 * Interface for displaying tool usage to the user
 */
export interface ToolDisplay {
  showTool(toolName: string, parameters: any): void;
  completeTool?(success: boolean): void;
}

/**
 * Get all available tool definitions
 */
export function getToolDefinitions(): ToolDefinition[] {
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
    },
    {
      type: 'function',
      function: {
        name: 'google_search',
        description: 'Performs a Google web search using the Google Custom Search API. Returns search results including titles, snippets, and URLs. Useful for finding information, documentation, tutorials, or any web content. Requires API key and Search Engine ID to be configured in ~/.galdr/config.json.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query string (e.g., "TypeScript async await tutorial", "React hooks documentation")'
            },
            num_results: {
              type: 'number',
              description: 'Number of search results to return (1-10). Defaults to 5.'
            },
            start_index: {
              type: 'number',
              description: 'The index of the first result to return (for pagination). Defaults to 1.'
            }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'fetch_page',
        description: 'Fetches a web page and extracts its readable content using Mozilla\'s Readability algorithm. Returns the page title, author, text content, and excerpt. Useful for reading articles, documentation, blog posts, or any web content found via search results. Works best with static content.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL of the web page to fetch (e.g., "https://example.com/article")'
            },
            include_html: {
              type: 'boolean',
              description: 'If true, includes the cleaned HTML content in addition to plain text. Defaults to false.'
            }
          },
          required: ['url']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'duckduckgo_search',
        description: 'Performs a web search using DuckDuckGo. Returns search results including titles, snippets, and URLs. Does not require any API keys. This is the default search tool when Google Search is not configured or fails. Useful for finding information, documentation, tutorials, or any web content.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query string (e.g., "TypeScript async await tutorial", "React hooks documentation")'
            },
            num_results: {
              type: 'number',
              description: 'Number of search results to return (1-20). Defaults to 5.'
            },
            region: {
              type: 'string',
              description: 'Region for search results (e.g., "us-en", "uk-en", "de-de"). Defaults to "wt-wt" (worldwide).'
            }
          },
          required: ['query']
        }
      }
    }
  ];
}

/**
 * Execute a tool by name with the given arguments
 */
export async function executeTool(
  toolName: string,
  args: any,
  display?: ToolDisplay,
  shouldDisplayTool?: (toolName: string) => boolean
): Promise<string> {
  try {
    switch (toolName) {
      case 'read_file':
        return await executeReadFile(args.file_path, display, shouldDisplayTool);
      case 'write_file':
        return await executeWriteFile(args.file_path, args.content, display, shouldDisplayTool);
      case 'edit_file':
        return await executeEditFile(args.file_path, args.old_string, args.new_string, args.replace_all, display, shouldDisplayTool);
      case 'list_directory':
        return await executeListDirectory(args.directory_path, args.recursive, display, shouldDisplayTool);
      case 'find_in_files':
        return await executeFindInFiles(args.directory_path, args.pattern, args.file_pattern, args.case_sensitive, display, shouldDisplayTool);
      case 'execute_bash':
        return await executeBash(args.command, args.timeout, display, shouldDisplayTool);
      case 'grep':
        return await executeGrep(args.pattern, args.path, args.file_glob, args.case_insensitive, args.context_lines, args.max_results, display, shouldDisplayTool);
      case 'glob':
        return await executeGlob(args.pattern, args.base_path, args.max_results, display, shouldDisplayTool);
      case 'google_search':
        return await executeGoogleSearch(args.query, args.num_results, args.start_index, display, shouldDisplayTool);
      case 'duckduckgo_search':
        return await executeDuckDuckGoSearch(args.query, args.num_results, args.region, display, shouldDisplayTool);
      case 'fetch_page':
        return await executeFetchPage(args.url, args.include_html, display, shouldDisplayTool);
      default:
        return `Error: Unknown tool ${toolName}`;
    }
  } catch (error: any) {
    return `Error executing ${toolName}: ${error.message}`;
  }
}

async function executeReadFile(
  filePath: string,
  display?: ToolDisplay,
  shouldDisplayTool?: (toolName: string) => boolean
): Promise<string> {
  try {
    // Show tool usage to user
    if (shouldDisplayTool?.('Read') && display) {
      display.showTool('Read', { file_path: filePath });
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    return content;
  } catch (error: any) {
    throw new Error(`Failed to read file ${filePath}: ${error.message}`);
  }
}

async function executeWriteFile(
  filePath: string,
  content: string,
  display?: ToolDisplay,
  shouldDisplayTool?: (toolName: string) => boolean
): Promise<string> {
  try {
    // Show tool usage to user
    if (shouldDisplayTool?.('Write') && display) {
      display.showTool('Write', { file_path: filePath, content_length: content.length });
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

async function executeEditFile(
  filePath: string,
  oldString: string,
  newString: string,
  replaceAll: boolean = false,
  display?: ToolDisplay,
  shouldDisplayTool?: (toolName: string) => boolean
): Promise<string> {
  try {
    // Show tool usage to user
    if (shouldDisplayTool?.('Edit') && display) {
      display.showTool('Edit', {
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

async function executeListDirectory(
  directoryPath: string,
  recursive: boolean = false,
  display?: ToolDisplay,
  shouldDisplayTool?: (toolName: string) => boolean
): Promise<string> {
  try {
    // Show tool usage to user
    if (shouldDisplayTool?.('List') && display) {
      display.showTool('List', { directory_path: directoryPath, recursive });
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

async function executeFindInFiles(
  directoryPath: string,
  pattern: string,
  filePattern?: string,
  caseSensitive: boolean = false,
  display?: ToolDisplay,
  shouldDisplayTool?: (toolName: string) => boolean
): Promise<string> {
  try {
    // Show tool usage to user
    if (shouldDisplayTool?.('Find') && display) {
      display.showTool('Find', {
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

async function executeBash(
  command: string,
  timeout: number = 30000,
  display?: ToolDisplay,
  shouldDisplayTool?: (toolName: string) => boolean
): Promise<string> {
  try {
    // Show tool usage to user
    if (shouldDisplayTool?.('Bash') && display) {
      const platform = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
      display.showTool('Bash', {
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

async function executeGrep(
  pattern: string,
  searchPath?: string,
  fileGlob?: string,
  caseInsensitive: boolean = false,
  contextLines: number = 0,
  maxResults: number = 100,
  display?: ToolDisplay,
  shouldDisplayTool?: (toolName: string) => boolean
): Promise<string> {
  try {
    // Show tool usage to user
    if (shouldDisplayTool?.('Grep') && display) {
      display.showTool('Grep', {
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

async function executeGlob(
  pattern: string,
  basePath?: string,
  maxResults: number = 200,
  display?: ToolDisplay,
  shouldDisplayTool?: (toolName: string) => boolean
): Promise<string> {
  try {
    // Show tool usage to user
    if (shouldDisplayTool?.('Glob') && display) {
      display.showTool('Glob', {
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

/**
 * Performs a DuckDuckGo web search using HTML parsing
 */
async function executeDuckDuckGoSearch(
  query: string,
  numResults: number = 5,
  region: string = 'wt-wt',
  display?: ToolDisplay,
  shouldDisplayTool?: (toolName: string) => boolean
): Promise<string> {
  try {
    // Show tool usage to user
    if (shouldDisplayTool?.('DuckDuckGoSearch') && display) {
      display.showTool('DuckDuckGoSearch', {
        query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
        num_results: numResults,
        region: region
      });
    }

    // Validate parameters
    const validNumResults = Math.min(Math.max(1, numResults), 20);

    // Build the search URL
    const searchUrl = new URL('https://html.duckduckgo.com/html/');
    searchUrl.searchParams.append('q', query);
    if (region && region !== 'wt-wt') {
      searchUrl.searchParams.append('kl', region);
    }

    // Perform the HTTP request
    const response = await fetch(searchUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();

    // Parse the HTML using JSDOM
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // Extract search results
    const resultElements = document.querySelectorAll('.result');
    const results: Array<{ title: string; url: string; description: string }> = [];

    for (let i = 0; i < Math.min(resultElements.length, validNumResults); i++) {
      const resultElement = resultElements[i];

      // Extract title and URL
      const titleElement = resultElement.querySelector('.result__a');
      const snippetElement = resultElement.querySelector('.result__snippet');

      if (titleElement) {
        const title = titleElement.textContent?.trim() || '';
        const url = titleElement.getAttribute('href') || '';
        const description = snippetElement?.textContent?.trim() || '';

        // DuckDuckGo uses redirect URLs, extract the actual URL
        let actualUrl = url;
        if (url.includes('uddg=')) {
          const urlMatch = url.match(/uddg=([^&]+)/);
          if (urlMatch) {
            actualUrl = decodeURIComponent(urlMatch[1]);
          }
        }

        results.push({ title, url: actualUrl, description });
      }
    }

    // Check if there are any results
    if (results.length === 0) {
      return `No results found for query: "${query}"`;
    }

    // Format the results
    const formattedResults: string[] = [];
    formattedResults.push(`Search results for "${query}" (showing ${results.length} results):\n`);

    for (let i = 0; i < results.length; i++) {
      const item = results[i];
      formattedResults.push(`${i + 1}. ${item.title}`);
      formattedResults.push(`   URL: ${item.url}`);

      if (item.description) {
        // Clean up the description (remove extra whitespace)
        const description = item.description.replace(/\s+/g, ' ').trim();
        formattedResults.push(`   ${description}`);
      }

      formattedResults.push(''); // Empty line between results
    }

    return formattedResults.join('\n');
  } catch (error: any) {
    throw new Error(`Failed to perform DuckDuckGo Search: ${error.message}`);
  }
}

/**
 * Performs a Google web search with automatic fallback to DuckDuckGo
 */
async function executeGoogleSearch(
  query: string,
  numResults: number = 5,
  startIndex: number = 1,
  display?: ToolDisplay,
  shouldDisplayTool?: (toolName: string) => boolean
): Promise<string> {
  // Get API credentials from config
  const configManager = new UserConfigManager();
  const apiKey = configManager.getApiKey('googleSearch');
  const searchEngineId = configManager.getGoogleSearchEngineId();

  // If Google credentials are not configured, fallback to DuckDuckGo
  if (!apiKey || !searchEngineId) {
    if (display) {
      console.log('Google Search credentials not configured, using DuckDuckGo instead...');
    }
    return await executeDuckDuckGoSearch(query, numResults, 'wt-wt', display, shouldDisplayTool);
  }

  try {
    // Show tool usage to user
    if (shouldDisplayTool?.('GoogleSearch') && display) {
      display.showTool('GoogleSearch', {
        query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
        num_results: numResults,
        start_index: startIndex
      });
    }

    // Validate parameters
    const validNumResults = Math.min(Math.max(1, numResults), 10);
    const validStartIndex = Math.max(1, startIndex);

    // Build the API URL
    const url = new URL('https://customsearch.googleapis.com/customsearch/v1');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', searchEngineId);
    url.searchParams.set('q', query);
    url.searchParams.set('num', validNumResults.toString());
    url.searchParams.set('start', validStartIndex.toString());

    // Make the API request
    const response = await fetch(url.toString());

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Search API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as any;

    // Check if there are any results
    if (!data.items || data.items.length === 0) {
      return `No results found for query: "${query}"`;
    }

    // Format the results
    const results: string[] = [];
    results.push(`Search results for "${query}" (showing ${data.items.length} of ${data.searchInformation?.totalResults || 'unknown'} results):\n`);

    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      results.push(`${i + 1}. ${item.title}`);
      results.push(`   URL: ${item.link}`);

      if (item.snippet) {
        // Clean up the snippet (remove extra whitespace)
        const snippet = item.snippet.replace(/\s+/g, ' ').trim();
        results.push(`   ${snippet}`);
      }

      results.push(''); // Empty line between results
    }

    return results.join('\n');
  } catch (error: any) {
    // If Google Search fails, fallback to DuckDuckGo
    if (display) {
      console.log(`Google Search failed (${error.message}), falling back to DuckDuckGo...`);
    }
    return await executeDuckDuckGoSearch(query, numResults, 'wt-wt', display, shouldDisplayTool);
  }
}

/**
 * Fetches a web page and extracts readable content using Readability
 */
async function executeFetchPage(
  url: string,
  includeHtml: boolean = false,
  display?: ToolDisplay,
  shouldDisplayTool?: (toolName: string) => boolean
): Promise<string> {
  try {
    // Show tool usage to user
    if (shouldDisplayTool?.('FetchPage') && display) {
      display.showTool('FetchPage', {
        url: url.substring(0, 80) + (url.length > 80 ? '...' : ''),
        include_html: includeHtml
      });
    }

    // Validate URL
    let validUrl: URL;
    try {
      validUrl = new URL(url);
    } catch (error) {
      throw new Error(`Invalid URL: ${url}`);
    }

    // Fetch the page
    const response = await fetch(validUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch page: HTTP ${response.status} ${response.statusText}`);
    }

    const html = await response.text();

    // Parse with JSDOM
    const dom = new JSDOM(html, { url: validUrl.toString() });
    const document = dom.window.document;

    // Use Readability to extract content
    const reader = new Readability(document);
    const article = reader.parse();

    if (!article) {
      throw new Error('Failed to parse page content. The page might not contain readable article content.');
    }

    // Format the output
    const output: string[] = [];
    output.push(`Title: ${article.title || 'Untitled'}`);

    if (article.byline) {
      output.push(`Author: ${article.byline}`);
    }

    if (article.siteName) {
      output.push(`Site: ${article.siteName}`);
    }

    output.push(`URL: ${url}`);
    output.push(''); // Empty line

    if (article.excerpt) {
      output.push(`Excerpt: ${article.excerpt}`);
      output.push(''); // Empty line
    }

    output.push('Content:');
    output.push('---');
    output.push(article.textContent?.trim() || '(No readable content found)');

    if (includeHtml && article.content) {
      output.push('');
      output.push('HTML Content:');
      output.push('---');
      output.push(article.content);
    }

    return output.join('\n');
  } catch (error: any) {
    throw new Error(`Failed to fetch page: ${error.message}`);
  }
}
