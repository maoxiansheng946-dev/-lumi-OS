// Vite dev middleware / production static file serving
import express from "express";
import path from "path";
import fs from "fs";

export async function setupStatic(app: express.Express, __filename: string, __dirname: string, role: string = 'personal') {
  const isBundledServer = path.basename(process.cwd()).toLowerCase() === "dist-server" ||
    path.basename(__dirname).toLowerCase() === "dist-server";
  const isSourceServer = __filename.endsWith("server.ts") ||
    process.argv.some(arg => arg.replace(/\\/g, "/").endsWith("/server.ts") || arg === "server.ts");
  const isProduction = process.env.NODE_ENV === "production" ||
    isBundledServer ||
    (!isSourceServer && process.env.NODE_ENV !== "development" && fs.existsSync(path.join(process.cwd(), "dist")));

  // Personal desktop at /, org workbench at /index.org.html — both coexist
  const defaultFile = 'index.html';

  if (!isProduction) {
    console.log(`Starting in DEVELOPMENT mode (Vite)...`);
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "mpa",
    });
    app.use(vite.middlewares);
  } else {
    console.log(`Starting in PRODUCTION mode (Static) as ${role}...`);
    const distPath = fs.existsSync(path.join(process.cwd(), "dist"))
      ? path.join(process.cwd(), "dist")
      : path.join(process.cwd(), "..", "dist");
    app.use(express.static(distPath));
    app.use("/api/*", (_req, res) => { res.status(404).json({ error: "API route not found" }); });
    app.get("*", (_req, res) => { res.sendFile(path.join(distPath, defaultFile)); });
  }
}
