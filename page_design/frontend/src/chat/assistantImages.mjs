export const imageLimits = { count: 4, singleBytes: 5 * 1024 * 1024, totalBytes: 10 * 1024 * 1024, side: 8192, pixels: 16000000 };
const supported = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const isLocalImage = value => typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(value);
export function validateImageBatch(files, existing = []) {
  if (files.length + existing.length > imageLimits.count) throw new Error('每次最多添加4张图片');
  for (const file of files) {
    if (!supported.has(file.type)) throw new Error('仅支持PNG、JPEG和WebP图片');
    if (!file.size || file.size > imageLimits.singleBytes) throw new Error('每张图片须大于0且不超过5MB');
  }
  if ([...files, ...existing].reduce((sum, value) => sum + value.size, 0) > imageLimits.totalBytes) throw new Error('图片合计不能超过10MB');
}
export function validateImageDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > imageLimits.side || height > imageLimits.side || width * height > imageLimits.pixels) throw new Error('图片尺寸过大：单边最多8192像素，总计最多1600万像素');
}
export async function readImageAttachment(file) {
  const data_url = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('图片读取失败，请重新添加')); reader.readAsDataURL(file);
  });
  if (!isLocalImage(data_url)) throw new Error('无法识别图片格式');
  const image = await new Promise((resolve, reject) => {
    const preview = new Image(); preview.onload = () => resolve(preview); preview.onerror = () => reject(new Error('图片无法解码，请选择有效图片')); preview.src = data_url;
  });
  validateImageDimensions(image.naturalWidth, image.naturalHeight);
  return { name: file.name || '粘贴图片.png', data_url, mime: file.type, size: file.size, width: image.naturalWidth, height: image.naturalHeight };
}
export async function prepareImages(files, existing = [], read = readImageAttachment) {
  validateImageBatch(files, existing);
  const result = await Promise.all(files.map(read));
  return [...existing, ...result];
}
