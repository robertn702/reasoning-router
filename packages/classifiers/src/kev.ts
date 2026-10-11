import { createServerPreset, type ServerConnection } from "./server.js";

/** A Kev server the user runs (`python -m kev.serve`), at its default `--host` and `--port`. */
const kev = createServerPreset("kev", "http://127.0.0.1:8008");

export type KevConnection = ServerConnection;
export const resolveKevConnection = kev.resolve;
export const createKevTransport = kev.createTransport;
export const kevClassifierProvider = kev.provider;
