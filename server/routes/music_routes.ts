import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { analyzeLikedMusicProfile, getCachedMusicProfile } from '../music/library_profile';

export function mountMusicRoutes(router: Router) {
  router.get('/music/profile', requireAuth, (req, res) => {
    const profile = getCachedMusicProfile(req.user!.uid);
    res.json({ profile });
  });

  router.post('/music/profile/analyze', requireAuth, async (req, res) => {
    try {
      const requestedMax = Number(req.body?.maxSongs || 3000);
      const maxSongs = Math.max(100, Math.min(requestedMax, 5000));
      const profile = await analyzeLikedMusicProfile(req.user!.uid, { maxSongs });
      res.json({ profile });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to analyze music profile' });
    }
  });
}
