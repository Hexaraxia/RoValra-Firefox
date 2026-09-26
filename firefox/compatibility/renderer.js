import { fetch } from './fetch.js';

export function isArrayBuffer(value) {
    return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

export function isResponse(value) {
    return value && typeof value.status === 'number' && typeof value.arrayBuffer === 'function';
}

export async function cleanImage(url) {
    if (typeof url !== 'string') return url;
    let blob;
    if (url.startsWith('data:')) {
        const comma = url.indexOf(',');
        const metadata = url.slice(5, comma);
        const content = url.slice(comma + 1);
        const bytes = metadata.includes(';base64') ? Uint8Array.from(atob(content), (char) => char.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(content));
        blob = new Blob([bytes], { type: metadata.split(';')[0] });
    } else {
        const response = await fetch(url, { credentials: 'omit' });
        if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
        blob = await response.blob();
    }
    const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
}

export async function transformSkyboxImage(url, { angle = 0, darken = false } = {}) {
    const image = await cleanImage(url);
    const rotated = Math.abs(angle) % 180 !== 0;
    const canvas = new OffscreenCanvas(rotated ? image.height : image.width, rotated ? image.width : image.height);
    const context = canvas.getContext('2d');
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(angle * Math.PI / 180);
    context.drawImage(image, -image.width / 2, -image.height / 2);
    if (darken) {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.fillStyle = 'rgba(0,0,0,0.55)';
        context.fillRect(0, 0, canvas.width, canvas.height);
    }
    return canvas;
}
