import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { readDB, writeDB } from "../../db_layer";
import { syncUserToSupabase } from "../config/supabase";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

export function mountAuthRoutes(router: Router, jwtSecret: string, getCookieOptions: () => any) {
  router.post("/auth/register", authLimiter, async (req, res) => {
    const { username, password, phone } = req.body;
    if (!username || !password || !phone) {
      return res.status(400).json({ error: "Username, password and phone are required" });
    }

    const db = readDB();
    if (db.users.find((u: any) => u.username === username)) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      uid: Math.random().toString(36).substring(2, 15),
      username,
      password: hashedPassword,
      phone,
      role: "user",
      balance: 10.0,
      createdAt: new Date().toISOString()
    };

    db.users.push(newUser);
    writeDB(db);

    // Fire-and-forget: sync to Supabase for SaaS
    syncUserToSupabase(newUser.uid, username, hashedPassword);

    const token = jwt.sign({ uid: newUser.uid, username, role: newUser.role }, jwtSecret, { expiresIn: "24h" });
    res.cookie("token", token, getCookieOptions());

    const { password: _, ...userWithoutPassword } = newUser;
    return res.json({ success: true, user: userWithoutPassword, token });
  });

  router.post("/auth/login", authLimiter, async (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    const user = db.users.find((u: any) => u.username === username);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (passwordMatch) {
      // Fire-and-forget: sync to Supabase for SaaS
      syncUserToSupabase(user.uid, username, user.password);

      const token = jwt.sign({ uid: user.uid, username, role: user.role }, jwtSecret, { expiresIn: "24h" });
      res.cookie("token", token, getCookieOptions());
      const { password: _, ...userWithoutPassword } = user;
      return res.json({ success: true, user: userWithoutPassword, token });
    }
    res.status(401).json({ error: "Invalid credentials" });
  });

  router.get("/auth/me", (req, res) => {
    let token = req.cookies.token;
    // Fallback: WebView2 may not send httpOnly cookies, check Authorization header
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) token = authHeader.slice(7);
    }
    if (!token) return res.status(401).json({ error: "Not authenticated" });
    try {
      const decoded: any = jwt.verify(token, jwtSecret);
      const db = readDB();
      const user = db.users.find((u: any) => u.uid === decoded.uid);
      if (!user) return res.status(401).json({ error: "User not found" });
      const { password: _, ...userWithoutPassword } = user;
      res.json({ user: userWithoutPassword });
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  router.post("/auth/logout", (req, res) => {
    res.clearCookie("token", getCookieOptions());
    res.json({ success: true });
  });

  // Bootstrap endpoint: auto-login for local admin account
  // Only active when AUTO_LOGIN_PASSWORD env var is configured
  router.get("/auth/bootstrap", async (req, res) => {
    const adminPassword = process.env.AUTO_LOGIN_PASSWORD;
    if (!adminPassword) {
      return res.status(404).json({ error: "Bootstrap not available" });
    }

    const db = readDB();
    let admin = db.users.find((u: any) => u.username === "admin");

    if (!admin) {
      // Create admin account on first bootstrap
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      admin = {
        uid: Math.random().toString(36).substring(2, 15),
        username: "admin",
        password: hashedPassword,
        phone: "+00000000000",
        role: "admin",
        balance: 999.0,
        createdAt: new Date().toISOString(),
      };
      db.users.push(admin);
      writeDB(db);
    }

    // Verify password matches current AUTO_LOGIN_PASSWORD
    const pwMatch = await bcrypt.compare(adminPassword, admin.password);
    if (!pwMatch) {
      // Password changed in .env — update stored hash
      admin.password = await bcrypt.hash(adminPassword, 10);
      const idx = db.users.findIndex((u: any) => u.username === "admin");
      if (idx >= 0) {
        db.users[idx].password = admin.password;
        writeDB(db);
      }
    }

    const token = jwt.sign(
      { uid: admin.uid, username: "admin", role: admin.role },
      jwtSecret,
      { expiresIn: "24h" },
    );
    res.cookie("token", token, getCookieOptions());
    const { password: _, ...userWithoutPassword } = admin;
    return res.json({ success: true, user: userWithoutPassword, token });
  });

  router.post("/auth/change-password", async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
      const decoded: any = jwt.verify(token, jwtSecret);
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Current and new passwords are required" });
      }

      const db = readDB();
      const userIndex = db.users.findIndex((u: any) => u.uid === decoded.uid);

      if (userIndex === -1) {
        return res.status(404).json({ error: "User not found" });
      }

      const storedPassword = db.users[userIndex].password || "";
      const passwordMatches = await bcrypt.compare(currentPassword, storedPassword);

      if (!passwordMatches) {
        return res.status(400).json({ error: "Incorrect current password" });
      }

      db.users[userIndex].password = await bcrypt.hash(newPassword, 10);
      writeDB(db);

      res.json({ success: true });
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  });
}
