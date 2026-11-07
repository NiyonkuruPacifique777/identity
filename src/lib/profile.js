const accents = new Set(['blue', 'emerald', 'amber', 'rose', 'ink']);
const reservedSlugs = new Set(['demo', 'me']);
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const maxAvatarBytes = 1024 * 1024;

function text(value, maxLength, field) {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`${field} must be text of at most ${maxLength} characters.`);
  }
  return value.trim();
}

function optionalUrl(value, field) {
  const input = text(value, 2048, field);
  if (!input) return '';
  const url = /^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${field} must be a valid http or https URL.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${field} must be a valid http or https URL.`);
  }
  return parsed.href;
}

function avatarImage(value) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string') throw new Error('Profile photo must be a valid image.');
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error('Profile photo must be a JPEG, PNG, or WebP image.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > maxAvatarBytes || bytes.toString('base64') !== match[2]) {
    throw new Error('Profile photo must be a valid image no larger than 1 MB.');
  }
  const validSignature = match[1] === 'image/jpeg'
    ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : match[1] === 'image/png'
      ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!validSignature) throw new Error('Profile photo image data is invalid.');
  return value;
}

export function validateProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('A profile object is required.');
  }

  const slug = text(input.slug, 30, 'Username').toLowerCase();
  if (!slugPattern.test(slug) || reservedSlugs.has(slug)) {
    throw new Error('Username must use 1–30 lowercase letters, numbers, or dashes and cannot start or end with a dash.');
  }

  if (!accents.has(input.accent)) {
    throw new Error('Choose a supported profile color.');
  }

  if (!Array.isArray(input.projects) || input.projects.length > 30) {
    throw new Error('Projects must be a list containing no more than 30 items.');
  }

  const projects = input.projects.map((project, index) => {
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
      throw new Error(`Project ${index + 1} is invalid.`);
    }
    return {
      title: text(project.title, 160, `Project ${index + 1} title`),
      desc: text(project.desc, 2000, `Project ${index + 1} description`),
      url: optionalUrl(project.url ?? '', `Project ${index + 1} URL`)
    };
  });

  const email = text(input.email, 254, 'Email');
  if (email && !emailPattern.test(email)) {
    throw new Error('Email must be a valid email address.');
  }

  return {
    slug,
    name: text(input.name, 120, 'Name'),
    role: text(input.role, 120, 'Profession'),
    avatar: avatarImage(input.avatar),
    bio: text(input.bio, 4000, 'Biography'),
    email,
    phone: text(input.phone, 40, 'Phone'),
    whatsapp: text(input.whatsapp, 40, 'WhatsApp number'),
    website: optionalUrl(input.website ?? '', 'Website'),
    skills: text(input.skills, 4000, 'Skills'),
    services: text(input.services, 4000, 'Services'),
    accent: input.accent,
    projects
  };
}

export const toPublicProfile = row => ({
  slug: row.slug,
  name: row.name,
  role: row.role,
  avatar: row.avatar || '',
  bio: row.bio,
  email: row.email,
  phone: row.phone,
  whatsapp: row.whatsapp,
  website: row.website,
  skills: row.skills,
  services: row.services,
  accent: row.accent,
  projects: typeof row.projects === 'string' ? JSON.parse(row.projects) : row.projects
});
