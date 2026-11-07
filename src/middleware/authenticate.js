import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function authenticate(req, res, next) {
  const token = req.cookies.identity_access;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const payload = jwt.verify(token, config.accessSecret, { algorithms: ['HS256'] });
    if (payload.typ !== 'access' || typeof payload.sub !== 'string') {
      return res.status(401).json({ error: 'Invalid access token.' });
    }
    req.userId = payload.sub;
    return next();
  } catch {
    return res.status(401).json({ error: 'Access token expired or invalid.' });
  }
}
