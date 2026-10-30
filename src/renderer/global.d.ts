interface Window {
  api: {
    store: {
      get: (key: string) => Promise<any>;
      set: (key: string, value: any) => Promise<void>;
    };
    memory: {
      add: (content: string, metadata?: object) => Promise<{id: number, content: string}>;
      search: (query: string, limit?: number) => Promise<any[]>;
      getRecent: (limit?: number) => Promise<any[]>;
    };
    skill: {
      save: (name: string, when_to_use: string, steps: string) => Promise<{success: boolean}>;
      list: () => Promise<any[]>;
      get: (name: string) => Promise<any>;
    };
    conversation: {
      add: (role: string, content: string, metadata?: object) => Promise<{id: number}>;
      getRecent: (limit?: number) => Promise<any[]>;
    };
    tool: {
      log: (tool_name: string, args: object, result?: object, success?: boolean) => Promise<void>;
    };
    nebius: {
      chat: (messages: Array<{role: string, content: string}>) => Promise<any>;
      test: () => Promise<{ provider: string, model: string, ms: number, reply: string }>;
      models: () => Promise<string[]>;
    };
    agent: {
      chat: (text: string, opts?: { spokenLanguage?: string, voice?: boolean, romanOnly?: boolean }) => Promise<{ reply: string, tools: any[], model: string, provider: string }>;
    };
    mission: {
      start: (goal: string) => Promise<any>;
      cancel: (id: number) => Promise<void>;
      list: () => Promise<any[]>;
      get: (id: number) => Promise<any>;
      onEvent: (cb: (ev: any) => void) => () => void;
    };
    voice: {
      transcribe: (pcm: Float32Array) => Promise<{ text: string, language: string, engine: string }>;
    };
    data: {
      export: () => Promise<{ canceled?: boolean, path?: string, counts?: Record<string, number> }>;
      clear: () => Promise<{ canceled?: boolean, cleared?: Record<string, number> }>;
    };
    web: {
      test: () => Promise<{ ms: number, title: string }>;
    };
    files: {
      open: (path: string) => Promise<string>;
      reveal: (path: string) => Promise<void>;
    };
    calendar: {
      add: (title: string, start: string, end?: string, description?: string) => Promise<any>;
      list: (date: string) => Promise<any[]>;
      today: () => Promise<any[]>;
    };
    window: {
      minimize: () => Promise<void>;
      maximize: () => Promise<void>;
      close: () => Promise<void>;
      isMaximized: () => Promise<boolean>;
    };
  };
}