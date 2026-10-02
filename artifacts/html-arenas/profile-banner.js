'use strict';
const sharp = require('sharp');
const { randomUUID } = require('node:crypto');
const BUCKET = 'avatars';

function bannerPath(url, userId) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== new URL(process.env.SUPABASE_URL).origin) return null;
    const marker = '/storage/v1/object/public/avatars/';
    if (!parsed.pathname.startsWith(marker)) return null;
    const path = decodeURIComponent(parsed.pathname.slice(marker.length));
    return path.startsWith('banners/' + userId + '/') && !path.includes('..') ? path : null;
  } catch { return null; }
}

async function removeBanners(db, userId, urls) {
  const paths = [...new Set(urls.map(url => bannerPath(url, userId)).filter(Boolean))];
  if (!paths.length) return;
  const { error } = await db.storage.from(BUCKET).remove(paths);
  if (error) throw error;
}

async function upload(db, path, bytes) {
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/webp', upsert: false });
  if (error) throw error;
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Do not retire the old objects until BOTH replacements and metadata are saved.
async function saveBanner(db, userId, buffer, previous = {}) {
  let meta;
  try { meta = await sharp(buffer).metadata(); }
  catch {
    const error = new Error('That file is not a supported image — upload a JPG, PNG or WebP');
    error.status = 400;
    throw error;
  }
  if (!['jpeg', 'png', 'webp'].includes(meta.format)) {
    const error = new Error('That file is not a supported image — upload a JPG, PNG or WebP');
    error.status = 400;
    throw error;
  }
  const image = sharp(buffer).rotate();
  const full = await image.clone().resize(1600, 400, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
  const card = await sharp(full).resize(640, 160, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
  const stem = `banners/${userId}/${Date.now()}-${randomUUID()}`;
  const written = [];
  let pointers;
  try {
    const banner_url = await upload(db, stem + '.webp', full);
    written.push(banner_url);
    const banner_card_url = await upload(db, stem + '-card.webp', card);
    written.push(banner_card_url);
    pointers = { banner_url, banner_card_url };
    const { error } = await db.auth.admin.updateUserById(userId, { user_metadata: pointers });
    if (error) throw error;
  } catch (error) {
    await removeBanners(db, userId, written).catch(e => console.error('Banner rollback cleanup failed:', e.message));
    throw error;
  }
  await removeBanners(db, userId, [previous.banner_url, previous.banner_card_url])
    .catch(e => console.error('Old banner cleanup failed:', e.message));
  return pointers;
}

async function backfillBanner(db, user, apply = false) {
  const meta = user.user_metadata || {};
  if (!meta.banner_url || meta.banner_card_url) return null;
  const path = bannerPath(meta.banner_url, user.id);
  if (!path) throw new Error('Banner does not belong to this user');
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error) throw error;
  const source = Buffer.from(await data.arrayBuffer());
  const bytes = await sharp(source).rotate().resize(640, 160, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
  const result = { userId: user.id, sourceBytes: source.length, variantBytes: bytes.length, applied: false };
  if (!apply) return result;
  const output = path.replace(/\.webp$/, '') + '-card.webp';
  const url = await upload(db, output, bytes);
  try {
    const { data: fresh, error: readError } = await db.auth.admin.getUserById(user.id);
    if (readError) throw readError;
    const current = fresh?.user?.user_metadata || {};
    if (current.banner_url !== meta.banner_url || current.banner_card_url) throw new Error('Banner changed during backfill; rerun');
    const { error: writeError } = await db.auth.admin.updateUserById(user.id, { user_metadata: { banner_card_url: url } });
    if (writeError) throw writeError;
  } catch (error) {
    await removeBanners(db, user.id, [url]).catch(e => console.error('Backfill rollback failed:', e.message));
    throw error;
  }
  return { ...result, applied: true };
}

module.exports = { saveBanner, backfillBanner, removeBanners, bannerPath };