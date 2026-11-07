import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export const hashToken = token => createHash('sha256').update(token).digest('hex');

export async function issueTokens(userId, connection) {
  const tokenId = randomUUID();
  const expiresAt = new Date(Date.now() + config.refreshTokenDays * 24 * 60 * 60 * 1000);
  const refreshToken = jwt.sign(
    { sub: userId, typ: 'refresh' },
    config.refreshSecret,
    { algorithm: 'HS256', jwtid: tokenId, expiresIn: `${config.refreshTokenDays}d` }
  );
  const accessToken = jwt.sign(
    { sub: userId, typ: 'access' },
    config.accessSecret,
    { algorithm: 'HS256', expiresIn: config.accessTokenTtl }
  );

  await connection.execute(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [tokenId, userId, hashToken(refreshToken), expiresAt]
  );

  return { accessToken, refreshToken };
}

export function setAuthCookies(res, tokens) {
  const secure = config.nodeEnv === 'production';
  const common = { httpOnly: true, secure, sameSite: 'lax' };
  const accessMaxAge = (jwt.decode(tokens.accessToken).exp * 1000) - Date.now();
  const refreshMaxAge = config.refreshTokenDays * 24 * 60 * 60 * 1000;

  res.cookie('identity_access', tokens.accessToken, {
    ...common,
    path: '/api',
    maxAge: accessMaxAge
  });
  res.cookie('identity_refresh', tokens.refreshToken, {
    ...common,
    path: '/api/auth',
    maxAge: refreshMaxAge
  });
}

export function clearAuthCookies(res) {
  const secure = config.nodeEnv === 'production';
  res.clearCookie('identity_access', { httpOnly: true, secure, sameSite: 'lax', path: '/api' });
  res.clearCookie('identity_refresh', { httpOnly: true, secure, sameSite: 'lax', path: '/api/auth' });
}
