import test from 'node:test';
import assert from 'node:assert/strict';
import { resumeRow, validateResume, validateResumeSettings } from '../src/lib/resume.js';

const resume = {
  personal: { name: 'Amina', role: 'Engineer', email: 'amina@example.test' },
  experience: [{ role: 'Engineer', company: 'Example', startDate: '2022', endDate: 'Present', description: 'Built systems.' }],
  education: [{ school: 'University', degree: 'BSc', startDate: '2018', endDate: '2022' }],
  skills: [{ name: 'JavaScript', level: 4 }],
  languages: [{ name: 'English', level: 3 }]
};

test('validates resume content and normalizes missing optional fields', () => {
  const result = validateResume(resume);
  assert.equal(result.personal.name, 'Amina');
  assert.equal(result.personal.avatar, '');
  assert.deepEqual(result.languages, [{ name: 'English', level: 3 }]);
});

test('validates template ids and custom hex colors', () => {
  assert.deepEqual(
    (({ title, template, color }) => ({ title, template, color }))(validateResumeSettings({
      title: 'My resume', template: 'forest', color: '#12aBcD', resume
    })),
    { title: 'My resume', template: 'forest', color: '#12abcd' }
  );
  assert.throws(() => validateResumeSettings({ title: 'CV', template: 'unknown', color: '#123456', resume }), /supported resume template/);
  assert.throws(() => validateResumeSettings({ title: 'CV', template: 'classic', color: 'red', resume }), /valid resume color/);
});

test('rejects invalid section data and unsafe photo URLs', () => {
  assert.throws(() => validateResume({ ...resume, experience: Array(51).fill({}) }), /no more than 50/);
  assert.throws(() => validateResume({ ...resume, personal: { avatar: 'javascript:alert(1)' } }), /valid JPEG, PNG, or WebP/);
  assert.equal(validateResume({ ...resume, skills: [{ name: 'Tool', level: 9 }] }).skills[0].level, 4);
});

test('decodes serialized resume rows', () => {
  assert.deepEqual(resumeRow({
    id: 'id', title: 'CV', template: 'classic', color: '#426cf5',
    resume_data: JSON.stringify(resume), created_at: null, updated_at: null
  }).resume, resume);
});
