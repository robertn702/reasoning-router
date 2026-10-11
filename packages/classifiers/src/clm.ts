import { createServerPreset, type ServerConnection } from "./server.js";

/** A CLM server the user runs (`clm-serve`), at its default port on loopback. */
const clm = createServerPreset("clm", "http://127.0.0.1:8700");

export type ClmConnection = ServerConnection;
export const resolveClmConnection = clm.resolve;
export const createClmTransport = clm.createTransport;
export const clmClassifierProvider = clm.provider;
