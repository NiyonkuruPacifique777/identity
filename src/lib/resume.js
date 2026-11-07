const templates = new Set([
  'classic', 'modern', 'minimal', 'sidebar', 'compact', 'elegant', 'bold', 'creative',
  'executive', 'academic', 'professional', 'simple', 'contrast', 'timeline', 'editorial',
  'geometric', 'monochrome', 'coral', 'forest', 'outline'
]);
const colorPattern = /^#[\da-f]{6}$/i;

function text(value, max, field) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${field} must be text of at most ${max} characters.`);
  return value.trim();
}

function avatar(value) {
  const photo = text(value, 1500000, 'Photo');
  if (!photo) return '';
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
  if (!match) {
    throw new Error('Photo must be a valid JPEG, PNG, or WebP image.');
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 1024 * 1024 || bytes.toString('base64') !== match[2]) throw new Error('Photo must be a valid image no larger than 1 MB.');
  const validSignature = match[1] === 'image/jpeg'
    ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : match[1] === 'image/png'
      ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!validSignature) throw new Error('Photo image data is invalid.');
  return photo;
}

function list(value, field, limit, validate) {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`${field} must be a list with no more than ${limit} entries.`);
  return value.map((item, index) => validate(item, `${field} ${index + 1}`));
}

export function validateResume(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Resume data is required.');
  const personal = input.personal;
  if (!personal || typeof personal !== 'object' || Array.isArray(personal)) throw new Error('Resume personal details are required.');
  const resume = {
    personal: {
      name: text(personal.name ?? '', 120, 'Name'),
      role: text(personal.role ?? '', 120, 'Profession'),
      email: text(personal.email ?? '', 254, 'Email'),
      phone: text(personal.phone ?? '', 40, 'Phone'),
      whatsapp: text(personal.whatsapp ?? '', 40, 'WhatsApp number'),
      location: text(personal.location ?? '', 160, 'Location'),
      website: text(personal.website ?? '', 2048, 'Website'),
      avatar: avatar(personal.avatar ?? ''),
      summary: text(personal.summary ?? '', 4000, 'Summary')
    },
    experience: list(input.experience ?? [], 'Experience', 50, (entry, label) => ({
      role: text(entry?.role ?? '', 120, `${label} role`),
      company: text(entry?.company ?? '', 160, `${label} company`),
      location: text(entry?.location ?? '', 160, `${label} location`),
      startDate: text(entry?.startDate ?? '', 40, `${label} start date`),
      endDate: text(entry?.endDate ?? '', 40, `${label} end date`),
      description: text(entry?.description ?? '', 4000, `${label} description`)
    })),
    education: list(input.education ?? [], 'Education', 30, (entry, label) => ({
      school: text(entry?.school ?? '', 160, `${label} school`),
      degree: text(entry?.degree ?? '', 160, `${label} degree`),
      startDate: text(entry?.startDate ?? '', 40, `${label} start date`),
      endDate: text(entry?.endDate ?? '', 40, `${label} end date`),
      description: text(entry?.description ?? '', 2000, `${label} description`)
    })),
    projects: list(input.projects ?? [], 'Projects', 30, (entry, label) => ({
      title: text(entry?.title ?? '', 160, `${label} title`),
      description: text(entry?.description ?? '', 2000, `${label} description`),
      url: text(entry?.url ?? '', 2048, `${label} URL`)
    })),
    services: list(input.services ?? [], 'Services', 50, (entry, label) => text(entry, 240, label)),
    skills: list(input.skills ?? [], 'Skills', 80, (entry, label) => ({
      name: text(entry?.name ?? '', 100, `${label} name`),
      level: Math.min(4, Math.max(1, Number.isInteger(entry?.level) ? entry.level : 3))
    })),
    languages: list(input.languages ?? [], 'Languages', 30, (entry, label) => ({
      name: text(entry?.name ?? '', 100, `${label} name`),
      level: Math.min(4, Math.max(1, Number.isInteger(entry?.level) ? entry.level : 1))
    }))
  };
  if (Buffer.byteLength(JSON.stringify(resume), 'utf8') > 1500000) throw new Error('Resume content is too large.');
  return resume;
}

export function validateResumeSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Resume settings are required.');
  const title = text(input?.title ?? 'My resume', 120, 'Resume title');
  if (!title) throw new Error('Resume title is required.');
  if (!templates.has(input?.template)) throw new Error('Choose a supported resume template.');
  if (typeof input.color !== 'string' || !colorPattern.test(input.color)) throw new Error('Choose a valid resume color.');
  return { title, template: input.template, color: input.color.toLowerCase(), resume: validateResume(input.resume) };
}

export const resumeRow = row => ({
  id: row.id,
  title: row.title,
  template: row.template,
  color: row.color,
  resume: typeof row.resume_data === 'string' ? JSON.parse(row.resume_data) : row.resume_data,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});
