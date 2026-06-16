import { createApp } from "./app";
import { configureSqlite, prisma } from "./db/prisma";

const PORT = Number(process.env.PORT ?? 4000);

async function main() {
  await configureSqlite();

  const app = createApp();
  const server = app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on http://0.0.0.0:${PORT}`);
  });

  const shutdown = async () => {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error", err);
  process.exit(1);
});
