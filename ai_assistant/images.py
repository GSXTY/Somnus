"""Strict, bounded inline image validation; never fetch arbitrary URLs."""
import base64
import binascii
import io
import re
import warnings

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_BYTES = 10 * 1024 * 1024


def validate_images(value):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 4:
        raise ValueError('最多添加4张图片。')
    result, total = [], 0
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get('data_url'), str):
            raise ValueError('图片附件格式无效。')
        url = item['data_url']
        match = re.fullmatch(r'data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)', url)
        if not match or len(url) > MAX_IMAGE_BYTES * 4 // 3 + 128:
            raise ValueError('仅支持PNG、JPEG、WebP图片，单张不超过5MB。')
        mime, encoded = match.groups()
        try:
            raw = base64.b64decode(encoded.replace('\r','').replace('\n',''), validate=True)
        except (ValueError, binascii.Error):
            raise ValueError('图片编码无效。')
        total += len(raw)
        if not raw or len(raw) > MAX_IMAGE_BYTES or total > MAX_TOTAL_BYTES:
            raise ValueError('单张图片不超过5MB，所有图片合计不超过10MB。')
        magic = {'image/png': raw.startswith(b'\x89PNG\r\n\x1a\n'), 'image/jpeg': raw.startswith(b'\xff\xd8\xff'), 'image/webp': raw.startswith(b'RIFF') and raw[8:12] == b'WEBP'}
        if not magic[mime]:
            raise ValueError('图片内容与声明格式不符。')
        try:
            from PIL import Image
            with warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(raw)) as image:
                    width, height = image.size
                    if image.format != {'image/png':'PNG','image/jpeg':'JPEG','image/webp':'WEBP'}[mime] or min(width,height) < 1 or max(width,height) > 8192 or width*height > 16000000:
                        raise ValueError('图片尺寸过大或格式无效。')
                    if getattr(image, 'n_frames', 1) != 1:
                        raise ValueError('请使用静态图片。')
                    image.verify()
        except ImportError:
            raise ValueError('服务器缺少图片校验依赖，请安装Pillow。')
        except Exception:
            raise ValueError('图片损坏、尺寸过大或格式不受支持。')
        name = item.get('name', '图片')
        if not isinstance(name, str):
            raise ValueError('图片名称无效。')
        name = ''.join(char for char in name if char.isprintable()).strip()[:120] or '图片'
        result.append(dict(name=name, data_url=f'data:{mime};base64,'+base64.b64encode(raw).decode('ascii'), mime=mime, size=len(raw), width=width, height=height))
    return result
