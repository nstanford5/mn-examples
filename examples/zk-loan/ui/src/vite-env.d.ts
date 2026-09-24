/// <reference types="vite/client" />

// All optional — defaults live next to each use. Set them in the shell, e.g.
//   VITE_NETWORK_ID=preview yarn dev
interface ImportMetaEnv {
  readonly VITE_NETWORK_ID?: string; // default 'preprod'
  readonly VITE_LOGGING_LEVEL?: string; // default 'info'
  readonly VITE_ATTESTATION_API_URL?: string; // default 'http://localhost:4000'
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
