import { createServerPreset, type ServerConnection } from "./server.js";

/** A Laya server the user runs, such as `laya-serve`, at its default `http://127.0.0.1:8000`. */
const laya = createServerPreset("laya", "http://127.0.0.1:8000");

export type LayaConnection = ServerConnection;
export const resolveLayaConnection = laya.resolve;
export const createLayaTransport = laya.createTransport;
export const layaClassifierProvider = laya.provider;
