import React, { createContext, useContext, useEffect, useRef, useCallback, ReactNode } from 'react';
import { emitKeypressEvents } from 'readline';
import { useStdin } from 'ink';

export interface Key {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  sequence: string;
  paste?: boolean;
  pasteContent?: string;
}

type KeypressHandler = (key: Key) => void;

interface KeypressContextValue {
  subscribe: (handler: KeypressHandler) => void;
  unsubscribe: (handler: KeypressHandler) => void;
}

const KeypressContext = createContext<KeypressContextValue | null>(null);

interface KeypressProviderProps {
  children: ReactNode;
}

export const KeypressProvider: React.FC<KeypressProviderProps> = ({ children }) => {
  const subscribersRef = useRef<Set<KeypressHandler>>(new Set());
  const pasteBufferRef = useRef<string>('');
  const isPastingRef = useRef<boolean>(false);

  // Use Ink's stdin management instead of process.stdin directly
  const { stdin, setRawMode } = useStdin();

  const subscribe = useCallback((handler: KeypressHandler) => {
    subscribersRef.current.add(handler);
  }, []);

  const unsubscribe = useCallback((handler: KeypressHandler) => {
    subscribersRef.current.delete(handler);
  }, []);

  useEffect(() => {
    // Let Ink manage raw mode - check if raw mode is supported first
    if (stdin && setRawMode) {
      const wasRaw = stdin.isRaw;
      if (!wasRaw && stdin.isTTY) {
        try {
          setRawMode(true);
        } catch (error) {
          // Raw mode not supported, continue without it
          console.warn('Raw mode not supported on this terminal');
        }
      }

      // Enable bracketed paste mode
      process.stdout.write('\x1b[?2004h');

      // Enable keypress events
      emitKeypressEvents(stdin);

      // Handle keypress events
      const handleKeypress = (str: string, key: any) => {
        if (!key) return;

        // Detect bracketed paste mode start
        if (key.sequence === '\x1b[200~' || str === '\x1b[200~') {
          isPastingRef.current = true;
          pasteBufferRef.current = '';
          return;
        }

        // Detect bracketed paste mode end
        if (key.sequence === '\x1b[201~' || str === '\x1b[201~') {
          isPastingRef.current = false;

          // Emit the complete paste as a single event
          const pasteContent = pasteBufferRef.current;
          const pasteKey: Key = {
            name: 'paste',
            ctrl: false,
            meta: false,
            shift: false,
            sequence: pasteContent,
            paste: true,
            pasteContent,
          };

          subscribersRef.current.forEach((handler) => handler(pasteKey));
          pasteBufferRef.current = '';
          return;
        }

        // If we're in paste mode, buffer the content
        if (isPastingRef.current) {
          pasteBufferRef.current += str || key.sequence || '';
          return;
        }

        // Normalize the key object
        const normalizedKey: Key = {
          name: key.name || '',
          ctrl: key.ctrl || false,
          meta: key.meta || false,
          shift: key.shift || false,
          sequence: key.sequence || str || '',
        };

        // Broadcast to all subscribers
        subscribersRef.current.forEach((handler) => handler(normalizedKey));
      };

      stdin.on('keypress', handleKeypress);

      // Cleanup - restore previous raw mode state
      return () => {
        stdin.off('keypress', handleKeypress);
        // Disable bracketed paste mode
        process.stdout.write('\x1b[?2004l');
        if (wasRaw === false && stdin.isTTY) {
          try {
            setRawMode(false);
          } catch (error) {
            // Ignore cleanup errors
          }
        }
      };
    }
  }, [stdin, setRawMode]);

  return (
    <KeypressContext.Provider value={{ subscribe, unsubscribe }}>
      {children}
    </KeypressContext.Provider>
  );
};

export const useKeypressContext = (): KeypressContextValue => {
  const context = useContext(KeypressContext);
  if (!context) {
    throw new Error('useKeypressContext must be used within a KeypressProvider');
  }
  return context;
};

export const useKeypress = (
  onKeypress: KeypressHandler,
  options: { isActive: boolean } = { isActive: true }
) => {
  const { subscribe, unsubscribe } = useKeypressContext();
  const handlerRef = useRef(onKeypress);

  // Keep handler ref up to date
  useEffect(() => {
    handlerRef.current = onKeypress;
  }, [onKeypress]);

  useEffect(() => {
    if (!options.isActive) return;

    const wrapper = (key: Key) => handlerRef.current(key);

    subscribe(wrapper);
    return () => unsubscribe(wrapper);
  }, [options.isActive, subscribe, unsubscribe]);
};
