import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const databaseConfigured = [
  'MYSQL_HOST',
  'MYSQL_USER',
  'MYSQL_PASSWORD',
  'MYSQL_DATABASE',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'CLIENT_ORIGIN'
].every(key => process.env[key]);

test('profile saves, retrieves, publishes, and unpublishes through MySQL', {
  skip: !databaseConfigured
}, async () => {
  const [{ createApp }, { pool }] = await Promise.all([
    import('../src/app.js'),
    import('../src/db/pool.js')
  ]);
  const email = `profile-flow-${randomUUID()}@example.test`;
  const server = createApp().listen(0, '127.0.0.1');
  const cookies = new Map();

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const profile = {
    slug: `profile-${randomUUID().slice(0, 8)}`,
    name: 'Profile Flow Check',
    role: 'Software Engineer',
    avatar: `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64')}`,
    bio: 'A multi-field persistence check — café and Kigali.',
    email: 'contact@example.test',
    phone: '+250788123456',
    whatsapp: '250788123456',
    website: 'www.pacifique.com/work',
    skills: 'Node.js, MySQL, React',
    services: 'API development\nPortfolio websites',
    accent: 'emerald',
    projects: [
      { title: 'Project One', desc: 'First test project', url: 'www.example.test/project-one' },
      { title: 'Project Two', desc: 'Second test project', url: '' }
    ]
  };
  const savedProfile = {
    ...profile,
    website: 'https://www.pacifique.com/work',
    projects: [
      { ...profile.projects[0], url: 'https://www.example.test/project-one' },
      profile.projects[1]
    ]
  };

  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(cookies.size
          ? { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') }
          : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    const setCookies = response.headers.getSetCookie?.()
      ?? [response.headers.get('set-cookie')].filter(Boolean);
    for (const header of setCookies) {
      for (const [, name, value] of header.matchAll(/(?:^|,\s*)(identity_access|identity_refresh)=([^;,]*)/g)) {
        cookies.set(name, value);
      }
    }

    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  try {
    let result = await request('/auth/register', {
      method: 'POST',
      body: { email, password: 'temporary-test-password-29' }
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));

    result = await request('/profiles/me', { method: 'PUT', body: profile });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(
      Object.fromEntries(Object.keys(profile).map(key => [key, result.body.profile[key]])),
      savedProfile
    );

    result = await request('/profiles/me');
    assert.deepEqual(
      Object.fromEntries(Object.keys(profile).map(key => [key, result.body.profile[key]])),
      savedProfile
    );
    assert.equal(result.body.profile.isPublished, false);

    const resumePayload = {
      title: 'Software Engineer CV',
      template: 'modern',
      color: '#0f9d78',
      resume: {
        personal: { name: profile.name, role: profile.role, email: profile.email, avatar: profile.avatar, summary: profile.bio },
        experience: [{ role: 'Developer', company: 'Example', startDate: '2022', endDate: 'Present', description: 'Built software.' }],
        education: [],
        skills: [{ name: 'MySQL', level: 3 }],
        languages: [{ name: 'English', level: 4 }]
      }
    };
    result = await request('/resumes', { method: 'POST', body: resumePayload });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const resumeId = result.body.resume.id;
    assert.equal(result.body.resume.resume.personal.avatar, profile.avatar);
    result = await request('/resumes');
    assert.equal(result.body.resumes.length, 1);
    result = await request(`/resumes/${resumeId}`);
    assert.equal(result.body.resume.resume.languages[0].level, 4);
    result = await request(`/resumes/${resumeId}`, {
      method: 'PUT',
      body: { ...resumePayload, title: 'Updated CV', color: '#426cf5' }
    });
    assert.equal(result.body.resume.title, 'Updated CV');

    result = await request('/profiles/me/publish', { method: 'POST' });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    result = await request(`/profiles/${profile.slug}`);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(result.body.profile, savedProfile);

    const changedDraft = { ...profile, name: 'Draft changes stay private' };
    result = await request('/profiles/me', { method: 'PUT', body: changedDraft });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    result = await request(`/profiles/${profile.slug}`);
    assert.equal(result.body.profile.name, profile.name);

    result = await request('/profiles/me/publish', { method: 'POST' });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    result = await request(`/profiles/${profile.slug}`);
    assert.equal(result.body.profile.name, changedDraft.name);

    result = await request('/profiles/me/unpublish', { method: 'POST' });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    result = await request(`/profiles/${profile.slug}`);
    assert.equal(result.status, 404);
    result = await request(`/resumes/${resumeId}`, { method: 'DELETE' });
    assert.equal(result.status, 204);
    result = await request('/resumes');
    assert.deepEqual(result.body.resumes, []);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await pool.execute('DELETE FROM users WHERE email = ?', [email]);
    await pool.end();
  }
});
