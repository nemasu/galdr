import React, { createContext, useContext, useState, useCallback } from 'react';

interface ToolInfo {
  id: string;
  name: string;
  parameters?: any;
  status: 'running' | 'success' | 'failed';
}

interface OutputContextValue {
  streamingContent: string;
  tools: ToolInfo[];
  appendToStream: (chunk: string) => void;
  clearStream: () => void;
  addTool: (id: string, name: string, parameters?: any) => void;
  updateToolStatus: (id: string, status: 'success' | 'failed') => void;
  clearTools: () => void;
}

const OutputContext = createContext<OutputContextValue | undefined>(undefined);

export const OutputProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [streamingContent, setStreamingContent] = useState('');
  const [tools, setTools] = useState<ToolInfo[]>([]);

  const appendToStream = useCallback((chunk: string) => {
    setStreamingContent((prev) => prev + chunk);
  }, []);

  const clearStream = useCallback(() => {
    setStreamingContent('');
  }, []);

  const addTool = useCallback((id: string, name: string, parameters?: any) => {
    setTools((prev) => [...prev, { id, name, parameters, status: 'running' }]);
  }, []);

  const updateToolStatus = useCallback((id: string, status: 'success' | 'failed') => {
    setTools((prev) =>
      prev.map((tool) => (tool.id === id ? { ...tool, status } : tool))
    );
  }, []);

  const clearTools = useCallback(() => {
    setTools([]);
  }, []);

  const value: OutputContextValue = {
    streamingContent,
    tools,
    appendToStream,
    clearStream,
    addTool,
    updateToolStatus,
    clearTools,
  };

  return <OutputContext.Provider value={value}>{children}</OutputContext.Provider>;
};

export const useOutput = (): OutputContextValue => {
  const context = useContext(OutputContext);
  if (!context) {
    throw new Error('useOutput must be used within an OutputProvider');
  }
  return context;
};
