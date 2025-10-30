import fs from 'fs';
import path from 'path';
import { ConversationContext, Provider } from '../types/index.js';
import { UserConfigManager } from '../config/userConfig.js';

const CONTEXT_DIR = '.galdr';
const SESSIONS_DIR = 'sessions';
const METADATA_FILE = 'metadata.json';
const DEFAULT_SESSION = 'default';

export interface SessionMetadata {
  name: string;
  created: number;
  lastAccessed: number;
  messageCount: number;
  description?: string;
}

export interface SessionIndex {
  currentSession: string;
  sessions: Record<string, SessionMetadata>;
}

export interface SessionData extends ConversationContext {
  metadata: SessionMetadata;
}

export class SessionManager {
  private contextPath: string;
  private sessionsPath: string;
  private metadataPath: string;
  private index: SessionIndex;
  private userConfig: UserConfigManager;

  constructor(workingDir: string = process.cwd(), userConfig?: UserConfigManager) {
    this.contextPath = path.join(workingDir, CONTEXT_DIR);
    this.sessionsPath = path.join(this.contextPath, SESSIONS_DIR);
    this.metadataPath = path.join(this.sessionsPath, METADATA_FILE);
    this.userConfig = userConfig || new UserConfigManager();
    this.ensureSessionsDir();
    this.index = this.loadIndex();
  }

  private ensureSessionsDir(): void {
    if (!fs.existsSync(this.contextPath)) {
      fs.mkdirSync(this.contextPath, { recursive: true });
    }
    if (!fs.existsSync(this.sessionsPath)) {
      fs.mkdirSync(this.sessionsPath, { recursive: true });
    }
  }

  private loadIndex(): SessionIndex {
    if (fs.existsSync(this.metadataPath)) {
      try {
        const data = fs.readFileSync(this.metadataPath, 'utf-8');
        return JSON.parse(data);
      } catch (error) {
        console.error('Error loading session index, creating new one:', error);
      }
    }

    return this.createDefaultIndex();
  }

  private createDefaultIndex(): SessionIndex {
    return {
      currentSession: DEFAULT_SESSION,
      sessions: {},
    };
  }

  private saveIndex(): void {
    fs.writeFileSync(this.metadataPath, JSON.stringify(this.index, null, 2));
  }

  private getSessionFilePath(sessionName: string): string {
    return path.join(this.sessionsPath, `${sessionName}.json`);
  }

  public getCurrentSessionName(): string {
    return this.index.currentSession;
  }

  public listSessions(): SessionMetadata[] {
    return Object.values(this.index.sessions).sort((a, b) => b.lastAccessed - a.lastAccessed);
  }

  public sessionExists(sessionName: string): boolean {
    return sessionName in this.index.sessions;
  }

  public loadSession(sessionName: string): ConversationContext | null {
    const filePath = this.getSessionFilePath(sessionName);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      const sessionData: SessionData = JSON.parse(data);

      // Update last accessed time
      if (this.index.sessions[sessionName]) {
        this.index.sessions[sessionName].lastAccessed = Date.now();
        this.saveIndex();
      }

      return sessionData;
    } catch (error) {
      console.error(`Error loading session ${sessionName}:`, error);
      return null;
    }
  }

  public saveSession(sessionName: string, context: ConversationContext, description?: string): void {
    const filePath = this.getSessionFilePath(sessionName);
    const now = Date.now();

    // Create or update metadata
    if (!this.index.sessions[sessionName]) {
      this.index.sessions[sessionName] = {
        name: sessionName,
        created: now,
        lastAccessed: now,
        messageCount: context.messages.length,
        description,
      };
    } else {
      this.index.sessions[sessionName].lastAccessed = now;
      this.index.sessions[sessionName].messageCount = context.messages.length;
      if (description !== undefined) {
        this.index.sessions[sessionName].description = description;
      }
    }

    // Save session data with metadata
    const sessionData: SessionData = {
      ...context,
      metadata: this.index.sessions[sessionName],
    };

    fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2));
    this.saveIndex();
  }

  public switchSession(sessionName: string): boolean {
    if (!this.sessionExists(sessionName)) {
      return false;
    }

    this.index.currentSession = sessionName;
    this.saveIndex();
    return true;
  }

  public createSession(sessionName: string, description?: string, currentProvider?: Provider): boolean {
    if (this.sessionExists(sessionName)) {
      return false;
    }

    const now = Date.now();
    this.index.sessions[sessionName] = {
      name: sessionName,
      created: now,
      lastAccessed: now,
      messageCount: 0,
      description,
    };

    // Create empty session file with default context
    const defaultContext: ConversationContext = {
      messages: [],
      currentProvider: currentProvider || this.userConfig.getDefaultProvider() || 'claude',
      switchMode: this.userConfig.getDefaultMode() || 'manual',
      providerModels: {
        claude: this.userConfig.getDefaultModel('claude') || 'default',
        gemini: this.userConfig.getDefaultModel('gemini') || 'default',
        copilot: this.userConfig.getDefaultModel('copilot') || 'default',
        deepseek: this.userConfig.getDefaultModel('deepseek') || 'default',
        cursor: this.userConfig.getDefaultModel('cursor') || 'default',
      },
    };

    this.saveSession(sessionName, defaultContext, description);
    return true;
  }

  public deleteSession(sessionName: string): boolean {
    // Don't allow deleting the current session
    if (sessionName === this.index.currentSession) {
      return false;
    }

    if (!this.sessionExists(sessionName)) {
      return false;
    }

    const filePath = this.getSessionFilePath(sessionName);

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      delete this.index.sessions[sessionName];
      this.saveIndex();
      return true;
    } catch (error) {
      console.error(`Error deleting session ${sessionName}:`, error);
      return false;
    }
  }

  public renameSession(oldName: string, newName: string): boolean {
    if (!this.sessionExists(oldName) || this.sessionExists(newName)) {
      return false;
    }

    const oldPath = this.getSessionFilePath(oldName);
    const newPath = this.getSessionFilePath(newName);

    try {
      // Move the file
      fs.renameSync(oldPath, newPath);

      // Update metadata
      this.index.sessions[newName] = {
        ...this.index.sessions[oldName],
        name: newName,
      };
      delete this.index.sessions[oldName];

      // Update current session if needed
      if (this.index.currentSession === oldName) {
        this.index.currentSession = newName;
      }

      this.saveIndex();
      return true;
    } catch (error) {
      console.error(`Error renaming session ${oldName} to ${newName}:`, error);
      return false;
    }
  }

  public getSessionMetadata(sessionName: string): SessionMetadata | null {
    return this.index.sessions[sessionName] || null;
  }

  public updateSessionDescription(sessionName: string, description: string): boolean {
    if (!this.sessionExists(sessionName)) {
      return false;
    }

    // Update description in metadata
    this.index.sessions[sessionName].description = description || undefined;
    this.saveIndex();

    // Also update the session file if it exists
    const filePath = this.getSessionFilePath(sessionName);
    if (fs.existsSync(filePath)) {
      try {
        const data = fs.readFileSync(filePath, 'utf-8');
        const sessionData: SessionData = JSON.parse(data);
        sessionData.metadata.description = description || undefined;
        fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2));
      } catch (error) {
        console.error(`Error updating session file for ${sessionName}:`, error);
      }
    }

    return true;
  }
}
