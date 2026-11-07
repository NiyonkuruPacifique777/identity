import test from 'node:test';
import assert from 'node:assert/strict';
import { toPublicProfile, validateProfile } from '../src/lib/profile.js';

const validProfile = {
  slug: 'pacifique',
  name: 'Pacifique',
  role: 'Developer',
  avatar: '',
  bio: '',
  email: '',
  phone: '',
  whatsapp: '',
  website: '',
  skills: '',
  services: '',
  accent: 'blue',
  projects: []
};

test('accepts a profile with the supported fields', () => {
  assert.deepEqual(validateProfile(validProfile), validProfile);
});

test('accepts a JPEG profile photo and rejects invalid or oversized image data', () => {
  const avatar = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64')}`;
  assert.equal(validateProfile({ ...validProfile, avatar }).avatar, avatar);
  assert.throws(() => validateProfile({ ...validProfile, avatar: 'data:image/svg+xml;base64,PHN2Zz4=' }), /JPEG, PNG, or WebP/);
  assert.throws(() => validateProfile({ ...validProfile, avatar: 'data:image/jpeg;base64,PHN2Zz4=' }), /image data is invalid/);
  const oversized = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1024 * 1024)]).toString('base64')}`;
  assert.throws(() => validateProfile({ ...validProfile, avatar: oversized }), /no larger than 1 MB/);
});

test('includes the saved photo in the public profile projection', () => {
  const avatar = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64')}`;
  assert.equal(toPublicProfile({ ...validProfile, avatar }).avatar, avatar);
  assert.equal(toPublicProfile(validProfile).avatar, '');
});

test('rejects invalid slugs', () => {
  assert.throws(() => validateProfile({ ...validProfile, slug: '-invalid-' }), /Username must use/);
  assert.throws(() => validateProfile({ ...validProfile, slug: 'demo' }), /Username must use/);
});

test('rejects non-http URLs', () => {
  assert.throws(() => validateProfile({ ...validProfile, website: 'javascript:alert(1)' }), /http or https/);
  assert.throws(() => validateProfile({ ...validProfile, website: 'https://user:pass@example.com' }), /http or https/);
});

test('adds https to valid website and project URLs without a scheme', () => {
  const profile = validateProfile({
    ...validProfile,
    website: 'www.pacifique.com',
    projects: [{ title: 'Portfolio', desc: 'My work', url: 'portfolio.pacifique.com/work' }]
  });

  assert.equal(profile.website, 'https://www.pacifique.com/');
  assert.equal(profile.projects[0].url, 'https://portfolio.pacifique.com/work');
});

test('rejects malformed public email addresses', () => {
  assert.throws(() => validateProfile({ ...validProfile, email: 'not-an-email' }), /valid email address/);
});

test('rejects more than 30 projects', () => {
  const projects = Array.from({ length: 31 }, () => ({ title: '', desc: '', url: '' }));
  assert.throws(() => validateProfile({ ...validProfile, projects }), /no more than 30/);
});
