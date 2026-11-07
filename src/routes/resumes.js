import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate } from '../middleware/authenticate.js';
import { resumeRow, validateResumeSettings } from '../lib/resume.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, title, template, color, resume_data, created_at, updated_at FROM resumes WHERE user_id = ? ORDER BY updated_at DESC',
      [req.userId]
    );
    return res.json({ resumes: rows.map(resumeRow) });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  let resume;
  try {
    resume = validateResumeSettings(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    const id = randomUUID();
    await pool.execute(
      'INSERT INTO resumes (id, user_id, title, template, color, resume_data) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.userId, resume.title, resume.template, resume.color, JSON.stringify(resume.resume)]
    );
    const [rows] = await pool.execute('SELECT * FROM resumes WHERE id = ? AND user_id = ?', [id, req.userId]);
    return res.status(201).json({ resume: resumeRow(rows[0]) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM resumes WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!rows[0]) return res.status(404).json({ error: 'Resume not found.' });
    return res.json({ resume: resumeRow(rows[0]) });
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  let resume;
  try {
    resume = validateResumeSettings(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    const [result] = await pool.execute(
      'UPDATE resumes SET title = ?, template = ?, color = ?, resume_data = ? WHERE id = ? AND user_id = ?',
      [resume.title, resume.template, resume.color, JSON.stringify(resume.resume), req.params.id, req.userId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Resume not found.' });
    const [rows] = await pool.execute('SELECT * FROM resumes WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    return res.json({ resume: resumeRow(rows[0]) });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const [result] = await pool.execute('DELETE FROM resumes WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Resume not found.' });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

export default router;
