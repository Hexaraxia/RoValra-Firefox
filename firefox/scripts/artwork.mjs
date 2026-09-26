import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

function badge(size, color) {
    const png = new PNG({ width: size, height: size });
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const dx = x / size - 0.5;
            const dy = y / size - 0.5;
            const ring = Math.max(Math.abs(dx), Math.abs(dy)) < 0.40;
            const mark = (Math.abs(dx) < 0.07 && Math.abs(dy) < 0.24) || (Math.abs(dy) < 0.07 && Math.abs(dx) < 0.24);
            png.data.set(mark ? [245, 248, 255, 255] : ring ? [...color, 255] : [0, 0, 0, 0], i);
        }
    }
    return PNG.sync.write(png);
}
export async function replaceArtwork(sourceDir) {
    const assets = path.join(sourceDir, 'public/Assets');
    const targets = [
        ['icon-16.png', 16, [38, 84, 130]], ['icon-48.png', 48, [38, 84, 130]],
        ['icon-128.png', 128, [38, 84, 130]], ['RoValraLogo.png', 128, [38, 84, 130]],
        ['Contributor.png', 64, [88, 99, 118]],
        ['OldLogo/OldLogo.png', 128, [38, 84, 130]],
    ];
    const tiers = path.join(assets, 'DonatorTiers');
    for (const name of await fs.readdir(tiers)) {
        if (!['Bronze.png', 'Silver.png', 'Gold.png', 'Diamond.png'].includes(name)) throw new Error(`Unreviewed restricted artwork: ${name}`);
        targets.push([`DonatorTiers/${name}`, 64, { 'Bronze.png': [135, 89, 55], 'Silver.png': [118, 131, 148], 'Gold.png': [161, 126, 28], 'Diamond.png': [62, 133, 157] }[name]]);
    }
    for (const [file, size, color] of targets) await fs.writeFile(path.join(assets, file), badge(size, color));
    await fs.writeFile(path.join(assets, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="696" height="123" viewBox="0 0 696 123"><rect x="4" y="4" width="115" height="115" rx="16" fill="#265482"/><path d="M61 27v69M27 61h69" stroke="white" stroke-width="17"/><text x="144" y="80" font-family="sans-serif" font-size="44" fill="#687d94">Personal Firefox Port</text></svg>\n');
    return [...targets.map(([file]) => `public/Assets/${file}`), 'public/Assets/logo.svg'];
}
