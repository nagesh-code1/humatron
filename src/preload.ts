import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  },
  memory: {
    add: (content: string, metadata?: object) => ipcRenderer.invoke('memory:add', content, metadata),
    search: (query: string, limit?: number) => ipcRenderer.invoke('memory:search', query, limit),
    getRecent: (limit?: number) => ipcRenderer.invoke('memory:getRecent', limit),
  },
  skill: {
    save: (name: string, when_to_use: string, steps: string) => ipcRenderer.invoke('skill:save', name, when_to_use, steps),
    list: () => ipcRenderer.invoke('skill:list'),
    get: (name: string) => ipcRenderer.invoke('skill:get', name),
    delete: (name: string) => ipcRenderer.invoke('skill:delete', name),
    execute: (name: string, context?: object) => ipcRenderer.invoke('skill:execute', name, context),
  },
  conversation: {
    add: (role: string, content: string, metadata?: object) => ipcRenderer.invoke('conversation:add', role, content, metadata),
    getRecent: (limit?: number) => ipcRenderer.invoke('conversation:getRecent', limit),
  },
  tool: {
    log: (tool_name: string, args: object, result?: object, success?: boolean) => ipcRenderer.invoke('tool:log', tool_name, args, result, success),
  },
  nebius: {
    chat: (messages: Array<{role: string, content: string}>) => ipcRenderer.invoke('nebius:chat', messages),
    test: () => ipcRenderer.invoke('nebius:test'),
    models: () => ipcRenderer.invoke('nebius:models'),
  },
  agent: {
    chat: (text: string) => ipcRenderer.invoke('agent:chat', text),
  },
  calendar: {
    add: (title: string, start: string, end?: string, description?: string) => ipcRenderer.invoke('calendar:add', title, start, end, description),
    list: (date: string) => ipcRenderer.invoke('calendar:list', date),
    today: () => ipcRenderer.invoke('calendar:today'),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },
  onNotification: (callback: (notification: {title: string, body: string}) => void) => {
    ipcRenderer.on('notification', (_, notification) => callback(notification));
  },
});