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
    };
    window: {
      minimize: () => Promise<void>;
      maximize: () => Promise<void>;
      close: () => Promise<void>;
      isMaximized: () => Promise<boolean>;
    };
  };
}