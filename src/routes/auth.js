import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { authenticate } from '../middleware/authenticate.js';
import { clearAuthCookies, hashToken, issueTokens, setAuthCookies } from '../lib/tokens.js';

const router = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  if (typeof value !== 'string' || value.length > 254) {
    throw new Error('Enter a valid email address.');
  }
  const email = value.trim().toLowerCase();
  if (!emailPattern.test(email)) throw new Error('Enter a valid email address.');
  return email;
}

function validatePassword(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 8 || Buffer.byteLength(value, 'utf8') > 72) {
    throw new Error('Password must be between 8 and 72 bytes long.');
  }
  return value;
}

async function createProfile(userId, connection) {
  const slug = `member-${randomBytes(5).toString('hex')}`;
  const profileId = randomUUID();
  await connection.execute(
    `INSERT INTO profiles
      (id, user_id, slug, bio, skills, services, projects)
     VALUES (?, ?, ?, '', '', '', JSON_ARRAY())`,
    [profileId, userId, slug]
  );
  await connection.execute(
    'INSERT INTO profile_slug_reservations (slug, user_id) VALUES (?, ?)',
    [slug, userId]
  );
}

router.post('/register', async (req, res, next) => {
  let email;
  let password;
  try {
    email = normalizeEmail(req.body?.email);
    password = validatePassword(req.body?.password);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    await connection.execute(
      'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)',
      [userId, email, passwordHash]
    );
    await createProfile(userId, connection);
    const tokens = await issueTokens(userId, connection);
    await connection.commit();
    setAuthCookies(res, tokens);
    return res.status(201).json({ user: { id: userId, email } });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    return next(error);
  } finally {
    connection?.release();
  }
});

router.post('/login', async (req, res, next) => {
  let email;
  let password;
  try {
    email = normalizeEmail(req.body?.email);
    if (typeof req.body?.password !== 'string') throw new Error('Enter your password.');
    if (Buffer.byteLength(req.body.password, 'utf8') > 72) {
      throw new Error('Password must not exceed 72 bytes.');
    }
    password = req.body.password;
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT id, email, password_hash FROM users WHERE email = ?',
      [email]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    const connection = await pool.getConnection();
    try {
      const tokens = await issueTokens(user.id, connection);
      setAuthCookies(res, tokens);
    } finally {
      connection?.release();
    }
    return res.json({ user: { id: user.id, email: user.email } });
  } catch (error) {
    return next(error);
  }
});

router.post('/refresh', async (req, res, next) => {
  const token = req.cookies.identity_refresh;
  if (!token) return res.status(401).json({ error: 'Refresh token is required.' });

  let payload;
  try {
    payload = jwt.verify(token, config.refreshSecret, { algorithms: ['HS256'] });
    if (payload.typ !== 'refresh' || typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
      throw new Error('Invalid refresh token.');
    }
  } catch {
    clearAuthCookies(res);
    return res.status(401).json({ error: 'Refresh token expired or invalid.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT token_hash, expires_at, revoked_at FROM refresh_tokens WHERE id = ? AND user_id = ? FOR UPDATE',
      [payload.jti, payload.sub]
    );
    const record = rows[0];
    const tokenHash = hashToken(token);
    if (!record || record.revoked_at || new Date(record.expires_at) <= new Date() || record.token_hash !== tokenHash) {
      await connection.rollback();
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Refresh token has been revoked or expired.' });
    }

    await connection.execute(
      'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL',
      [payload.jti]
    );
    const tokens = await issueTokens(payload.sub, connection);
    await connection.commit();
    setAuthCookies(res, tokens);
    return res.json({ refreshed: true });
  } catch (error) {
    if (connection) await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

router.post('/logout', async (req, res, next) => {
  const token = req.cookies.identity_refresh;
  if (token) {
    try {
      const payload = jwt.verify(token, config.refreshSecret, { algorithms: ['HS256'] });
      if (payload.typ === 'refresh' && typeof payload.jti === 'string') {
        await pool.execute(
          'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL',
          [payload.jti]
        );
      }
    } catch (error) {
      if (error.name !== 'TokenExpiredError' && error.name !== 'JsonWebTokenError') return next(error);
    }
  }
  clearAuthCookies(res);
  return res.status(204).end();
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, email FROM users WHERE id = ?',
      [req.userId]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists.' });
    return res.json({ user: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.put('/account', authenticate, async (req, res, next) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.currentPassword;
  if (!emailPattern.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (typeof password !== 'string') return res.status(400).json({ error: 'Enter your current password.' });

  try {
    const [rows] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [req.userId]);
    if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists.' });
    if (!(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    await pool.execute('UPDATE users SET email = ? WHERE id = ?', [email, req.userId]);
    return res.json({ user: { email } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An account with this email already exists.' });
    return next(error);
  }
});

router.put('/password', authenticate, async (req, res, next) => {
  const currentPassword = req.body?.currentPassword;
  let newPassword;
  try {
    if (typeof currentPassword !== 'string') throw new Error('Enter your current password.');
    newPassword = validatePassword(req.body?.newPassword);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute('SELECT password_hash FROM users WHERE id = ? FOR UPDATE', [req.userId]);
      if (!rows[0]) {
        await connection.rollback();
        return res.status(401).json({ error: 'Account no longer exists.' });
      }
      if (!(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
        await connection.rollback();
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }
      await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(newPassword, 12), req.userId]);
      await connection.execute(
        'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL',
        [req.userId]
      );
      await connection.commit();
      clearAuthCookies(res);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return res.json({ updated: true });
  } catch (error) {
    return next(error);
  }
});

router.delete('/account', authenticate, async (req, res, next) => {
  if (typeof req.body?.currentPassword !== 'string') {
    return res.status(400).json({ error: 'Enter your current password to delete your account.' });
  }
  try {
    const [rows] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [req.userId]);
    if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists.' });
    if (!(await bcrypt.compare(req.body.currentPassword, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    await pool.execute('DELETE FROM users WHERE id = ?', [req.userId]);
    clearAuthCookies(res);
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

export default router;
