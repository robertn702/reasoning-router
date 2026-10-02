import type { Server } from "node:net";

export function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("server is not listening on a TCP port");
  return address.port;
}
