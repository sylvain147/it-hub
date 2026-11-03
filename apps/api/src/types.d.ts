declare module 'dynalite' {
  import type { Server } from 'node:http';
  export default function dynalite(opts?: Record<string, unknown>): Server;
}
