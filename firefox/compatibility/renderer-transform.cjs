function replaceExactly(source, anchor, replacement, label, expected = 1) {
    const count = typeof anchor === 'string' ? source.split(anchor).length - 1 : [...source.matchAll(anchor)].length;
    if (count !== expected) throw new Error(`Firefox compatibility anchor changed (${label}): expected ${expected}, found ${count}`);
    return typeof anchor === 'string' ? source.split(anchor).join(replacement) : source.replace(anchor, replacement);
}

module.exports = function(source) {
            source = replaceExactly(source, /([A-Za-z_$][\w$]*) instanceof ArrayBuffer/g, 'isFirefoxArrayBuffer($1)', 'renderer ArrayBuffer realms', 6);
            source = replaceExactly(source, /([A-Za-z_$][\w$]*) instanceof Response/g, 'isFirefoxResponse($1)', 'renderer Response realms', 26);
            source = replaceExactly(source,
                `              const image = new Image();
              image.onload = () => {
                cacheResolve(image);
                resolve(image);
                CACHE.Image.set(cacheURL, image);
              };
              image.onerror = () => {
                cacheResolve(void 0);
                resolve(void 0);
                CACHE.Image.set(cacheURL, void 0);
              };
              image.crossOrigin = "anonymous";
              if (FLAGS.IMAGE_FUNC) {
                FLAGS.IMAGE_FUNC(fetchStr).then((str) => {
                  image.src = str;
                });
              } else {
                image.src = fetchStr;
              }`,
                `              cleanFirefoxImage(fetchStr).then((image) => {
                cacheResolve(image);
                resolve(image);
                CACHE.Image.set(cacheURL, image);
              }).catch(() => {
                cacheResolve(void 0);
                resolve(void 0);
                CACHE.Image.set(cacheURL, void 0);
              });`, 'renderer clean textures');
            source = replaceExactly(source, `  static() {
    return this.constructor;
  }
  static IsA(className) {`, `  static() {
    const wrapper = ClassNameToWrapper.get(this.instance.className);
    if (!wrapper) throw new Error('Unknown Firefox renderer wrapper');
    return wrapper;
  }
  static IsA(className) {`, 'renderer wrapper realm');
            return `import { isArrayBuffer as isFirefoxArrayBuffer, isResponse as isFirefoxResponse, cleanImage as cleanFirefoxImage } from '../../../src/firefox/renderer.js';\nimport { fetch } from '../../../src/firefox/fetch.js';\n` + source;
};
