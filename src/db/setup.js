import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const schemaUrl = new URL('./schema.sql', import.meta.url);
const schema = await readFile(fileURLToPath(schemaUrl), 'utf8');

try {
  for (const statement of schema.split(';').map(part => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
  const [columns] = await pool.execute(
    `SELECT DATA_TYPE AS dataType
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profiles' AND COLUMN_NAME = 'avatar'`
  );
  if (!columns[0]) {
    await pool.query('ALTER TABLE profiles ADD COLUMN avatar MEDIUMTEXT NULL AFTER role');
  } else if (columns[0].dataType !== 'mediumtext') {
    await pool.query('ALTER TABLE profiles MODIFY COLUMN avatar MEDIUMTEXT NULL');
  }
  console.log('Database schema is ready.');
} catch (error) {
  console.error('Database setup failed:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
