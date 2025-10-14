/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FRONTEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
