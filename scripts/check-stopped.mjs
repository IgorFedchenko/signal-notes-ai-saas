import { createConnection } from "node:net";
import assert from "node:assert/strict";
for (const port of [3210, 56321, 56322, 56006]) {
  const listening = await new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
  assert.equal(
    listening,
    false,
    `Dedicated port ${port} must be released after launcher shutdown`,
  );
}
console.log(
  "PASS: dedicated application, database and Phoenix ports are closed.",
);
