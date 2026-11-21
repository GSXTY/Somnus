import type { ChildMedia } from './ChildComposerExtras';
import { isLocalImage } from '../chat/assistantImages.mjs';
const memory = new Map<string, {
    text: string;
    media: ChildMedia;
}>();
export function childDraft(id: string): {
    text: string;
    media: ChildMedia;
} | undefined {
    if (memory.has(id))
        return memory.get(id);
    try {
        const value = JSON.parse(localStorage.getItem('somnus-child-draft:' + id) || 'null');
        if (!value || typeof value.text !== 'string' || !value.media || !Array.isArray(value.media.images) || !Array.isArray(value.media.files))
            return;
        return { text: value.text, media: { ...value.media, skills: [], images: value.media.images.filter((image: {
                    data_url?: string;
                }) => isLocalImage(image.data_url)), files: value.media.files.filter((file: {
                    id?: string;
                    name?: string;
                }) => typeof file.id === 'string' && typeof file.name === 'string').slice(0, 3) } };
    }
    catch {
        return;
    }
}
export function saveChildDraft(id: string, text: string, media: ChildMedia) { const value = { text, media }; memory.set(id, value); try {
    localStorage.setItem('somnus-child-draft:' + id, JSON.stringify(value));
}
catch { /* In-memory draft survives drawer close when local storage is full. */ } }
