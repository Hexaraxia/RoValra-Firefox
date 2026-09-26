import { GLTFLoader as NativeGLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Texture, CubeTexture, SRGBColorSpace, NearestFilter, LinearFilter, NearestMipmapNearestFilter, LinearMipmapNearestFilter, NearestMipmapLinearFilter, LinearMipmapLinearFilter, ClampToEdgeWrapping, MirroredRepeatWrapping, RepeatWrapping } from 'three';
import { fetch } from './fetch.js';
import { cleanImage } from './renderer.js';

const filters = { 9728: NearestFilter, 9729: LinearFilter, 9984: NearestMipmapNearestFilter, 9985: LinearMipmapNearestFilter, 9986: NearestMipmapLinearFilter, 9987: LinearMipmapLinearFilter };
const wrapping = { 33071: ClampToEdgeWrapping, 33648: MirroredRepeatWrapping, 10497: RepeatWrapping };

export class GLTFLoader extends NativeGLTFLoader {
    constructor(...args) {
        super(...args);
        this.pluginCallbacks.unshift((parser) => {
            const originalLoadBuffer = parser.loadBuffer.bind(parser);
            parser.loadBuffer = async (index) => {
                const buffer = parser.json.buffers[index];
                if (!buffer.uri) return originalLoadBuffer(index);
                const response = await fetch(new URL(buffer.uri, parser.options.path).href);
                if (!response.ok) throw new Error(`GLTF buffer request failed: ${response.status}`);
                return response.arrayBuffer();
            };
            return {
            name: 'ROVALRA_FIREFOX_IMAGES',
            loadTexture: async (textureIndex) => {
                const definition = parser.json.textures[textureIndex];
                const sourceIndex = definition.extensions?.EXT_texture_webp?.source ?? definition.extensions?.EXT_texture_avif?.source ?? definition.source;
                const source = parser.json.images[sourceIndex];
                let image;
                if (source.bufferView !== undefined) {
                    const bytes = await parser.getDependency('bufferView', source.bufferView);
                    image = await createImageBitmap(new Blob([bytes], { type: source.mimeType || 'application/octet-stream' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
                } else if (source.uri) {
                    image = await cleanImage(new URL(source.uri, parser.options.path).href);
                } else {
                    throw new Error('GLTF image has no data');
                }
                const texture = new Texture(image);
                const sampler = parser.json.samplers?.[definition.sampler] || {};
                texture.flipY = false;
                texture.name = definition.name || source.name || '';
                texture.magFilter = filters[sampler.magFilter] || LinearFilter;
                texture.minFilter = filters[sampler.minFilter] || LinearMipmapLinearFilter;
                texture.wrapS = wrapping[sampler.wrapS] || RepeatWrapping;
                texture.wrapT = wrapping[sampler.wrapT] || RepeatWrapping;
                texture.needsUpdate = true;
                if (source.extras) Object.assign(texture.userData, source.extras);
                parser.associations.set(texture, { textures: textureIndex });
                return texture;
            },
            };
        });
    }
    load(url, onLoad, onProgress, onError) {
        const resolved = new URL(url, this.path || location.href).href;
        this.manager.itemStart(resolved);
        fetch(resolved, { headers: this.requestHeader, credentials: this.withCredentials ? 'include' : 'same-origin' })
            .then(async (response) => {
                if (!response.ok) throw new Error(`GLTF request failed: ${response.status}`);
                return this.parseAsync(await response.arrayBuffer(), new URL('.', resolved).href);
            })
            .then(onLoad)
            .catch((error) => {
                this.manager.itemError(resolved);
                if (onError) onError(error);
                else console.error(error);
            })
            .finally(() => this.manager.itemEnd(resolved));
    }
}

export class CubeTextureLoader {
    load(urls, onLoad, onProgress, onError) {
        const texture = new CubeTexture();
        texture.colorSpace = SRGBColorSpace;
        Promise.all(urls.map((url) => cleanImage(url))).then((images) => {
            texture.images = images;
            texture.needsUpdate = true;
            onLoad?.(texture);
        }).catch((error) => {
            if (onError) onError(error);
            else console.error('RoValra skybox failed:', error);
        });
        return texture;
    }
}
