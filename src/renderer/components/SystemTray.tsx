import React, { useEffect } from 'react';

export function SystemTray() {
  useEffect(() => {
    // This component is just a placeholder - actual tray is handled in main process
    // We could add IPC to communicate with tray from renderer if needed
  }, []);

  return null;
}