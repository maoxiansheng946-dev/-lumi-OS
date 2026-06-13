import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { readDB, writeDB } from "../../db_layer";
import { syncUserToSupabase } from "../config/supabase";
import { getMember, listUserOrgs } from "../org/db";
import { saveVoiceprint, saveFace, getVoiceprints, getFaces, deleteVoiceprint, deleteFace } from "../biometrics/store";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

export function mountAuthRoutes(router: Router, jwtSecret: string, getCookieOptions: () => any) {
  router.post("/auth/register", authLimiter, async (req, res) => {
    try {
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
    } catch (err: any) {
      console.error('[Auth] register error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post("/auth/login", authLimiter, async (req, res) => {
    try {
    const { username, password } = req.body;
    const db = readDB();
    const user = db.users.find((u: any) => u.username === username);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (passwordMatch) {
      // Fire-and-forget: sync to Supabase for SaaS
      syncUserToSupabase(user.uid, username, user.password);

      const memberships = (db.orgMemberships || []).filter((m: any) => m.userId === user.uid && m.status === 'active');
      const membership = memberships.sort((a: any, b: any) => (b.joinedAt || b.createdAt || '').localeCompare(a.joinedAt || a.createdAt || ''))[0];
      const tokenPayload: any = { uid: user.uid, username, role: user.role };
      if (membership) { tokenPayload.orgId = membership.orgId; tokenPayload.orgRole = membership.role; }
      const token = jwt.sign(tokenPayload, jwtSecret, { expiresIn: "24h" });
      res.cookie("token", token, getCookieOptions());
      const { password: _, ...userWithoutPassword } = user;
      return res.json({ success: true, user: userWithoutPassword, token });
    }
    res.status(401).json({ error: "Invalid credentials" });
    } catch (err: any) {
      console.error('[Auth] login error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
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
      const resp: any = { user: userWithoutPassword };
      if (decoded.orgId) { resp.user.orgId = decoded.orgId; resp.user.orgRole = decoded.orgRole; }
      res.json(resp);
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
    try {
    const adminPassword = process.env.AUTO_LOGIN_PASSWORD || 'lumi_admin_2026';

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

    const memberships = (db.orgMemberships || []).filter((m: any) => m.userId === admin.uid && m.status === 'active');
    const membership = memberships.sort((a: any, b: any) => (b.joinedAt || b.createdAt || '').localeCompare(a.joinedAt || a.createdAt || ''))[0];
    const tokenPayload: any = { uid: admin.uid, username: "admin", role: admin.role };
    if (membership) { tokenPayload.orgId = membership.orgId; tokenPayload.orgRole = membership.role; }
    const token = jwt.sign(
      tokenPayload,
      jwtSecret,
      { expiresIn: "24h" },
    );
    res.cookie("token", token, getCookieOptions());
    const { password: _, ...userWithoutPassword } = admin;
    const userResp: any = { ...userWithoutPassword };
    if (membership) { userResp.orgId = membership.orgId; userResp.orgRole = membership.role; }
    return res.json({ success: true, user: userResp, token });
    } catch (err: any) {
      console.error('[Auth] bootstrap error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post("/auth/change-password", async (req, res) => {
    try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

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
    } catch (err: any) {
      console.error('[Auth] change-password error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Switch into organization context — returns a new JWT with orgId + orgRole
  router.post("/auth/switch-org", (req, res) => {
    let token = req.cookies.token;
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7);
    }
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    try {
      const decoded: any = jwt.verify(token, jwtSecret);
      const { orgId } = req.body;

      // Allow clearing org context (return to personal mode)
      if (orgId === null || orgId === undefined || orgId === '') {
        const personalToken = jwt.sign(
          { uid: decoded.uid, username: decoded.username, role: decoded.role || 'user' },
          jwtSecret,
          { expiresIn: "24h" }
        );
        res.cookie("token", personalToken, getCookieOptions());
        return res.json({ success: true, orgId: null, orgRole: null });
      }

      const membership = getMember(orgId, decoded.uid);
      if (!membership || membership.status !== 'active') {
        return res.status(403).json({ error: "You are not a member of this organization" });
      }

      const orgToken = jwt.sign(
        {
          uid: decoded.uid,
          username: decoded.username,
          role: decoded.role || 'user',
          orgId: membership.orgId,
          orgRole: membership.role,
        },
        jwtSecret,
        { expiresIn: "24h" }
      );

      res.cookie("token", orgToken, getCookieOptions());
      res.json({
        success: true,
        orgId: membership.orgId,
        orgRole: membership.role,
      });
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  // ── Biometric enrollment ──

  // Enroll a voiceprint: receives MFCC features extracted in-browser
  router.put("/auth/biometric/voiceprint/enroll", (req, res) => {
    let token = req.cookies.token;
    if (!token && req.headers.authorization?.startsWith('Bearer ')) token = req.headers.authorization.slice(7);
    if (!token) return res.status(401).json({ error: "Not authenticated" });
    try {
      const decoded: any = jwt.verify(token, jwtSecret);
      const { label, mfccFeatures, sampleCount } = req.body;
      if (!label || !mfccFeatures || !Array.isArray(mfccFeatures)) {
        return res.status(400).json({ error: "label and mfccFeatures (array of 13-dim vectors) are required" });
      }
      const vp = saveVoiceprint(decoded.uid, {
        voiceprintId: `vp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        label,
        mfccFeatures,
        sampleCount: sampleCount || mfccFeatures.length,
      });
      res.json({ success: true, voiceprint: { id: vp.voiceprintId, label: vp.label, sampleCount: vp.sampleCount } });
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  // Enroll a face: receives embedding extracted in-browser via MediaPipe
  router.put("/auth/biometric/face/enroll", (req, res) => {
    let token = req.cookies.token;
    if (!token && req.headers.authorization?.startsWith('Bearer ')) token = req.headers.authorization.slice(7);
    if (!token) return res.status(401).json({ error: "Not authenticated" });
    try {
      const decoded: any = jwt.verify(token, jwtSecret);
      const { label, embedding } = req.body;
      if (!label || !embedding || !Array.isArray(embedding)) {
        return res.status(400).json({ error: "label and embedding (number array) are required" });
      }
      const face = saveFace(decoded.uid, {
        faceId: `face_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        label,
        embedding,
      });
      res.json({ success: true, face: { id: face.faceId, label: face.label } });
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  // List enrolled biometrics for current user
  router.get("/auth/biometric/list", (req, res) => {
    let token = req.cookies.token;
    if (!token && req.headers.authorization?.startsWith('Bearer ')) token = req.headers.authorization.slice(7);
    if (!token) return res.status(401).json({ error: "Not authenticated" });
    try {
      const decoded: any = jwt.verify(token, jwtSecret);
      const voiceprints = getVoiceprints(decoded.uid).map(v => ({ id: v.voiceprintId, label: v.label, sampleCount: v.sampleCount, createdAt: v.createdAt }));
      const faces = getFaces(decoded.uid).map(f => ({ id: f.faceId, label: f.label, createdAt: f.createdAt }));
      res.json({ voiceprints, faces });
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  // Delete a biometric item
  router.delete("/auth/biometric/:type/:id", (req, res) => {
    let token = req.cookies.token;
    if (!token && req.headers.authorization?.startsWith('Bearer ')) token = req.headers.authorization.slice(7);
    if (!token) return res.status(401).json({ error: "Not authenticated" });
    try {
      const decoded: any = jwt.verify(token, jwtSecret);
      const { type, id } = req.params;
      if (type === 'voiceprint') {
        const ok = deleteVoiceprint(decoded.uid, id);
        return res.json({ success: ok, error: ok ? undefined : 'Not found' });
      }
      if (type === 'face') {
        const ok = deleteFace(decoded.uid, id);
        return res.json({ success: ok, error: ok ? undefined : 'Not found' });
      }
      res.status(400).json({ error: "Type must be 'voiceprint' or 'face'" });
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  // Switch to another user (biometric-triggered multi-user mode)
  router.post("/auth/switch-user", (req, res) => {
    let token = req.cookies.token;
    if (!token && req.headers.authorization?.startsWith('Bearer ')) token = req.headers.authorization.slice(7);
    if (!token) return res.status(401).json({ error: "Not authenticated" });
    try {
      const decoded: any = jwt.verify(token, jwtSecret);
      const { targetUid } = req.body;
      if (!targetUid) return res.status(400).json({ error: "targetUid is required" });

      const db = readDB();
      const targetUser = db.users.find((u: any) => u.uid === targetUid);
      if (!targetUser) return res.status(404).json({ error: "Target user not found" });

      const newToken = jwt.sign(
        { uid: targetUser.uid, username: targetUser.username, role: targetUser.role },
        jwtSecret,
        { expiresIn: "24h" },
      );
      res.cookie("token", newToken, getCookieOptions());
      const { password: _, ...userWithoutPassword } = targetUser;
      res.json({ success: true, user: userWithoutPassword, token: newToken });
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  // List user's organization memberships (for org switcher UI)
  router.get("/auth/orgs", (req, res) => {
    let token = req.cookies.token;
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7);
    }
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    try {
      const decoded: any = jwt.verify(token, jwtSecret);
      const orgs = listUserOrgs(decoded.uid);
      res.json({ orgs });
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  });
}
