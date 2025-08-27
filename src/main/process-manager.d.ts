declare const processManager: {
  startSystemAudioHelper(): Promise<{ok: boolean, pid?: number, error?: string}>;
  stopSystemAudioHelper(): Promise<{ok: boolean, error?: string}>;
  killExistingHelperProcesses(): Promise<void>;
  getHelperPath(): string;
  registerSystemAudioHandlers(
    stdoutHandler: (line: string) => void, 
    stderrHandler?: (line: string) => void
  ): boolean;
  cleanupAllProcesses(): void;
};

export = processManager;