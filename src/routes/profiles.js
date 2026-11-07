import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate } from '../middleware/authenticate.js';
import { toPublicProfile, validateProfile } from '../lib/profile.js';

const router = Router();

function responseProfile(row) {
  return {
    ...toPublicProfile(row),
    isPublished: Boolean(row.is_published)
  };
}

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM profiles WHERE user_id = ?', [req.userId]);
    if (!rows[0]) return res.status(404).json({ error: 'Profile not found.' });
    return res.json({ profile: responseProfile(rows[0]) });
  } catch (error) {
    return next(error);
  }
});

router.put('/me', authenticate, async (req, res, next) => {
  let profile;
  try {
    profile = validateProfile(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existingRows] = await connection.execute(
        'SELECT id, slug FROM profiles WHERE user_id = ? FOR UPDATE',
        [req.userId]
      );
      const existing = existingRows[0];
      if (!existing) {
        await connection.rollback();
        return res.status(404).json({ error: 'Profile not found.' });
      }

      if (profile.slug !== existing.slug) {
        await connection.execute(
          'INSERT IGNORE INTO profile_slug_reservations (slug, user_id) VALUES (?, ?)',
          [profile.slug, req.userId]
        );
        const [reservations] = await connection.execute(
          'SELECT user_id FROM profile_slug_reservations WHERE slug = ? FOR UPDATE',
          [profile.slug]
        );
        if (!reservations[0] || reservations[0].user_id !== req.userId) {
          await connection.rollback();
          return res.status(409).json({ error: 'That username is already in use.' });
        }
      }

      await connection.execute(
        `UPDATE profiles SET
          slug = ?, name = ?, role = ?, avatar = ?, bio = ?, email = ?, phone = ?, whatsapp = ?,
          website = ?, skills = ?, services = ?, accent = ?, projects = ?
         WHERE user_id = ?`,
        [
          profile.slug,
          profile.name,
          profile.role,
          profile.avatar,
          profile.bio,
          profile.email,
          profile.phone,
          profile.whatsapp,
          profile.website,
          profile.skills,
          profile.services,
          profile.accent,
          JSON.stringify(profile.projects),
          req.userId
        ]
      );
      if (profile.slug !== existing.slug) {
        await connection.execute(
          `DELETE FROM profile_slug_reservations
           WHERE slug = ? AND user_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM published_profiles WHERE slug = ? AND user_id = ?
             )`,
          [existing.slug, req.userId, existing.slug, req.userId]
        );
      }
      const [rows] = await connection.execute('SELECT * FROM profiles WHERE user_id = ?', [req.userId]);
      await connection.commit();
      return res.json({ profile: responseProfile(rows[0]) });
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'That username is already in use.' });
      }
      return next(error);
    } finally {
      connection.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.post('/me/publish', authenticate, async (req, res, next) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT * FROM profiles WHERE user_id = ? FOR UPDATE',
      [req.userId]
    );
    const profile = rows[0];
    if (!profile) {
      await connection.rollback();
      return res.status(404).json({ error: 'Profile not found.' });
    }
    if (!profile.name.trim()) {
      await connection.rollback();
      return res.status(400).json({ error: 'Add your name before publishing.' });
    }

    const [previousRows] = await connection.execute(
      'SELECT slug FROM published_profiles WHERE user_id = ? FOR UPDATE',
      [req.userId]
    );
    const previousSlug = previousRows[0]?.slug;
    await connection.execute(
      `INSERT INTO published_profiles (profile_id, user_id, slug, profile_data)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE slug = VALUES(slug), profile_data = VALUES(profile_data)`,
      [
        profile.id,
        req.userId,
        profile.slug,
        JSON.stringify(toPublicProfile(profile))
      ]
    );
    await connection.execute('UPDATE profiles SET is_published = TRUE WHERE user_id = ?', [req.userId]);
    if (previousSlug && previousSlug !== profile.slug) {
      await connection.execute(
        `DELETE FROM profile_slug_reservations
         WHERE slug = ? AND user_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM profiles WHERE slug = ? AND user_id = ?
           )`,
        [previousSlug, req.userId, previousSlug, req.userId]
      );
    }
    await connection.commit();
    return res.json({ published: true });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'That username is already in use.' });
    }
    return next(error);
  } finally {
    connection?.release();
  }
});

router.post('/me/unpublish', authenticate, async (req, res, next) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT slug FROM profiles WHERE user_id = ? FOR UPDATE',
      [req.userId]
    );
    if (!rows[0]) {
      await connection.rollback();
      return res.status(404).json({ error: 'Profile not found.' });
    }
    const [publishedRows] = await connection.execute(
      'SELECT slug FROM published_profiles WHERE user_id = ? FOR UPDATE',
      [req.userId]
    );
    const publishedSlug = publishedRows[0]?.slug;
    await connection.execute('DELETE FROM published_profiles WHERE user_id = ?', [req.userId]);
    await connection.execute('UPDATE profiles SET is_published = FALSE WHERE user_id = ?', [req.userId]);
    if (publishedSlug && publishedSlug !== rows[0].slug) {
      await connection.execute(
        'DELETE FROM profile_slug_reservations WHERE slug = ? AND user_id = ?',
        [publishedSlug, req.userId]
      );
    }
    await connection.commit();
    return res.json({ published: false });
  } catch (error) {
    if (connection) await connection.rollback();
    return next(error);
  } finally {
    connection?.release();
  }
});

router.get('/:slug', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT profile_data FROM published_profiles WHERE slug = ?',
      [req.params.slug]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Published profile not found.' });
    const profile = typeof rows[0].profile_data === 'string'
      ? JSON.parse(rows[0].profile_data)
      : rows[0].profile_data;
    return res.json({ profile: toPublicProfile(profile) });
  } catch (error) {
    return next(error);
  }
});

export default router;
